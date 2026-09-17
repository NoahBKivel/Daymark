import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { deleteDemoEvent, demoEventRange, saveDemoEvent } from '../src/demo-events';
import { eventInputSchema, type CalendarEvent } from '../src/shared/model';

const series = (): CalendarEvent => ({
  id: 'demo-series',
  calendarId: 'personal',
  summary: 'Study group',
  start: { dateTime: '2026-10-26T10:00:00-04:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-10-26T11:00:00-04:00', timeZone: 'America/New_York' },
  recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
  reminders: {
    useDefault: false,
    overrides: [
      { method: 'email', minutes: 120 },
      { method: 'popup', minutes: 10 },
    ],
  },
});
const range = (rows: CalendarEvent[]) => demoEventRange(rows, '2026-10-01', '2026-12-01');

describe('browser-only recurring events', () => {
  it('expands repeated events at the same wall time across daylight saving', () => {
    const events = range([series()]);
    expect(events).toHaveLength(4);
    expect(
      events.map((e) => DateTime.fromISO(e.start.dateTime!, { zone: 'America/New_York' }).hour),
    ).toEqual([10, 10, 10, 10]);
    expect(events[0].start.dateTime).toContain('-04:00');
    expect(events[1].start.dateTime).toContain('-05:00');
  });
  it('edits one occurrence and preserves all existing reminders', () => {
    const events = range([series()]);
    const input = eventInputSchema.parse({
      ...events[1],
      summary: 'Moved study group',
      reminders: undefined,
    });
    const result = saveDemoEvent([series()], input, 'personal', events[1].id, 'one');
    const updated = range(result.rows);
    expect(updated).toHaveLength(4);
    expect(updated.filter((e) => e.summary === 'Moved study group')).toHaveLength(1);
    expect(result.event.reminders).toEqual(series().reminders);
  });
  it('splits following occurrences while retaining history and the remaining count', () => {
    const events = range([series()]);
    const input = eventInputSchema.parse({ ...events[2], summary: 'New study group' });
    const result = saveDemoEvent([series()], input, 'personal', events[2].id, 'following');
    const updated = range(result.rows);
    expect(updated).toHaveLength(4);
    expect(updated.filter((e) => e.summary === 'Study group')).toHaveLength(2);
    expect(updated.filter((e) => e.summary === 'New study group')).toHaveLength(2);
  });
  it('deletes an occurrence, following occurrences, or a whole series independently', () => {
    const events = range([series()]);
    expect(range(deleteDemoEvent([series()], events[1], 'one'))).toHaveLength(3);
    expect(range(deleteDemoEvent([series()], events[2], 'following'))).toHaveLength(2);
    expect(range(deleteDemoEvent([series()], events[0], 'following'))).toHaveLength(0);
    expect(range(deleteDemoEvent([series()], events[2], 'all'))).toHaveLength(0);
  });
});
