import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { eventInputSchema, type CalendarEvent } from '../src/shared/model';
import { eventOverlaps, isInstantEvent } from '../src/shared/dates';
import { demoEventRange, saveDemoEvent } from '../src/demo-events';
const marker = (): CalendarEvent => ({
  id: 'marker',
  calendarId: 'personal',
  summary: 'Remember this',
  start: { dateTime: '2026-11-03T11:00:00-05:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-11-03T11:00:00-05:00', timeZone: 'America/New_York' },
});
describe('events without a duration', () => {
  it('accepts identical instants and rejects reversed times and empty all-day ranges', () => {
    expect(eventInputSchema.safeParse(marker()).success).toBe(true);
    expect(isInstantEvent({ ...marker(), end: { dateTime: '2026-11-03T16:00:00Z' } })).toBe(true);
    expect(
      eventInputSchema.safeParse({ ...marker(), end: { dateTime: '2026-11-03T10:59:00-05:00' } })
        .success,
    ).toBe(false);
    expect(
      eventInputSchema.safeParse({
        ...marker(),
        start: { date: '2026-11-03' },
        end: { date: '2026-11-03' },
      }).success,
    ).toBe(false);
  });
  it('includes a midnight marker at the range start and excludes the range end', () => {
    const midnight = {
      ...marker(),
      start: { dateTime: '2026-11-03T00:00:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-03T00:00:00-05:00' },
    };
    expect(eventOverlaps(midnight, '2026-11-03', '2026-11-04')).toBe(true);
    expect(eventOverlaps(midnight, '2026-11-02', '2026-11-03')).toBe(false);
  });
  it('saves and expands recurring markers without introducing a duration', () => {
    const input = eventInputSchema.parse({ ...marker(), recurrence: ['RRULE:FREQ=DAILY;COUNT=3'] });
    const saved = saveDemoEvent([], input, 'personal', 'marker', 'one');
    const events = demoEventRange(saved.rows, '2026-11-03', '2026-11-06');
    expect(events).toHaveLength(3);
    expect(events.every(isInstantEvent)).toBe(true);
    expect(
      events.map(
        (event) => DateTime.fromISO(event.start.dateTime!, { zone: 'America/New_York' }).hour,
      ),
    ).toEqual([11, 11, 11]);
  });
});
