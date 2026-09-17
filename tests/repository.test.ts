import { beforeEach, describe, it, expect } from 'vitest';
import { Repository } from '../server/repository';
import { task } from './fixtures';
import { testDatabase } from './d1';
import { backupSchema } from '../src/shared/model';

describe('owned task storage', () => {
  let alice: Repository,
    bob: Repository,
    sqlite: Awaited<ReturnType<typeof testDatabase>>['sqlite'];
  beforeEach(async () => {
    const result = await testDatabase();
    sqlite = result.sqlite;
    alice = new Repository(result.db, 'alice');
    bob = new Repository(result.db, 'bob');
    await alice.saveList({ id: 'school', name: 'School', color: '#77946d' });
    await bob.saveList({ id: 'bob-list', name: 'Personal', color: '#77946d' });
  });
  it('never exposes another user’s tasks or accepts their list', async () => {
    const saved = await alice.save(task());
    expect(await bob.get(saved.id)).toBeNull();
    expect(await bob.range('2026-09-01', '2026-10-01')).toEqual([]);
    await expect(bob.save(task())).rejects.toMatchObject({ status: 404 });
    await expect(
      bob.saveList({ id: 'school', name: 'Stolen', color: '#000000' }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('stores the task and sync operation atomically and rejects stale updates', async () => {
    const saved = await alice.save(task());
    expect(
      (await alice.db.prepare('SELECT * FROM outbox WHERE entity_id=?').bind(saved.id).all())
        .results,
    ).toHaveLength(1);
    const completed = await alice.save({ ...saved, completed: true }, saved.id, saved.version);
    expect(completed.completedAt).toBeTruthy();
    expect(completed.dueDate).toBe('2026-09-12');
    await expect(
      alice.save({ ...saved, title: 'stale' }, saved.id, saved.version),
    ).rejects.toMatchObject({ status: 409 });
    expect((await alice.get(saved.id))?.completed).toBe(true);
  });
  it('retains history, uses an ownership/date index, and paginates task browsing', async () => {
    for (let i = 0; i < 55; i++)
      await alice.save(
        task({
          title: `Task ${i}`,
          dueDate: i === 0 ? '2020-01-01' : '2026-09-12',
          startDate: null,
        }),
      );
    expect(await alice.range('2026-09-01', '2026-10-01')).toHaveLength(54);
    const first = await alice.search('', 'all', undefined, 0);
    expect(first.tasks).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect((await alice.search('', 'all', undefined, 1)).tasks).toHaveLength(5);
    const plan = sqlite.exec(
      "EXPLAIN QUERY PLAN SELECT payload FROM tasks WHERE user_id='alice' AND recurring=0 AND deleted=0 AND due_date>='2026-09-01' AND COALESCE(start_date,due_date)<'2026-10-01'",
    );
    expect(JSON.stringify(plan)).toContain('tasks_owner_range');
  });
  it('does not regenerate moved or deleted recurring instances', async () => {
    await alice.save(
      task({
        startDate: null,
        dueDate: '2026-09-01',
        recurrence: { frequency: 'weekly', interval: 1, weekdays: [], until: null, count: 4 },
      }),
      'weekly',
    );
    const dates = await alice.range('2026-09-01', '2026-10-01');
    await alice.save({ ...dates[1], dueDate: '2026-12-01' }, dates[1].id, dates[1].version);
    await alice.remove(dates[2].id);
    expect((await alice.range('2026-09-01', '2026-10-01')).map((t) => t.dueDate)).toEqual([
      '2026-09-01',
      '2026-09-22',
    ]);
    expect((await alice.range('2026-12-01', '2027-01-01')).map((t) => t.dueDate)).toContain(
      '2026-12-01',
    );
  });
  it('splits a repeating task while preserving completed history', async () => {
    await alice.save(
      task({
        startDate: null,
        dueDate: '2026-09-01',
        recurrence: { frequency: 'weekly', interval: 1, weekdays: [], until: null, count: 4 },
      }),
      'weekly',
    );
    const dates = await alice.range('2026-09-01', '2026-10-01');
    await alice.save({ ...dates[0], completed: true }, dates[0].id, dates[0].version);
    await alice.save(
      { ...dates[2], title: 'Updated homework' },
      dates[2].id,
      dates[2].version,
      'following',
    );
    const changed = await alice.range('2026-09-01', '2026-10-01');
    expect(changed).toHaveLength(4);
    expect(changed[0].completed).toBe(true);
    expect(changed.slice(2).every((t) => t.title === 'Updated homework')).toBe(true);
  });
  it('round-trips complete task data into an empty account without credentials', async () => {
    const original = await alice.save(
      task({
        completed: true,
        checklist: [{ id: 'check-1', title: 'First step', completed: true }],
      }),
    );
    const backup = backupSchema.parse(await alice.export());
    expect(JSON.stringify(backup)).not.toMatch(/access_token|refresh_token|google_id/);
    await bob.restore(backup);
    const imported = await bob.range('2026-09-01', '2026-10-01');
    expect(imported).toHaveLength(1);
    expect(imported[0].title).toBe(original.title);
    expect(imported[0].completedAt).toBe(original.completedAt);
    expect(imported[0].checklist).toEqual(original.checklist);
    expect(imported[0].id).not.toBe(original.id);
    await expect(bob.restore(backup)).rejects.toMatchObject({ status: 409 });
  });
  it('keeps a first-occurrence split exportable and gives panel rows independent identities', async () => {
    const series = await alice.save(
      task({
        startDate: null,
        dueDate: '2026-09-01',
        recurrence: { frequency: 'weekly', interval: 1, weekdays: [], until: null, count: 4 },
      }),
      'weekly',
    );
    const first = (await alice.range('2026-09-01', '2026-10-01'))[0];
    await alice.save({ ...first, title: 'New series title' }, first.id, first.version, 'following');
    expect(backupSchema.safeParse(await alice.export()).success).toBe(true);
    const panel = await alice.search('New series', 'open', undefined, 0);
    expect(panel.tasks).toHaveLength(4);
    expect(panel.tasks.every((t) => !!t.seriesId && t.id.includes('@'))).toBe(true);
    expect(panel.tasks.every((t) => t.id !== series.id)).toBe(true);
  });
});
