import { DateTime } from 'luxon';
import { allowedEmail, type Env } from './env';
import { Google, GoogleError } from './google';
import { Repository } from './repository';
import { addDays, expandTasks, occurrenceFor } from '../src/shared/dates';
import type { Task, TaskList } from '../src/shared/model';

type Mapping = {
  google_id: string;
  google_list_id: string;
  version: number;
  attempt_started?: string | null;
};
class SyncContinuation extends Error {}
export class TaskSync {
  readonly google: Google;
  readonly repo: Repository;
  constructor(
    readonly env: Env,
    readonly userId: string,
  ) {
    this.google = new Google(env, userId);
    this.repo = new Repository(env.DB, userId);
  }
  async mapping(id: string) {
    return this.env.DB.prepare(
      'SELECT google_id,google_list_id,version,attempt_started FROM google_mappings WHERE user_id=? AND entity_id=?',
    )
      .bind(this.userId, id)
      .first<Mapping>();
  }
  async remember(id: string, googleId: string, listId: string, version: number) {
    await this.env.DB.prepare(
      'INSERT INTO google_mappings(user_id,entity_id,google_id,google_list_id,version) VALUES(?,?,?,?,?) ON CONFLICT(user_id,entity_id) DO UPDATE SET google_id=excluded.google_id,google_list_id=excluded.google_list_id,version=excluded.version',
    )
      .bind(this.userId, id, googleId, listId, version)
      .run();
  }
  listTitle(list: TaskList) {
    return `Daymark · ${list.name} [${list.id.slice(0, 8)}]`;
  }
  async syncList(id: string): Promise<string> {
    const list = (await this.repo.lists()).find((l) => l.id === id);
    if (!list) throw new Error('List unavailable');
    const saved = await this.env.DB.prepare(
      'SELECT google_id FROM task_lists WHERE user_id=? AND id=?',
    )
      .bind(this.userId, id)
      .first<{ google_id: string | null }>();
    let googleId = saved?.google_id;
    if (!googleId) {
      const lists = await this.google.pages<{ id: string; title: string }>(
        '/tasks/v1/users/@me/lists?maxResults=100',
      );
      googleId = lists.find((l) => l.title === this.listTitle(list))?.id;
      if (!googleId)
        googleId = (
          await this.google.request<{ id: string }>('/tasks/v1/users/@me/lists', 'POST', {
            title: this.listTitle(list),
          })
        ).id;
      await this.env.DB.prepare('UPDATE task_lists SET google_id=? WHERE user_id=? AND id=?')
        .bind(googleId, this.userId, id)
        .run();
    } else {
      try {
        await this.google.request(
          `/tasks/v1/users/@me/lists/${encodeURIComponent(googleId)}`,
          'PATCH',
          { title: this.listTitle(list) },
        );
      } catch (e) {
        if (e instanceof GoogleError && e.status === 404) {
          await this.env.DB.prepare('UPDATE task_lists SET google_id=NULL WHERE user_id=? AND id=?')
            .bind(this.userId, id)
            .run();
          return this.syncList(id);
        }
        throw e;
      }
    }
    return googleId;
  }
  marker(id: string) {
    return `${this.env.APP_URL}/?task=${encodeURIComponent(id)}`;
  }
  async beginCreate(id: string, listId: string) {
    await this.env.DB.prepare(
      "INSERT INTO google_mappings(user_id,entity_id,google_id,google_list_id,version,attempt_started) VALUES(?,?,'',?,0,?) ON CONFLICT(user_id,entity_id) DO UPDATE SET google_id='',google_list_id=excluded.google_list_id,version=0,attempt_started=excluded.attempt_started",
    )
      .bind(this.userId, id, listId, new Date(Date.now() - 5000).toISOString())
      .run();
  }
  async mirror(task: Task, listId?: string) {
    const existing = await this.mapping(task.id);
    if (task.deleted) {
      if (existing) await this.erase(task.id, existing);
      return;
    }
    const target = listId || (await this.syncList(task.listId));
    if (existing && existing.google_list_id !== target) {
      await this.erase(task.id, existing);
    }
    const mapping = existing?.google_list_id === target ? existing : null;
    if (mapping && mapping.version >= task.version) return;
    const marker = this.marker(task.id);
    const body = {
      title: task.title,
      notes: `${task.description}\n\n${marker}`,
      due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null,
      status: task.completed ? 'completed' : 'needsAction',
      completed: task.completed ? task.completedAt : null,
    };
    const path = `/tasks/v1/lists/${encodeURIComponent(target)}/tasks`;
    let googleId = mapping?.google_id;
    if (!googleId && mapping?.attempt_started) {
      // Google Tasks insert has no idempotency key. Reconcile our unique marker after uncertain responses.
      const remote = await this.google.pages<{ id: string; notes?: string }>(
        `${path}?maxResults=100&showCompleted=true&showHidden=true&updatedMin=${encodeURIComponent(mapping.attempt_started)}`,
      );
      googleId = remote.find((t) => t.notes?.split('\n').includes(marker))?.id;
    }
    if (googleId) {
      try {
        await this.google.request(`${path}/${encodeURIComponent(googleId)}`, 'PATCH', body);
      } catch (e) {
        if (e instanceof GoogleError && e.status === 404) googleId = undefined;
        else throw e;
      }
    }
    if (!googleId) {
      await this.beginCreate(task.id, target);
      googleId = (await this.google.request<{ id: string }>(path, 'POST', body)).id;
    }
    // Save the parent mapping before subtasks, so a partial failure cannot recreate it.
    await this.remember(task.id, googleId, target, 0);
    const currentIds = new Set(task.checklist.map((i) => `${task.id}/check/${i.id}`));
    const old = await this.env.DB.prepare(
      'SELECT entity_id,google_id,google_list_id,version,attempt_started FROM google_mappings WHERE user_id=? AND entity_id LIKE ?',
    )
      .bind(this.userId, `${task.id}/check/%`)
      .all<Mapping & { entity_id: string }>();
    let work = 0;
    for (const m of old.results)
      if (!currentIds.has(m.entity_id)) {
        if (work++ >= 6) throw new SyncContinuation();
        await this.erase(m.entity_id, m);
      }
    let previous: string | undefined;
    for (const item of task.checklist) {
      const id = `${task.id}/check/${item.id}`;
      let m: Mapping | undefined = old.results.find((m) => m.entity_id === id);
      const childMarker = this.marker(id);
      if (m?.version === task.version && m.google_id) {
        previous = m.google_id;
        continue;
      }
      if (work++ >= 6) throw new SyncContinuation();
      if (m && !m.google_id && m.attempt_started) {
        const children = await this.google.pages<{ id: string; notes?: string }>(
          `${path}?maxResults=100&showCompleted=true&showHidden=true&updatedMin=${encodeURIComponent(m.attempt_started)}`,
        );
        const found = children.find((c) => c.notes?.split('\n').includes(childMarker));
        if (found) m = { google_id: found.id, google_list_id: target, version: 0 };
      }
      const childBody = {
        title: item.title,
        notes: childMarker,
        status: item.completed ? 'completed' : 'needsAction',
        completed: item.completed ? task.completedAt || new Date().toISOString() : null,
      };
      let childId = m?.google_id;
      if (childId) {
        try {
          await this.google.request(`${path}/${encodeURIComponent(childId)}`, 'PATCH', childBody);
        } catch (e) {
          if (e instanceof GoogleError && e.status === 404) childId = undefined;
          else throw e;
        }
      }
      if (!childId) {
        await this.beginCreate(id, target);
        childId = (
          await this.google.request<{ id: string }>(
            `${path}?parent=${encodeURIComponent(googleId)}${previous ? `&previous=${encodeURIComponent(previous)}` : ''}`,
            'POST',
            childBody,
          )
        ).id;
      }
      await this.remember(id, childId, target, task.version);
      previous = childId;
    }
    await this.remember(task.id, googleId, target, task.version);
  }
  async erase(id: string, mapping: Mapping) {
    let googleId = mapping.google_id;
    if (!googleId && mapping.attempt_started) {
      const candidates = await this.google.pages<{ id: string; notes?: string }>(
        `/tasks/v1/lists/${encodeURIComponent(mapping.google_list_id)}/tasks?maxResults=100&showCompleted=true&showHidden=true&updatedMin=${encodeURIComponent(mapping.attempt_started)}`,
      );
      googleId = candidates.find((t) => t.notes?.split('\n').includes(this.marker(id)))?.id || '';
    }
    if (googleId)
      try {
        await this.google.request(
          `/tasks/v1/lists/${encodeURIComponent(mapping.google_list_id)}/tasks/${encodeURIComponent(googleId)}`,
          'DELETE',
        );
      } catch (e) {
        if (!(e instanceof GoogleError && [404, 410].includes(e.status))) throw e;
      }
    await this.env.DB.prepare(
      'DELETE FROM google_mappings WHERE user_id=? AND (entity_id=? OR entity_id LIKE ?)',
    )
      .bind(this.userId, id, `${id}/check/%`)
      .run();
  }
  async series(task: Task) {
    const today = DateTime.now().setZone(task.timeZone).toISODate()!;
    const exceptionRows = await this.env.DB.prepare(
      'SELECT payload FROM tasks WHERE user_id=? AND series_id=?',
    )
      .bind(this.userId, task.id)
      .all<{ payload: string }>();
    const exceptions = exceptionRows.results.map((r) => JSON.parse(r.payload) as Task);
    const occurrences = expandTasks([task, ...exceptions], today, addDays(today, 91));
    // Remove future copies invalidated by a split/deletion, without touching completed history.
    const mappings = await this.env.DB.prepare(
      'SELECT entity_id,google_id,google_list_id,version,attempt_started FROM google_mappings WHERE user_id=? AND entity_id LIKE ?',
    )
      .bind(this.userId, `${task.id}@%`)
      .all<Mapping & { entity_id: string }>();
    const byId = new Map(mappings.results.map((m) => [m.entity_id, m]));
    const pending = occurrences
      .filter((t) => !byId.has(t.id) || byId.get(t.id)!.version < t.version)
      .map((t) => ({ id: t.id, version: t.version }));
    if (pending.length)
      await this.env.DB.prepare(
        "INSERT INTO outbox(user_id,entity_id,version) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.version') FROM json_each(?) WHERE true ON CONFLICT(user_id,entity_id) DO UPDATE SET version=excluded.version,next_attempt=0,error=NULL",
      )
        .bind(this.userId, JSON.stringify(pending))
        .run();
    let deleted = 0;
    for (const m of mappings.results) {
      if (m.entity_id.includes('/check/')) continue;
      const date = m.entity_id.split('@').pop()!;
      const exception = exceptions.find((t) => t.id === m.entity_id);
      if (exception?.completed) continue;
      if (task.deleted || (!occurrenceFor(task, date) && !exception)) {
        if (deleted++ >= 6) throw new SyncContinuation();
        await this.erase(m.entity_id, m);
      }
    }
  }
  async drain(limit = 1) {
    const user = await this.env.DB.prepare('SELECT email FROM user WHERE id=?')
      .bind(this.userId)
      .first<{ email: string }>();
    if (!user || !allowedEmail(this.env, user.email)) return;
    const now = Date.now();
    const owner = crypto.randomUUID();
    const lock = await this.env.DB.prepare(
      'INSERT INTO sync_locks(user_id,owner,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<?',
    )
      .bind(this.userId, owner, now + 120000, now)
      .run();
    if (!lock.meta.changes) return;
    try {
      const jobs = await this.env.DB.prepare(
        'SELECT entity_id,version,attempts FROM outbox WHERE user_id=? AND next_attempt<=? ORDER BY next_attempt LIMIT ?',
      )
        .bind(this.userId, now, limit)
        .all<{ entity_id: string; version: number; attempts: number }>();
      for (const job of jobs.results) {
        try {
          if (job.entity_id.startsWith('list:')) await this.syncList(job.entity_id.slice(5));
          else {
            const task = await this.repo.resolve(job.entity_id);
            if (task) {
              if (task.recurrence && !task.seriesId) await this.series(task);
              else await this.mirror(task);
            }
          }
          await this.env.DB.prepare(
            'DELETE FROM outbox WHERE user_id=? AND entity_id=? AND version=?',
          )
            .bind(this.userId, job.entity_id, job.version)
            .run();
          await this.env.DB.prepare(
            'INSERT INTO sync_state(user_id,reconnect) VALUES(?,0) ON CONFLICT(user_id) DO UPDATE SET reconnect=0',
          )
            .bind(this.userId)
            .run();
        } catch (error) {
          if (error instanceof SyncContinuation) {
            await this.env.DB.prepare(
              'UPDATE outbox SET next_attempt=?,error=NULL WHERE user_id=? AND entity_id=?',
            )
              .bind(Date.now() + 1000, this.userId, job.entity_id)
              .run();
            break;
          }
          const reconnect = error instanceof GoogleError && error.status === 401;
          const delay = reconnect
            ? 3600000
            : Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7));
          await this.env.DB.prepare(
            'UPDATE outbox SET attempts=attempts+1,next_attempt=?,error=? WHERE user_id=? AND entity_id=? AND version=?',
          )
            .bind(
              Date.now() + delay,
              reconnect
                ? 'Reconnect Google'
                : error instanceof GoogleError
                  ? error.reason
                  : 'Sync interrupted; retry scheduled',
              this.userId,
              job.entity_id,
              job.version,
            )
            .run();
          if (reconnect)
            await this.env.DB.prepare(
              'INSERT INTO sync_state(user_id,reconnect) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET reconnect=1',
            )
              .bind(this.userId)
              .run();
          console.warn(
            JSON.stringify({
              event: 'task_sync_failed',
              status: error instanceof GoogleError ? error.status : 503,
            }),
          );
          break;
        }
      }
    } finally {
      await this.env.DB.prepare('DELETE FROM sync_locks WHERE user_id=? AND owner=?')
        .bind(this.userId, owner)
        .run();
    }
  }
}
export async function scheduledSync(env: Env) {
  const emails = (env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length) return;
  const allowed = emails.map(() => '?').join(',');
  const today = new Date().toISOString().slice(0, 10);
  const recurring = await env.DB.prepare(
    `SELECT DISTINCT t.user_id FROM tasks t JOIN user u ON u.id=t.user_id LEFT JOIN sync_state s ON s.user_id=t.user_id WHERE t.recurring=1 AND t.deleted=0 AND (s.generated_on IS NULL OR s.generated_on<?) AND lower(u.email) IN (${allowed}) LIMIT 1`,
  )
    .bind(today, ...emails)
    .all<{ user_id: string }>();
  for (const { user_id } of recurring.results) {
    await env.DB.prepare(
      'INSERT INTO outbox(user_id,entity_id,version) SELECT user_id,id,version FROM tasks WHERE user_id=? AND recurring=1 AND deleted=0 ON CONFLICT(user_id,entity_id) DO UPDATE SET version=excluded.version,next_attempt=0,error=NULL',
    )
      .bind(user_id)
      .run();
    await env.DB.prepare(
      'INSERT INTO sync_state(user_id,generated_on) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET generated_on=excluded.generated_on',
    )
      .bind(user_id, today)
      .run();
  }
  if (recurring.results.length) return;
  const ready = await env.DB.prepare(
    `SELECT o.user_id FROM outbox o JOIN user u ON u.id=o.user_id WHERE o.next_attempt<=? AND lower(u.email) IN (${allowed}) ORDER BY o.next_attempt LIMIT 1`,
  )
    .bind(Date.now(), ...emails)
    .first<{ user_id: string }>();
  if (ready) await new TaskSync(env, ready.user_id).drain(1);
}
