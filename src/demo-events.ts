import { DateTime } from 'luxon';
import { RRule } from 'rrule';
import type { CalendarEvent, EventDate, EventInput } from './shared/model';
import { addDays, daysBetween, eventOverlaps } from './shared/dates';

function localDate(value: EventDate, zone: string) {
  return value.date || DateTime.fromISO(value.dateTime!, { zone }).toISODate()!;
}
function shift(value: EventDate, days: number, zone: string): EventDate {
  return value.date
    ? { date: addDays(value.date, days) }
    : { ...value, dateTime: DateTime.fromISO(value.dateTime!, { zone }).plus({ days }).toISO()! };
}
function rule(event: CalendarEvent) {
  const zone = event.start.timeZone || 'UTC';
  const anchor = localDate(event.start, zone);
  return new RRule({
    ...RRule.parseString(event.recurrence!.find((r) => r.startsWith('RRULE:'))!),
    dtstart: new Date(`${anchor}T00:00:00Z`),
  });
}
export function demoEventRange(rows: CalendarEvent[], start: string, end: string) {
  const overrides = new Set(rows.filter((e) => e.recurringEventId).map((e) => e.id));
  const events: CalendarEvent[] = [];
  for (const event of rows) {
    if (event.status === 'cancelled') continue;
    if (event.recurringEventId || !event.recurrence?.some((r) => r.startsWith('RRULE:'))) {
      if (eventOverlaps(event, start, end)) events.push(event);
      continue;
    }
    const zone = event.start.timeZone || 'UTC';
    const anchor = localDate(event.start, zone);
    const duration = daysBetween(anchor, localDate(event.end, zone));
    for (const d of rule(event).between(
      new Date(`${addDays(start, -duration - 1)}T00:00:00Z`),
      new Date(`${end}T00:00:00Z`),
      true,
    )) {
      const date = d.toISOString().slice(0, 10);
      const id = `${event.id}@${date}`;
      if (overrides.has(id)) continue;
      const offset = daysBetween(anchor, date);
      const occurrence: CalendarEvent = {
        ...event,
        id,
        recurringEventId: event.id,
        start: shift(event.start, offset, zone),
        end: shift(event.end, offset, zone),
        originalStartTime: shift(event.start, offset, zone),
        recurrence: undefined,
      };
      if (eventOverlaps(occurrence, start, end)) events.push(occurrence);
    }
  }
  return events;
}
function resolve(rows: CalendarEvent[], id: string) {
  const stored = rows.find((e) => e.id === id);
  if (stored) return stored;
  const divider = id.lastIndexOf('@');
  if (divider < 0) return undefined;
  const date = id.slice(divider + 1);
  return demoEventRange(rows, date, addDays(date, 1)).find((e) => e.id === id);
}
function trim(rows: CalendarEvent[], master: CalendarEvent, cutoff: string) {
  const zone = master.start.timeZone || 'UTC';
  if (cutoff === localDate(master.start, zone)) master.status = 'cancelled';
  else
    master.recurrence = master.recurrence?.map((r) =>
      r.startsWith('RRULE:')
        ? `${r.replace(/;(COUNT|UNTIL)=[^;]+/g, '')};UNTIL=${addDays(cutoff, -1).replaceAll('-', '')}T235959Z`
        : r,
    );
  for (const row of rows) {
    if (row.recurringEventId === master.id && localDate(row.originalStartTime!, zone) >= cutoff)
      row.status = 'cancelled';
  }
}
export function saveDemoEvent(
  rows: CalendarEvent[],
  input: EventInput,
  calendarId: string,
  id: string,
  scope: string,
) {
  const prior = resolve(rows, id);
  let target = prior;
  let fields = { ...input };
  let savedId = id;
  if (prior?.recurringEventId && scope !== 'one') {
    const master = rows.find((e) => e.id === prior.recurringEventId)!;
    const zone = master.start.timeZone || 'UTC';
    const cutoff = localDate(prior.originalStartTime!, zone);
    if (scope === 'all') {
      const offset = daysBetween(cutoff, localDate(master.start, zone));
      fields = {
        ...fields,
        start: shift(input.start, offset, zone),
        end: shift(input.end, offset, zone),
      };
      target = master;
      savedId = master.id;
    } else {
      let recurrence = input.recurrence ?? master.recurrence;
      const options = rule(master).options;
      if (input.recurrence === undefined && options.count) {
        const before = rule(master).between(
          options.dtstart,
          new Date(`${addDays(cutoff, -1)}T23:59:59Z`),
          true,
        ).length;
        recurrence = recurrence?.map((r) =>
          r.replace(/COUNT=\d+/, `COUNT=${Math.max(1, options.count! - before)}`),
        );
      }
      trim(rows, master, cutoff);
      fields = { ...fields, recurrence };
      target = master;
      savedId = crypto.randomUUID();
    }
  }
  const cleanFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  const event: CalendarEvent = {
    ...target,
    ...cleanFields,
    start: fields.start,
    end: fields.end,
    summary: fields.summary,
    calendarId,
    id: savedId,
    organizer: { self: true },
    etag: crypto.randomUUID(),
    status: 'confirmed',
    ...(savedId !== prior?.id ? { recurringEventId: undefined, originalStartTime: undefined } : {}),
  };
  return { rows: [...rows.filter((e) => e.id !== savedId), event], event };
}
export function deleteDemoEvent(rows: CalendarEvent[], event: CalendarEvent, scope: string) {
  if (event.recurringEventId && scope !== 'one') {
    const master = rows.find((e) => e.id === event.recurringEventId)!;
    if (scope === 'all')
      return rows.filter((e) => e.id !== master.id && e.recurringEventId !== master.id);
    trim(rows, master, localDate(event.originalStartTime!, master.start.timeZone || 'UTC'));
    return rows;
  }
  return [...rows.filter((e) => e.id !== event.id), { ...event, status: 'cancelled' }];
}
