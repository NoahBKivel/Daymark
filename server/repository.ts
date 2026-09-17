import { HTTPException } from 'hono/http-exception';
import { DateTime } from 'luxon';
import {
  addDays,
  daysBetween,
  expandTasks,
  isOverdue,
  occurrenceFor,
  taskRule,
} from '../src/shared/dates';
import {
  defaultSettings,
  taskInputSchema,
  type Task,
  type TaskInput,
  type TaskList,
  type Settings,
  type Backup,
} from '../src/shared/model';

export class Repository {
  constructor(
    readonly db: D1Database,
    readonly userId: string,
  ) {}
  async lists(): Promise<TaskList[]> {
    const r = await this.db
      .prepare('SELECT id,name,color FROM task_lists WHERE user_id = ? ORDER BY rowid')
      .bind(this.userId)
      .all<TaskList>();
    return r.results;
  }
  async ensureList() {
    const id = `${this.userId}-inbox`;
    await this.db
      .prepare('INSERT OR IGNORE INTO task_lists(id,user_id,name,color) VALUES(?,?,?,?)')
      .bind(id, this.userId, 'Personal', '#448b73')
      .run();
  }
  async saveList(list: TaskList) {
    const existing = await this.db
      .prepare('SELECT user_id FROM task_lists WHERE id=?')
      .bind(list.id)
      .first<{ user_id: string }>();
    if (existing && existing.user_id !== this.userId) throw new HTTPException(404);
    await this.db.batch([
      this.db
        .prepare(
          'INSERT INTO task_lists(id,user_id,name,color) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color WHERE user_id=?',
        )
        .bind(list.id, this.userId, list.name, list.color, this.userId),
      this.queuedStatement(`list:${list.id}`, Date.now(), true),
    ]);
    return list;
  }
  async deleteList(id: string) {
    const count = await this.db
      .prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id=? AND list_id=?')
      .bind(this.userId, id)
      .first<{ n: number }>();
    if (count?.n)
      throw new HTTPException(409, {
        message: 'Move tasks to another list before deleting this list. Task history is retained.',
      });
    // Keep deletion intentionally local until the Google list has been reconciled.
    const row = await this.db
      .prepare('SELECT google_id FROM task_lists WHERE user_id=? AND id=?')
      .bind(this.userId, id)
      .first<{ google_id: string | null }>();
    if (row?.google_id)
      throw new HTTPException(409, {
        message: 'This list has a Google copy. Rename or reuse it to preserve its history.',
      });
    await this.db
      .prepare('DELETE FROM task_lists WHERE user_id=? AND id=?')
      .bind(this.userId, id)
      .run();
  }
  async settings(): Promise<Settings> {
    const r = await this.db
      .prepare('SELECT payload FROM settings WHERE user_id=?')
      .bind(this.userId)
      .first<{ payload: string }>();
    return r ? JSON.parse(r.payload) : { ...defaultSettings(), timeZone: 'America/New_York' };
  }
  async saveSettings(settings: Settings) {
    await this.db
      .prepare(
        'INSERT INTO settings(user_id,payload) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload',
      )
      .bind(this.userId, JSON.stringify(settings))
      .run();
    return settings;
  }
  async get(id: string): Promise<Task | null> {
    const r = await this.db
      .prepare('SELECT payload FROM tasks WHERE user_id=? AND id=?')
      .bind(this.userId, id)
      .first<{ payload: string }>();
    return r ? JSON.parse(r.payload) : null;
  }
  async resolve(id: string): Promise<Task | null> {
    const saved = await this.get(id);
    if (saved) return saved;
    const i = id.lastIndexOf('@');
    if (i < 0) return null;
    const base = await this.get(id.slice(0, i));
    return base ? occurrenceFor(base, id.slice(i + 1)) || null : null;
  }
  async range(start: string, end: string): Promise<Task[]> {
    const [ordinary, series, exceptions] = await this.db.batch<{ payload: string }>([
      this.db
        .prepare(
          'SELECT payload FROM tasks WHERE user_id=? AND recurring=0 AND deleted=0 AND due_date>=? AND COALESCE(start_date,due_date)<? AND series_id IS NULL',
        )
        .bind(this.userId, start, end),
      this.db
        .prepare(
          'SELECT payload FROM tasks WHERE user_id=? AND recurring=1 AND deleted=0 AND COALESCE(start_date,due_date)<? AND (recurring_until IS NULL OR recurring_until>=?)',
        )
        .bind(this.userId, end, start),
      this.db
        .prepare(
          "SELECT payload FROM tasks WHERE user_id=? AND series_id IS NOT NULL AND ((due_date>=? AND COALESCE(start_date,due_date)<?) OR (json_extract(payload,'$.originalDate')>=? AND json_extract(payload,'$.originalDate')<?))",
        )
        .bind(this.userId, start, end, start, end),
    ]);
    const rows = [...ordinary.results, ...series.results, ...exceptions.results].map(
      (r) => JSON.parse(r.payload) as Task,
    );
    // Include every exception for the selected series so moved/deleted occurrences cannot reappear.
    const ids = rows.filter((t) => t.recurrence && !t.seriesId).map((t) => t.id);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const maxDuration = Math.max(
        0,
        ...rows
          .filter((t) => chunk.includes(t.id) && t.startDate && t.dueDate)
          .map((t) => daysBetween(t.startDate!, t.dueDate!)),
      );
      const extra = await this.db
        .prepare(
          `SELECT payload FROM tasks WHERE user_id=? AND series_id IN (${chunk.map(() => '?').join(',')}) AND json_extract(payload,'$.originalDate')>=? AND json_extract(payload,'$.originalDate')<=?`,
        )
        .bind(this.userId, ...chunk, start, addDays(end, maxDuration))
        .all<{ payload: string }>();
      rows.push(...extra.results.map((r) => JSON.parse(r.payload) as Task));
    }
    return expandTasks([...new Map(rows.map((t) => [t.id, t])).values()], start, end);
  }
  async search(q: string, filter: string, listId: string | undefined, page: number) {
    const clauses = ['user_id=?', 'deleted=0'];
    const args: (string | number)[] = [this.userId];
    if (q) {
      clauses.push("(title LIKE ? OR json_extract(payload,'$.description') LIKE ?)");
      args.push(`%${q}%`, `%${q}%`);
    }
    if (listId) {
      clauses.push('list_id=?');
      args.push(listId);
    }
    if (filter === 'undated') clauses.push('due_date IS NULL');
    if (filter === 'completed') clauses.push('completed=1');
    if (filter === 'open') clauses.push('completed=0');
    if (filter === 'overdue') {
      clauses.push('completed=0 AND due_date IS NOT NULL AND due_date<=?');
      args.push(
        DateTime.now()
          .setZone((await this.settings()).timeZone)
          .toISODate()!,
      );
    }
    const wanted = (page + 1) * 50 + 1;
    const candidates: Task[] = [];
    let offset = 0;
    // Fetch ordered chunks rather than letting a post-filter produce incomplete pages.
    while (candidates.length < wanted) {
      const rows = await this.db
        .prepare(
          `SELECT payload FROM tasks WHERE ${clauses.join(' AND ')} AND recurring=0 ORDER BY due_date IS NULL,due_date,title,id LIMIT 100 OFFSET ?`,
        )
        .bind(...args, offset)
        .all<{ payload: string }>();
      candidates.push(
        ...rows.results
          .map((r) => JSON.parse(r.payload) as Task)
          .filter((t) => filter !== 'overdue' || isOverdue(t)),
      );
      offset += 100;
      if (rows.results.length < 100) break;
    }
    if (!['undated', 'completed'].includes(filter)) {
      const seriesClauses = ['user_id=?', 'deleted=0', 'recurring=1'];
      const seriesArgs: (string | number)[] = [this.userId];
      if (q) {
        seriesClauses.push("(title LIKE ? OR json_extract(payload,'$.description') LIKE ?)");
        seriesArgs.push(`%${q}%`, `%${q}%`);
      }
      if (listId) {
        seriesClauses.push('list_id=?');
        seriesArgs.push(listId);
      }
      const series = await this.db
        .prepare(`SELECT payload FROM tasks WHERE ${seriesClauses.join(' AND ')}`)
        .bind(...seriesArgs)
        .all<{ payload: string }>();
      for (const row of series.results) {
        const base = JSON.parse(row.payload) as Task;
        const overrides = await this.db
          .prepare('SELECT id FROM tasks WHERE user_id=? AND series_id=?')
          .bind(this.userId, base.id)
          .all<{ id: string }>();
        const excluded = new Set(overrides.results.map((t) => t.id));
        const duration = base.startDate ? daysBetween(base.startDate, base.dueDate!) : 0;
        const horizon = DateTime.now().setZone(base.timeZone).plus({ days: 91 }).toISODate()!;
        let count = 0;
        taskRule(base.dueDate!, base.recurrence!).between(
          new Date(`${base.dueDate}T00:00:00Z`),
          new Date(`${horizon}T00:00:00Z`),
          true,
          (date) => {
            const dueDate = date.toISOString().slice(0, 10);
            const id = `${base.id}@${dueDate}`;
            if (excluded.has(id) || base.excludedDates?.includes(dueDate)) return true;
            const occurrence: Task = {
              ...base,
              id,
              seriesId: base.id,
              originalDate: dueDate,
              dueDate,
              startDate: base.startDate ? addDays(dueDate, -duration) : null,
              completed: false,
              completedAt: null,
              checklist: base.checklist.map((i) => ({ ...i, completed: false })),
            };
            if (filter === 'overdue' && !isOverdue(occurrence)) return false;
            candidates.push(occurrence);
            return ++count < wanted;
          },
        );
      }
    }
    candidates.sort(
      (a, b) =>
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
    return {
      tasks: candidates.slice(page * 50, page * 50 + 50),
      hasMore: candidates.length > (page + 1) * 50,
    };
  }
  private statement(t: Task, expected: number | null) {
    return this.db
      .prepare(
        `INSERT INTO tasks(id,user_id,list_id,title,start_date,due_date,series_id,recurring,recurring_until,completed,deleted,version,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET list_id=excluded.list_id,title=excluded.title,start_date=excluded.start_date,due_date=excluded.due_date,series_id=excluded.series_id,recurring=excluded.recurring,recurring_until=excluded.recurring_until,completed=excluded.completed,deleted=excluded.deleted,version=excluded.version,payload=excluded.payload WHERE tasks.user_id=? AND tasks.version=?`,
      )
      .bind(
        t.id,
        this.userId,
        t.listId,
        t.title,
        t.startDate,
        t.dueDate,
        t.seriesId || null,
        t.recurrence && !t.seriesId ? 1 : 0,
        t.recurrence?.until || null,
        t.completed ? 1 : 0,
        t.deleted ? 1 : 0,
        t.version,
        JSON.stringify(t),
        this.userId,
        expected ?? -1,
      );
  }
  private queuedStatement(id: string, version: number, conditional = false) {
    return this.db
      .prepare(
        `INSERT INTO outbox(user_id,entity_id,version) SELECT ?,?,? ${conditional ? 'WHERE changes()>0' : ''} ON CONFLICT(user_id,entity_id) DO UPDATE SET version=excluded.version,attempts=0,next_attempt=0,error=NULL`,
      )
      .bind(this.userId, id, version);
  }
  private assertChanged() {
    return this.db.prepare(
      "SELECT CASE WHEN changes()=1 THEN 1 ELSE json('concurrent_update') END",
    );
  }
  async enqueue(id: string, version: number) {
    await this.queuedStatement(id, version).run();
  }
  async save(
    input: TaskInput,
    id: string = crypto.randomUUID(),
    expected?: number,
    scope = 'one',
  ): Promise<Task> {
    input = taskInputSchema.parse(input);
    if (!(await this.lists()).some((l) => l.id === input.listId))
      throw new HTTPException(404, { message: 'Task list not found' });
    const prior = await this.resolve(id);
    const persisted = await this.get(id);
    if (expected !== undefined && prior && expected !== prior.version)
      throw new HTTPException(409, {
        message: 'This task changed elsewhere. Reload before saving.',
      });
    if (prior?.seriesId && scope === 'following') return this.split(prior, input);
    const now = new Date().toISOString();
    const task: Task = {
      ...input,
      id,
      createdAt: prior?.createdAt || now,
      updatedAt: now,
      version: (persisted?.version || prior?.version || 0) + 1,
      completedAt: input.completed ? prior?.completedAt || now : null,
      ...(prior?.seriesId ? { seriesId: prior.seriesId, originalDate: prior.originalDate } : {}),
      ...(prior?.excludedDates ? { excludedDates: prior.excludedDates } : {}),
    };
    const result = await this.db.batch([
      this.statement(task, persisted?.version ?? null),
      this.queuedStatement(id, task.version, true),
    ]);
    if (!result[0].meta.changes)
      throw new HTTPException(409, {
        message: 'This task changed elsewhere. Reload before saving.',
      });
    return task;
  }
  private async split(occurrence: Task, input: TaskInput): Promise<Task> {
    const original = await this.get(occurrence.seriesId!);
    if (!original?.recurrence) throw new HTTPException(404);
    const cutoff = occurrence.originalDate!;
    const previousUntil = original.recurrence.until;
    const remainingCount = original.recurrence.count
      ? Math.max(
          1,
          original.recurrence.count -
            taskRule(original.dueDate!, original.recurrence).between(
              new Date(`${original.dueDate}T00:00:00Z`),
              new Date(`${addDays(cutoff, -1)}T23:59:59Z`),
              true,
            ).length,
        )
      : null;
    const old: Task = {
      ...original,
      deleted: cutoff === original.dueDate,
      recurrence:
        cutoff === original.dueDate
          ? original.recurrence
          : { ...original.recurrence, until: addDays(cutoff, -1) },
      version: original.version + 1,
      updatedAt: new Date().toISOString(),
    };
    const fresh: Task = {
      ...input,
      id: crypto.randomUUID(),
      recurrence: input.recurrence
        ? {
            ...input.recurrence,
            count:
              input.recurrence.count === original.recurrence.count
                ? remainingCount
                : input.recurrence.count,
            until:
              input.recurrence.until === original.recurrence.until
                ? previousUntil
                : input.recurrence.until,
          }
        : null,
      completedAt: input.completed ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    const ex = await this.db
      .prepare(
        "SELECT payload FROM tasks WHERE user_id=? AND series_id=? AND json_extract(payload,'$.originalDate')>=?",
      )
      .bind(this.userId, original.id, cutoff)
      .all<{ payload: string }>();
    const statements = [
      this.statement(old, original.version),
      this.assertChanged(),
      this.queuedStatement(old.id, old.version),
      this.statement(fresh, null),
      this.assertChanged(),
      this.queuedStatement(fresh.id, 1),
    ];
    for (const row of ex.results) {
      const t = JSON.parse(row.payload) as Task;
      if (!t.completed) {
        const deleted = { ...t, deleted: true, version: t.version + 1 };
        statements.push(
          this.statement(deleted, t.version),
          this.assertChanged(),
          this.queuedStatement(t.id, deleted.version),
        );
      }
    }
    try {
      await this.db.batch(statements);
    } catch (e) {
      if (String(e).includes('malformed JSON'))
        throw new HTTPException(409, {
          message: 'This series changed elsewhere. Reload before saving.',
        });
      throw e;
    }
    return fresh;
  }
  async remove(id: string, scope = 'one', expected?: number) {
    const t = await this.resolve(id);
    if (!t) throw new HTTPException(404);
    if (expected !== undefined && expected !== t.version)
      throw new HTTPException(409, { message: 'This task changed elsewhere.' });
    if (t.seriesId && scope === 'following') {
      const series = await this.get(t.seriesId);
      if (!series?.recurrence) throw new HTTPException(404);
      const updated = {
        ...series,
        deleted: t.originalDate === series.dueDate,
        recurrence:
          t.originalDate === series.dueDate
            ? series.recurrence
            : { ...series.recurrence, until: addDays(t.originalDate!, -1) },
        version: series.version + 1,
      };
      const ex = await this.db
        .prepare(
          "SELECT payload FROM tasks WHERE user_id=? AND series_id=? AND json_extract(payload,'$.originalDate')>=?",
        )
        .bind(this.userId, series.id, t.originalDate!)
        .all<{ payload: string }>();
      const statements = [
        this.statement(updated, series.version),
        this.assertChanged(),
        this.queuedStatement(series.id, updated.version),
      ];
      for (const row of ex.results) {
        const child = JSON.parse(row.payload) as Task;
        if (!child.completed)
          statements.push(
            this.statement({ ...child, deleted: true, version: child.version + 1 }, child.version),
            this.assertChanged(),
            this.queuedStatement(child.id, child.version + 1),
          );
      }
      try {
        await this.db.batch(statements);
      } catch (e) {
        if (String(e).includes('malformed JSON'))
          throw new HTTPException(409, {
            message: 'This series changed elsewhere. Reload before deleting.',
          });
        throw e;
      }
      return;
    }
    const saved = await this.get(id);
    const deleted = { ...t, deleted: true, version: (saved?.version || t.version || 0) + 1 };
    await this.db.batch([
      this.statement(deleted, saved?.version ?? null),
      this.queuedStatement(id, deleted.version, true),
    ]);
  }
  async export(): Promise<Backup> {
    const rows = await this.db
      .prepare('SELECT payload FROM tasks WHERE user_id=?')
      .bind(this.userId)
      .all<{ payload: string }>();
    return {
      format: 'daymark',
      version: 1,
      exportedAt: new Date().toISOString(),
      lists: await this.lists(),
      tasks: rows.results.map((r) => JSON.parse(r.payload)),
      settings: await this.settings(),
    };
  }
  async restore(backup: Backup) {
    if (
      (await this.db
        .prepare('SELECT COUNT(*) n FROM tasks WHERE user_id=?')
        .bind(this.userId)
        .first<{ n: number }>())!.n
    )
      throw new HTTPException(409, {
        message: 'Restore requires an empty task account. Export your current tasks first.',
      });
    const listIds = new Map(backup.lists.map((l) => [l.id, crypto.randomUUID()]));
    const taskIds = new Map(backup.tasks.map((t) => [t.id, crypto.randomUUID()]));
    for (const t of backup.tasks) {
      if (!listIds.has(t.listId) || (t.seriesId && !taskIds.has(t.seriesId)))
        throw new HTTPException(400, { message: 'Backup contains a missing list or series' });
    }
    const statements: D1PreparedStatement[] = [];
    for (const l of backup.lists)
      statements.push(
        this.db
          .prepare('INSERT INTO task_lists(id,user_id,name,color) VALUES(?,?,?,?)')
          .bind(listIds.get(l.id), this.userId, l.name, l.color),
      );
    for (const t of backup.tasks) {
      const copy = {
        ...t,
        id: taskIds.get(t.id)!,
        listId: listIds.get(t.listId)!,
        seriesId: t.seriesId ? taskIds.get(t.seriesId) : undefined,
        version: 1,
      };
      if (copy.seriesId) copy.id = `${copy.seriesId}@${copy.originalDate}`;
      statements.push(this.statement(copy, null), this.queuedStatement(copy.id, 1, true));
    }
    // D1 batch is transactional: an invalid backup cannot leave a partially restored account.
    if (statements.length) await this.db.batch(statements);
    await this.saveSettings(backup.settings);
  }
}
