import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { addDays, expandTasks, isOverdue, isPastEvent, taskOverlaps } from '../src/shared/dates';
import { taskInputSchema, type CalendarEvent } from '../src/shared/model';
import { task } from './fixtures';
describe('calendar date boundaries', () => {
  it('includes ranges which cross or entirely span the visible month', () => {
    for (const [startDate, dueDate] of [
      ['2026-08-20', '2026-09-05'],
      ['2026-09-28', '2026-10-08'],
      ['2026-07-01', '2026-11-01'],
    ])
      expect(taskOverlaps(task({ startDate, dueDate }), '2026-09-01', '2026-10-01')).toBe(true);
    expect(
      taskOverlaps(
        task({ startDate: '2026-08-01', dueDate: '2026-08-31' }),
        '2026-09-01',
        '2026-10-01',
      ),
    ).toBe(false);
    expect(
      taskOverlaps(task({ startDate: null, dueDate: '2026-10-01' }), '2026-09-01', '2026-10-01'),
    ).toBe(false);
  });
  it('keeps completed tasks on their scheduled dates', () => {
    expect(
      expandTasks(
        [task({ completed: true, completedAt: '2026-09-20T16:00:00Z' })],
        '2026-09-01',
        '2026-10-01',
      ),
    ).toHaveLength(1);
  });
  it('uses the task timezone at midnight and across daylight saving', () => {
    const t = task({ dueDate: '2026-03-08' });
    expect(isOverdue(t, DateTime.fromISO('2026-03-09T03:59:59Z'))).toBe(false);
    expect(isOverdue(t, DateTime.fromISO('2026-03-09T04:00:00Z'))).toBe(true);
    const timed = task({ dueDate: '2026-11-01', dueTime: '09:00' });
    expect(isOverdue(timed, DateTime.fromISO('2026-11-01T13:59:59Z'))).toBe(false);
    expect(isOverdue(timed, DateTime.fromISO('2026-11-01T14:00:00Z'))).toBe(true);
    expect(isOverdue({ ...timed, completed: true }, DateTime.fromISO('2027-01-01'))).toBe(false);
  });
  it('marks timed and all-day events as past at their exclusive end boundary', () => {
    const timed: CalendarEvent = {
      id: 'timed',
      calendarId: 'calendar',
      summary: 'Timed event',
      start: { dateTime: '2026-09-23T10:00:00-04:00' },
      end: { dateTime: '2026-09-23T11:00:00-04:00' },
    };
    expect(isPastEvent(timed, DateTime.fromISO('2026-09-23T14:59:59Z'))).toBe(false);
    expect(isPastEvent(timed, DateTime.fromISO('2026-09-23T15:00:00Z'))).toBe(true);

    const allDay: CalendarEvent = {
      ...timed,
      id: 'all-day',
      summary: 'All-day event',
      start: { date: '2026-09-23' },
      end: { date: '2026-09-24' },
    };
    expect(isPastEvent(allDay, DateTime.fromISO('2026-09-24T03:59:59Z'), 'America/New_York')).toBe(
      false,
    );
    expect(isPastEvent(allDay, DateTime.fromISO('2026-09-24T04:00:00Z'), 'America/New_York')).toBe(
      true,
    );
  });
  it('validates actual dates, deadline ordering, and optional time requirements', () => {
    expect(taskInputSchema.safeParse(task({ dueDate: '2026-02-30' })).success).toBe(false);
    expect(taskInputSchema.safeParse(task({ startDate: '2026-10-01' })).success).toBe(false);
    expect(
      taskInputSchema.safeParse(task({ startDate: null, dueDate: null, dueTime: '12:00' })).success,
    ).toBe(false);
    expect(taskInputSchema.safeParse(task({ startDate: null, dueDate: null })).success).toBe(true);
  });
});
describe('task recurrence', () => {
  it('skips missing monthly dates and keeps the same task duration', () => {
    const t = task({
      startDate: '2026-01-29',
      dueDate: '2026-01-31',
      recurrence: { frequency: 'monthly', interval: 1, weekdays: [], until: null, count: 4 },
    });
    const dates = expandTasks([t], '2026-01-01', '2026-08-01');
    expect(dates.map((t) => t.dueDate)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
    expect(dates[1].startDate).toBe('2026-03-29');
  });
  it('includes a recurring task beginning in the range and ending after it', () => {
    const t = task({
      startDate: '2026-09-28',
      dueDate: '2026-10-02',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [], until: null, count: 2 },
    });
    expect(expandTasks([t], '2026-09-01', '2026-10-01')).toHaveLength(1);
  });
  it('keeps individual completion and moved/deleted exceptions separate', () => {
    const base = task({
      startDate: null,
      dueDate: '2026-09-01',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [], until: null, count: 4 },
    });
    const [first, second, third] = expandTasks([base], '2026-09-01', '2026-10-01');
    const result = expandTasks(
      [
        base,
        { ...first, completed: true },
        { ...second, dueDate: '2026-10-08' },
        { ...third, deleted: true },
      ],
      '2026-09-01',
      '2026-10-01',
    );
    expect(result.map((t) => t.dueDate)).toEqual(['2026-09-01', '2026-09-22']);
    expect(result[0].completed).toBe(true);
    expect(result[1].completed).toBe(false);
  });
  it('crosses leap years and year boundaries without shifting date-only values', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
