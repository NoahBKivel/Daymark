import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { refreshUntouchedDemo, seedDemo } from '../src/demo';

describe('saved demo samples', () => {
  const before = DateTime.fromISO('2026-09-16T12:00:00', { zone: 'America/New_York' });
  const now = before.plus({ months: 1 });
  it('refreshes untouched prior-month samples and preserves settings', () => {
    const state = JSON.parse(JSON.stringify(seedDemo(before)));
    state.settings.hour24 = true;
    const updated = refreshUntouchedDemo(state, now);
    expect(updated.tasks).toEqual(seedDemo(now).tasks);
    expect(updated.events).toEqual(seedDemo(now).events);
    expect(updated.settings.hour24).toBe(true);
  });
  it('refreshes untouched samples while retaining edits, additions, and deletions', () => {
    const state = seedDemo(before);
    state.tasks[0].title = 'My edited task';
    const customTask = { ...state.tasks[0], id: 'my-task' };
    state.tasks.push(customTask);
    const deletedEvent = state.events.pop()!;
    const updated = refreshUntouchedDemo(state, now);
    expect(updated.tasks[0]).toEqual(state.tasks[0]);
    expect(updated.tasks.at(-1)).toEqual(customTask);
    expect(updated.events.some((event) => event.id === deletedEvent.id)).toBe(false);
    expect(updated.tasks.find((task) => task.id === 'demo-math')).toEqual(
      seedDemo(now).tasks.find((task) => task.id === 'demo-math'),
    );
    expect(updated.events[0]).toEqual(seedDemo(now).events[0]);
    const following = now.plus({ months: 1 });
    const again = refreshUntouchedDemo(updated, following);
    expect(again.tasks[0]).toEqual(state.tasks[0]);
    expect(again.tasks.find((task) => task.id === 'demo-math')).toEqual(
      seedDemo(following).tasks.find((task) => task.id === 'demo-math'),
    );
  });
  it('refreshes legacy saved workspaces without a seed timestamp', () => {
    const state = seedDemo(before);
    delete state.seededAt;
    state.tasks.push({ ...state.tasks[0], id: 'custom' });
    const updated = refreshUntouchedDemo(state, now);
    expect(updated.tasks.find((task) => task.id === 'demo-math')?.dueDate).toBe('2026-10-17');
    expect(updated.tasks.at(-1)).toEqual(state.tasks.at(-1));
  });
  it('keeps current-month samples unchanged', () => {
    const state = seedDemo(now);
    expect(refreshUntouchedDemo(state, now.plus({ days: 1 }))).toBe(state);
  });
});
