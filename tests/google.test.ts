import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Google, GoogleError } from '../server/google';
import { TaskSync } from '../server/sync';
import { Repository } from '../server/repository';
import { testDatabase } from './d1';
import { task } from './fixtures';
import type { Env } from '../server/env';
import type { CalendarEvent, EventInput } from '../src/shared/model';

describe('Google event integration', () => {
  const env = {} as Env;
  afterEach(() => vi.restoreAllMocks());
  it('follows every page of visible events and preserves calendar identity', async () => {
    const google = new Google(env, 'alice');
    vi.spyOn(google, 'accessToken').mockResolvedValue('test-token');
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ items: [{ id: 'one', status: 'confirmed' }], nextPageToken: 'page-two' }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            { id: 'two', status: 'confirmed' },
            { id: 'gone', status: 'cancelled' },
          ],
        }),
      );
    const events = await google.events(
      'my-calendar',
      '2026-09-01',
      '2026-10-01',
      'America/New_York',
    );
    expect(events.map((e) => e.id)).toEqual(['one', 'two']);
    expect(events.every((e) => e.calendarId === 'my-calendar')).toBe(true);
    expect(String(fetcher.mock.calls[0][0])).toContain('singleEvents=true');
    expect(String(fetcher.mock.calls[1][0])).toContain('pageToken=page-two');
    expect(String(fetcher.mock.calls[0][0])).toContain('timeMin=2026-09-01');
  });
  it('preserves attendee responses and uses an etag for guest-affecting edits', async () => {
    const google = new Google(env, 'alice');
    vi.spyOn(google, 'writable').mockResolvedValue();
    const existing: CalendarEvent = {
      id: 'event',
      calendarId: 'cal',
      summary: 'Old name',
      start: { dateTime: '2026-09-16T11:00:00-04:00' },
      end: { dateTime: '2026-09-16T12:00:00-04:00' },
      etag: 'revision-1',
      organizer: { self: true },
      attendees: [{ email: 'guest@example.com', responseStatus: 'accepted', displayName: 'Guest' }],
    };
    vi.spyOn(google, 'getEvent').mockResolvedValue(existing);
    const request = vi
      .spyOn(google, 'request')
      .mockResolvedValue({ ...existing, summary: 'Updated' });
    const input: EventInput = {
      summary: 'Updated',
      description: '',
      location: '',
      start: existing.start,
      end: existing.end,
      attendees: [{ email: 'guest@example.com' }],
      transparency: 'opaque',
      visibility: 'default',
      colorId: '4',
    };
    await google.editEvent({
      calendarId: 'cal',
      id: 'event',
      input,
      etag: 'revision-1',
      scope: 'one',
      sendUpdates: 'all',
      createMeet: true,
      requestId: crypto.randomUUID(),
    });
    expect(request.mock.calls[0][0]).toContain('sendUpdates=all');
    expect(request.mock.calls[0][3]).toBe('revision-1');
    expect(request.mock.calls[0][2]).toMatchObject({
      colorId: '4',
      attendees: [{ responseStatus: 'accepted' }],
      conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    });
    await expect(
      google.editEvent({
        calendarId: 'cal',
        id: 'event',
        input,
        etag: 'stale',
        scope: 'one',
        sendUpdates: 'all',
        createMeet: false,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rejects edits to read-only calendars', async () => {
    const google = new Google(env, 'alice');
    vi.spyOn(google, 'calendars').mockResolvedValue([
      { id: 'read-only', summary: 'Shared', backgroundColor: '#000000', accessRole: 'reader' },
    ]);
    await expect(google.writable('read-only')).rejects.toMatchObject({ status: 403 });
  });
  it('updates only the current attendee when responding to an invitation', async () => {
    const google = new Google(env, 'alice');
    vi.spyOn(google, 'getEvent').mockResolvedValue({
      id: 'invite',
      calendarId: 'cal',
      summary: 'Invite',
      start: { date: '2026-09-16' },
      end: { date: '2026-09-17' },
      etag: 'r1',
      attendees: [
        { email: 'alice@example.com', self: true },
        { email: 'other@example.com', responseStatus: 'accepted' },
      ],
    });
    const request = vi.spyOn(google, 'request').mockResolvedValue({});
    await google.rsvp('cal', 'invite', 'tentative', 'r1');
    expect(request.mock.calls[0][2]).toMatchObject({
      attendees: [{ email: 'alice@example.com', responseStatus: 'tentative' }],
      attendeesOmitted: true,
    });
  });
});
describe('outbound task synchronization', () => {
  let env: Env, repo: Repository, sync: TaskSync;
  let remote: Map<string, Record<string, unknown>>;
  let createCalls: number;
  beforeEach(async () => {
    const { db } = await testDatabase();
    env = {
      DB: db,
      ASSETS: {} as Fetcher,
      APP_URL: 'https://calendar.example',
      ALLOWED_EMAILS: 'alice@example.com',
    };
    repo = new Repository(db, 'alice');
    await repo.saveList({ id: 'school', name: 'School', color: '#77946d' });
    await db
      .prepare('UPDATE task_lists SET google_id=? WHERE id=?')
      .bind('google-list', 'school')
      .run();
    sync = new TaskSync(env, 'alice');
    remote = new Map();
    createCalls = 0;
    vi.spyOn(sync.google, 'request').mockImplementation(
      async <T>(path: string, method = 'GET', body?: unknown) => {
        if (path.includes('/users/@me/lists/')) return { id: 'google-list' } as T;
        if (method === 'GET') return { items: [...remote.values()] } as T;
        if (method === 'POST') {
          const id = `remote-${++createCalls}`;
          const item = { ...(body as object), id };
          remote.set(id, item);
          return item as T;
        }
        const id = path.split('/').pop()!;
        if (method === 'DELETE') {
          remote.delete(id);
          return undefined as T;
        }
        const item = { ...remote.get(id), ...(body as object), id };
        remote.set(id, item);
        return item as T;
      },
    );
  });
  afterEach(() => vi.restoreAllMocks());
  it('creates one copy, updates completion, and deletes the same mapped task', async () => {
    const saved = await repo.save(task());
    await sync.mirror(saved);
    expect(createCalls).toBe(1);
    const completed = await repo.save({ ...saved, completed: true }, saved.id, saved.version);
    await sync.mirror(completed);
    expect(createCalls).toBe(1);
    expect([...remote.values()][0]).toMatchObject({
      status: 'completed',
      due: '2026-09-12T00:00:00.000Z',
    });
    await repo.remove(saved.id);
    await sync.mirror((await repo.get(saved.id))!);
    expect(remote.size).toBe(0);
  });
  it('reconciles a successful insert whose response was lost without creating a duplicate', async () => {
    const saved = await repo.save(task());
    const original = vi.mocked(sync.google.request).getMockImplementation()!;
    let lost = false;
    vi.spyOn(sync.google, 'request').mockImplementation(
      async <T>(path: string, method = 'GET', body?: unknown) => {
        const result = await original(path, method, body);
        if (method === 'POST' && !lost) {
          lost = true;
          throw new TypeError('Network response lost');
        }
        return result as T;
      },
    );
    await expect(sync.mirror(saved)).rejects.toThrow('Network response lost');
    expect(createCalls).toBe(1);
    await sync.mirror(saved);
    expect(createCalls).toBe(1);
    expect(await sync.mapping(saved.id)).not.toBeNull();
  });
  it('keeps local tasks and queues a reconnect when authorization expires', async () => {
    const saved = await repo.save(task());
    vi.spyOn(sync.google, 'request').mockRejectedValue(new GoogleError(401, 'Reconnect Google'));
    await sync.drain();
    expect(await repo.get(saved.id)).not.toBeNull();
    const state = await env.DB.prepare('SELECT reconnect FROM sync_state WHERE user_id=?')
      .bind('alice')
      .first<{ reconnect: number }>();
    expect(state?.reconnect).toBe(1);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) n FROM outbox WHERE user_id=?')
        .bind('alice')
        .first<{ n: number }>())!.n,
    ).toBeGreaterThan(0);
  });
  it('checkpoints large checklists and resumes without recreating finished children', async () => {
    const saved = await repo.save(
      task({
        checklist: Array.from({ length: 8 }, (_, i) => ({
          id: `step-${i}`,
          title: `Step ${i}`,
          completed: false,
        })),
      }),
    );
    await expect(sync.mirror(saved)).rejects.toBeInstanceOf(Error);
    expect(createCalls).toBe(7);
    await sync.mirror(saved);
    expect(createCalls).toBe(9);
    expect((await sync.mapping(saved.id))?.version).toBe(saved.version);
  });
});
