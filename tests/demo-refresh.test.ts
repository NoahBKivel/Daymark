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
  it('preserves edits, added tasks, and deleted events across month changes', () => {
    for (const change of [
      (state: ReturnType<typeof seedDemo>) => { state.tasks[0].title = 'My edited task'; },
      (state: ReturnType<typeof seedDemo>) => { state.tasks.push({ ...state.tasks[0], id: 'my-task' }); },
      (state: ReturnType<typeof seedDemo>) => { state.events.pop(); },
    ]) {
      const state = seedDemo(before);
      change(state);
      expect(refreshUntouchedDemo(state, now)).toBe(state);
    }
  });
  it('keeps current-month samples unchanged', () => {
    const state = seedDemo(now);
    expect(refreshUntouchedDemo(state, now.plus({ days: 1 }))).toBe(state);
  });
});
