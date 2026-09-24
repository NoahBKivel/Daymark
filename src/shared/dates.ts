import { DateTime } from 'luxon';
import { RRule } from 'rrule';
import type { Task, Recurrence, CalendarEvent } from './model';

export const addDays = (date: string, days: number) =>
  DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate()!;
export const daysBetween = (a: string, b: string) =>
  Math.round(
    DateTime.fromISO(b, { zone: 'UTC' }).diff(DateTime.fromISO(a, { zone: 'UTC' }), 'days').days,
  );
export const taskStart = (t: Task) => t.startDate || t.dueDate;
export const overlaps = (
  start: string,
  endExclusive: string,
  rangeStart: string,
  rangeEnd: string,
) => start < rangeEnd && endExclusive > rangeStart;
export const taskOverlaps = (t: Task, start: string, end: string) =>
  !!t.dueDate && overlaps(taskStart(t)!, addDays(t.dueDate, 1), start, end);
export function isOverdue(t: Task, now: DateTime = DateTime.now()): boolean {
  if (t.completed || !t.dueDate) return false;
  const deadline = t.dueTime
    ? DateTime.fromISO(`${t.dueDate}T${t.dueTime}`, { zone: t.timeZone })
    : DateTime.fromISO(t.dueDate, { zone: t.timeZone }).plus({ days: 1 });
  return now.toMillis() >= deadline.toMillis();
}
export function isPastEvent(
  event: CalendarEvent,
  now: DateTime = DateTime.now(),
  displayTimeZone = 'local',
): boolean {
  if (event.end.dateTime) return now.toMillis() >= DateTime.fromISO(event.end.dateTime).toMillis();
  if (!event.end.date) return false;
  const zone = event.end.timeZone || event.start.timeZone || displayTimeZone;
  return now.toMillis() >= DateTime.fromISO(event.end.date, { zone }).toMillis();
}
const frequencies = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};
const weekdays = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];
export function taskRule(anchor: string, recurrence: Recurrence) {
  return new RRule({
    freq: frequencies[recurrence.frequency],
    interval: recurrence.interval,
    dtstart: new Date(`${anchor}T00:00:00Z`),
    ...(recurrence.count ? { count: recurrence.count } : {}),
    ...(recurrence.until ? { until: new Date(`${recurrence.until}T23:59:59Z`) } : {}),
    ...(recurrence.frequency === 'weekly' && recurrence.weekdays.length
      ? { byweekday: recurrence.weekdays.map((d) => weekdays[d]) }
      : {}),
  });
}
export function expandTasks(rows: Task[], start: string, end: string): Task[] {
  const exceptions = new Map(
    rows.filter((t) => t.seriesId).map((t) => [`${t.seriesId}@${t.originalDate}`, t]),
  );
  const result: Task[] = [];
  for (const task of rows) {
    if (task.seriesId || task.deleted) continue;
    if (!task.recurrence || !task.dueDate) {
      if (taskOverlaps(task, start, end)) result.push(task);
      continue;
    }
    const duration = task.startDate ? daysBetween(task.startDate, task.dueDate) : 0;
    const dates = taskRule(task.dueDate, task.recurrence).between(
      new Date(`${start}T00:00:00Z`),
      new Date(`${addDays(end, duration)}T00:00:00Z`),
      true,
    );
    for (const d of dates) {
      const date = d.toISOString().slice(0, 10);
      if (task.excludedDates?.includes(date)) continue;
      const id = `${task.id}@${date}`;
      if (exceptions.has(id)) continue;
      const occurrence: Task = {
        ...task,
        id,
        seriesId: task.id,
        originalDate: date,
        dueDate: date,
        startDate: task.startDate ? addDays(date, -duration) : null,
        completed: false,
        completedAt: null,
        checklist: task.checklist.map((i) => ({ ...i, completed: false })),
      };
      if (taskOverlaps(occurrence, start, end)) result.push(occurrence);
    }
  }
  for (const t of exceptions.values())
    if (!t.deleted && taskOverlaps(t, start, end)) result.push(t);
  return result.sort(
    (a, b) =>
      (taskStart(a) || '').localeCompare(taskStart(b) || '') || a.title.localeCompare(b.title),
  );
}
export function occurrenceFor(series: Task, date: string): Task | undefined {
  return expandTasks([series], date, addDays(date, 1)).find((t) => t.originalDate === date);
}
export function eventOverlaps(e: CalendarEvent, start: string, end: string): boolean {
  return overlaps(
    e.start.date || e.start.dateTime || '',
    e.end.date || e.end.dateTime || '',
    start,
    end,
  );
}
export function formatTime(iso: string, timeZone: string, hour24 = false) {
  return DateTime.fromISO(iso)
    .setZone(timeZone)
    .toFormat(hour24 ? 'HH:mm' : 'h:mm a');
}
export function recurrenceLabel(r: Recurrence | null) {
  if (!r) return 'Does not repeat';
  const words = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
  return r.interval === 1
    ? `Every ${words[r.frequency]}`
    : `Every ${r.interval} ${words[r.frequency]}s`;
}
