import { HTTPException } from 'hono/http-exception';
import { DateTime } from 'luxon';
import { makeAuth } from './auth';
import type { Env } from './env';
import type { CalendarInfo, CalendarEvent, EventInput, EditScope } from '../src/shared/model';

export class GoogleError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}
export class Google {
  private token?: string;
  constructor(
    readonly env: Env,
    readonly userId: string,
  ) {}
  async accessToken() {
    if (this.token) return this.token;
    const account = await this.env.DB.prepare(
      'SELECT id FROM account WHERE user_id=? AND provider_id=?',
    )
      .bind(this.userId, 'google')
      .first<{ id: string }>();
    if (!account) throw new GoogleError(401, 'Reconnect your Google account.');
    try {
      const result = await makeAuth(this.env).api.getAccessToken({
        body: { accountId: account.id, userId: this.userId },
      });
      this.token = result.accessToken;
      if (!this.token) throw new Error('Missing token');
      return this.token;
    } catch {
      throw new GoogleError(401, 'Reconnect your Google account to resume syncing.');
    }
  }
  async request<T>(path: string, method = 'GET', body?: unknown, etag?: string): Promise<T> {
    const response = await fetch(`https://www.googleapis.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
        ...(etag ? { 'If-Match': etag } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      // Never forward Google's raw response, which can contain private event data.
      const reason =
        response.status === 401
          ? 'Reconnect your Google account.'
          : response.status === 403
            ? 'Google denied access. Check calendar permissions and API configuration.'
            : response.status === 404 || response.status === 410
              ? 'This Google item no longer exists.'
              : response.status === 412
                ? 'This event changed elsewhere. Reload it before saving.'
                : response.status === 429
                  ? 'Google is busy. Sync will retry shortly.'
                  : 'Google is temporarily unavailable. Please retry.';
      throw new GoogleError(response.status, reason);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
  async pages<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const result = await this.request<{ items?: T[]; nextPageToken?: string }>(
        path +
          (pageToken
            ? `${path.includes('?') ? '&' : '?'}pageToken=${encodeURIComponent(pageToken)}`
            : ''),
      );
      items.push(...(result.items || []));
      pageToken = result.nextPageToken;
    } while (pageToken);
    return items;
  }
  async calendars(): Promise<CalendarInfo[]> {
    return this.pages<CalendarInfo>('/calendar/v3/users/me/calendarList?maxResults=250');
  }
  async events(
    calendarId: string,
    start: string,
    end: string,
    timeZone: string,
  ): Promise<CalendarEvent[]> {
    const query = new URLSearchParams({
      timeMin: DateTime.fromISO(start, { zone: timeZone }).toISO()!,
      timeMax: DateTime.fromISO(end, { zone: timeZone }).toISO()!,
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '2500',
      timeZone,
    });
    return (
      await this.pages<CalendarEvent>(
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
      )
    )
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({ ...e, calendarId }));
  }
  eventPath(calendarId: string, id?: string) {
    return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${id ? `/${encodeURIComponent(id)}` : ''}`;
  }
  async writable(calendarId: string) {
    const list = await this.calendars();
    const calendar = list.find((c) => c.id === calendarId);
    if (!calendar || !['owner', 'writer'].includes(calendar.accessRole))
      throw new HTTPException(403, { message: 'This calendar is read-only.' });
  }
  async getEvent(calendarId: string, id: string) {
    return { ...(await this.request<CalendarEvent>(this.eventPath(calendarId, id))), calendarId };
  }
  async editEvent(args: {
    calendarId: string;
    id?: string;
    input: EventInput;
    etag?: string;
    scope: EditScope;
    sendUpdates: 'all' | 'none';
    createMeet: boolean;
    requestId: string;
  }): Promise<CalendarEvent> {
    const { calendarId, input, scope, sendUpdates, createMeet } = args;
    await this.writable(calendarId);
    let current = args.id ? await this.getEvent(calendarId, args.id) : undefined;
    if (current && args.etag && current.etag !== args.etag)
      throw new HTTPException(409, {
        message: 'This event changed elsewhere. Reload it before saving.',
      });
    if (current?.eventType && current.eventType !== 'default')
      throw new HTTPException(403, { message: 'Edit this special event in Google Calendar.' });
    if (current?.organizer && !current.organizer.self && !current.guestsCanModify)
      throw new HTTPException(403, {
        message: 'Only the organizer can edit this event. You can update your RSVP.',
      });
    if (current?.recurringEventId && scope === 'following')
      return this.splitEvent(current, input, sendUpdates, createMeet, args.requestId);
    if (current?.recurringEventId && scope === 'all') {
      const selected = current;
      current = await this.getEvent(calendarId, current.recurringEventId);
      // Apply time/duration changes to the original series date, not the selected occurrence's date.
      const from = selected.start.date || selected.start.dateTime!;
      const to = input.start.date || input.start.dateTime!;
      const zone = current.start.timeZone || selected.start.timeZone || 'UTC';
      const shift = DateTime.fromISO(to, { zone }).diff(DateTime.fromISO(from, { zone }));
      const duration = DateTime.fromISO(input.end.date || input.end.dateTime!, { zone }).diff(
        DateTime.fromISO(to, { zone }),
      );
      const newStart = DateTime.fromISO(current.start.date || current.start.dateTime!, {
        zone,
      }).plus(shift);
      input.start = input.start.date
        ? { date: newStart.toISODate()! }
        : { dateTime: newStart.toISO()!, timeZone: zone };
      input.end = input.end.date
        ? { date: newStart.plus(duration).toISODate()! }
        : { dateTime: newStart.plus(duration).toISO()!, timeZone: zone };
    }
    const body: Record<string, unknown> = { ...input };
    if (current) {
      const wasAllDay = !!current.start.date;
      const isAllDay = !!input.start.date;
      if (wasAllDay !== isAllDay) {
        body.start = isAllDay
          ? { ...input.start, dateTime: null, timeZone: null }
          : { ...input.start, date: null };
        body.end = isAllDay
          ? { ...input.end, dateTime: null, timeZone: null }
          : { ...input.end, date: null };
      }
      body.attendees = input.attendees.map((a) => ({
        ...current!.attendees?.find((old) => old.email.toLowerCase() === a.email.toLowerCase()),
        ...a,
      }));
      if (scope === 'one' && current.recurringEventId) delete body.recurrence;
    }
    if (createMeet)
      body.conferenceData = {
        createRequest: {
          requestId: args.requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    const query = new URLSearchParams({ sendUpdates, conferenceDataVersion: '1' });
    if (current)
      return {
        ...(await this.request<CalendarEvent>(
          `${this.eventPath(calendarId, current.id)}?${query}`,
          'PATCH',
          body,
          current.etag,
        )),
        calendarId,
      };
    body.id = args.requestId.replaceAll('-', '');
    try {
      return {
        ...(await this.request<CalendarEvent>(
          `${this.eventPath(calendarId)}?${query}`,
          'POST',
          body,
        )),
        calendarId,
      };
    } catch (e) {
      if (e instanceof GoogleError && e.status === 409)
        return this.getEvent(calendarId, body.id as string);
      throw e;
    }
  }
  async splitEvent(
    selected: CalendarEvent,
    input: EventInput,
    sendUpdates: 'all' | 'none',
    createMeet: boolean,
    requestId: string,
  ): Promise<CalendarEvent> {
    const master = await this.getEvent(selected.calendarId, selected.recurringEventId!);
    const cutoff =
      selected.originalStartTime?.dateTime ||
      selected.originalStartTime?.date ||
      selected.start.dateTime ||
      selected.start.date!;
    const zone = master.start.timeZone || 'UTC';
    if (
      DateTime.fromISO(cutoff, { zone }).toMillis() ===
      DateTime.fromISO(master.start.dateTime || master.start.date!, { zone }).toMillis()
    )
      return this.editEvent({
        calendarId: selected.calendarId,
        id: master.id,
        input,
        etag: master.etag,
        scope: 'all',
        sendUpdates,
        createMeet,
        requestId,
      });
    const until = DateTime.fromISO(cutoff, { zone })
      .toUTC()
      .minus({ seconds: 1 })
      .toFormat("yyyyMMdd'T'HHmmss'Z'");
    const oldRules = master.recurrence || [];
    const truncated = oldRules.map((r) =>
      r.startsWith('RRULE:') ? r.replace(/;(COUNT|UNTIL)=[^;]+/g, '') + `;UNTIL=${until}` : r,
    );
    const freshRules = input.recurrence || oldRules;
    // COUNT applies to the entire original series. Deduct earlier instances for the new series.
    const countMatch = oldRules.join('').match(/COUNT=(\d+)/);
    if (countMatch && freshRules.some((r) => r.includes(`COUNT=${countMatch[1]}`))) {
      const before = await this.pages<CalendarEvent>(
        `${this.eventPath(selected.calendarId, master.id)}/instances?showDeleted=true&maxResults=2500&timeMax=${encodeURIComponent(DateTime.fromISO(cutoff, { zone }).toISO()!)}`,
      );
      const remaining = Math.max(1, Number(countMatch[1]) - before.length);
      for (let i = 0; i < freshRules.length; i++)
        freshRules[i] = freshRules[i].replace(/COUNT=\d+/, `COUNT=${remaining}`);
    }
    await this.request(
      `${this.eventPath(selected.calendarId, master.id)}?sendUpdates=${sendUpdates}`,
      'PATCH',
      { recurrence: truncated },
      master.etag,
    );
    try {
      return await this.editEvent({
        calendarId: selected.calendarId,
        input: { ...input, recurrence: freshRules },
        scope: 'one',
        sendUpdates,
        createMeet,
        requestId,
      });
    } catch (e) {
      // Restore the original rule only if no concurrent edit happened after our truncation.
      const latest = await this.getEvent(selected.calendarId, master.id);
      if (JSON.stringify(latest.recurrence) === JSON.stringify(truncated))
        await this.request(
          this.eventPath(selected.calendarId, master.id),
          'PATCH',
          { recurrence: oldRules },
          latest.etag,
        );
      throw e;
    }
  }
  async deleteEvent(
    calendarId: string,
    id: string,
    scope: EditScope,
    sendUpdates: 'all' | 'none',
    etag?: string,
  ) {
    await this.writable(calendarId);
    let e = await this.getEvent(calendarId, id);
    if (etag && e.etag !== etag)
      throw new HTTPException(409, { message: 'This event changed elsewhere. Reload it first.' });
    if (e.recurringEventId && scope !== 'one') {
      const selected = e;
      e = await this.getEvent(calendarId, e.recurringEventId);
      if (scope === 'following') {
        const cutoff =
          selected.originalStartTime?.dateTime ||
          selected.originalStartTime?.date ||
          selected.start.dateTime ||
          selected.start.date!;
        if (
          DateTime.fromISO(cutoff, { zone: e.start.timeZone || 'UTC' }).toMillis() ===
          DateTime.fromISO(e.start.dateTime || e.start.date!, {
            zone: e.start.timeZone || 'UTC',
          }).toMillis()
        )
          return this.request(
            `${this.eventPath(calendarId, e.id)}?sendUpdates=${sendUpdates}`,
            'DELETE',
            undefined,
            e.etag,
          );
        const until = DateTime.fromISO(cutoff, { zone: e.start.timeZone || 'UTC' })
          .toUTC()
          .minus({ seconds: 1 })
          .toFormat("yyyyMMdd'T'HHmmss'Z'");
        return this.request(
          `${this.eventPath(calendarId, e.id)}?sendUpdates=${sendUpdates}`,
          'PATCH',
          {
            recurrence: e.recurrence?.map((r) =>
              r.startsWith('RRULE:')
                ? r.replace(/;(COUNT|UNTIL)=[^;]+/g, '') + `;UNTIL=${until}`
                : r,
            ),
          },
          e.etag,
        );
      }
    }
    return this.request(
      `${this.eventPath(calendarId, e.id)}?sendUpdates=${sendUpdates}`,
      'DELETE',
      undefined,
      e.etag,
    );
  }
  async rsvp(
    calendarId: string,
    id: string,
    status: 'accepted' | 'declined' | 'tentative',
    etag?: string,
  ) {
    const e = await this.getEvent(calendarId, id);
    if (etag && etag !== e.etag)
      throw new HTTPException(409, { message: 'This event changed elsewhere.' });
    const self = e.attendees?.find((a) => a.self);
    if (!self)
      throw new HTTPException(400, { message: 'You are not an attendee on this invitation.' });
    return this.request(
      `${this.eventPath(calendarId, id)}?sendUpdates=all`,
      'PATCH',
      { attendees: [{ ...self, responseStatus: status }], attendeesOmitted: true },
      e.etag,
    );
  }
}
