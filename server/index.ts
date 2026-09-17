import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, ZodError } from 'zod';
import { DateTime } from 'luxon';
import { makeAuth } from './auth';
import { allowedEmail, configured, type Env } from './env';
import { Repository } from './repository';
import { Google, GoogleError } from './google';
import { TaskSync, scheduledSync } from './sync';
import {
  backupSchema,
  dateSchema,
  eventInputSchema,
  listInputSchema,
  settingsSchema,
  taskInputSchema,
  type SessionUser,
  type CalendarEvent,
} from '../src/shared/model';

type AppEnv = { Bindings: Env; Variables: { user: SessionUser; repo: Repository } };
const app = new Hono<AppEnv>();
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'private, no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const expected = c.env.APP_URL || new URL(c.req.url).origin;
    const origin = c.req.header('Origin');
    if (
      origin !== expected &&
      !(expected.startsWith('http://localhost:') && origin === 'http://localhost:5173')
    )
      return c.json({ error: 'Request origin is not allowed.' }, 403);
    if (Number(c.req.header('Content-Length') || 0) > 5_000_000)
      return c.json({ error: 'Upload is too large.' }, 413);
  }
  await next();
});
app.get('/api/config', (c) => c.json({ configured: configured(c.env), appName: 'Daymark' }));
// Token/account endpoints remain server-only, even though the auth library provides public handlers.
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  if (!configured(c.env))
    return c.json({ error: 'Google sign-in has not been configured yet.' }, 503);
  const path = c.req.path.slice('/api/auth/'.length);
  if (!['sign-in/social', 'callback/google', 'sign-out', 'error'].includes(path))
    return c.json({ error: 'Not found' }, 404);
  return makeAuth(c.env).handler(c.req.raw);
});
app.use('/api/*', async (c, next) => {
  if (!configured(c.env)) return c.json({ error: 'Sign in to use your private calendar.' }, 401);
  const session = await makeAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user || !session.user.emailVerified || !allowedEmail(c.env, session.user.email))
    return c.json({ error: 'Sign in with an invited Google account.' }, 401);
  c.set('user', session.user);
  c.set('repo', new Repository(c.env.DB, session.user.id));
  await next();
});
app.get('/api/me', async (c) => {
  const repo = c.get('repo');
  await repo.ensureList();
  const saved = await c.env.DB.prepare('SELECT 1 AS found FROM settings WHERE user_id=?')
    .bind(c.get('user').id)
    .first();
  return c.json({ user: c.get('user'), settings: await repo.settings(), hasSettings: !!saved });
});
app.get('/api/lists', async (c) => c.json(await c.get('repo').lists()));
app.post('/api/lists', async (c) =>
  c.json(
    await c
      .get('repo')
      .saveList({ ...listInputSchema.parse(await c.req.json()), id: crypto.randomUUID() }),
  ),
);
app.put('/api/lists/:id', async (c) =>
  c.json(
    await c
      .get('repo')
      .saveList({ ...listInputSchema.parse(await c.req.json()), id: c.req.param('id') }),
  ),
);
app.delete('/api/lists/:id', async (c) => {
  await c.get('repo').deleteList(c.req.param('id'));
  return c.json({ ok: true });
});
app.get('/api/settings', async (c) => c.json(await c.get('repo').settings()));
app.put('/api/settings', async (c) =>
  c.json(await c.get('repo').saveSettings(settingsSchema.parse(await c.req.json()))),
);
app.get('/api/calendars', async (c) =>
  c.json(await new Google(c.env, c.get('user').id).calendars()),
);
app.get('/api/range', async (c) => {
  const { start, end } = z.object({ start: dateSchema, end: dateSchema }).parse(c.req.query());
  if (start >= end || DateTime.fromISO(end).diff(DateTime.fromISO(start), 'days').days > 93)
    throw new HTTPException(400, { message: 'Choose a date range of up to 93 days.' });
  const repo = c.get('repo');
  const tasks = await repo.range(start, end);
  const events: CalendarEvent[] = [];
  const errors: string[] = [];
  const google = new Google(c.env, c.get('user').id);
  const settings = await repo.settings();
  try {
    const calendars = await google.calendars();
    const requested = (c.req.query('calendars') || '').split(',').filter(Boolean);
    const selected = calendars.filter((cal) => !requested.length || requested.includes(cal.id));
    // Bound parallel calls to stay below Workers' concurrent connection limit.
    for (let i = 0; i < selected.length; i += 3) {
      const results = await Promise.allSettled(
        selected.slice(i, i + 3).map((cal) => google.events(cal.id, start, end, settings.timeZone)),
      );
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') events.push(...r.value);
        else
          errors.push(
            `${selected[i + j].summary}: ${r.reason instanceof GoogleError ? r.reason.reason : 'Could not load events.'}`,
          );
      });
    }
  } catch (e) {
    errors.push(
      e instanceof GoogleError
        ? e.reason
        : 'Google events are temporarily unavailable. Your tasks are still available.',
    );
  }
  return c.json({ tasks, events, errors });
});
app.get('/api/tasks', async (c) => {
  const q = z
    .string()
    .max(500)
    .parse(c.req.query('q') || '');
  const filter = z
    .enum(['all', 'open', 'completed', 'undated', 'overdue'])
    .parse(c.req.query('filter') || 'all');
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000)
    .parse(c.req.query('page') || 0);
  return c.json(await c.get('repo').search(q, filter, c.req.query('listId'), page));
});
app.get('/api/tasks/:id', async (c) => {
  const t = await c.get('repo').resolve(c.req.param('id'));
  if (!t || t.deleted) throw new HTTPException(404);
  return c.json(t);
});
const taskMutationSchema = z.object({
  task: taskInputSchema,
  version: z.number().int().optional(),
  scope: z.enum(['one', 'following']).default('one'),
});
app.post('/api/tasks', async (c) => {
  const input = taskMutationSchema.parse(await c.req.json());
  const task = await c.get('repo').save(input.task);
  c.executionCtx.waitUntil(new TaskSync(c.env, c.get('user').id).drain());
  return c.json(task);
});
app.put('/api/tasks/:id', async (c) => {
  const input = taskMutationSchema.parse(await c.req.json());
  if (input.version === undefined)
    throw new HTTPException(400, { message: 'A task version is required.' });
  if (!(await c.get('repo').resolve(c.req.param('id')))) throw new HTTPException(404);
  const task = await c.get('repo').save(input.task, c.req.param('id'), input.version, input.scope);
  c.executionCtx.waitUntil(new TaskSync(c.env, c.get('user').id).drain());
  return c.json(task);
});
app.delete('/api/tasks/:id', async (c) => {
  const input = z
    .object({
      scope: z.enum(['one', 'following']).default('one'),
      version: z.number().int().optional(),
    })
    .parse(await c.req.json());
  await c.get('repo').remove(c.req.param('id'), input.scope, input.version);
  c.executionCtx.waitUntil(new TaskSync(c.env, c.get('user').id).drain());
  return c.json({ ok: true });
});
const eventMutationSchema = z.object({
  input: eventInputSchema,
  etag: z.string().optional(),
  scope: z.enum(['one', 'following', 'all']).default('one'),
  sendUpdates: z.enum(['all', 'none']).default('all'),
  createMeet: z.boolean().default(false),
  requestId: z.string().uuid(),
});
app.get('/api/events/:calendar/:id', async (c) =>
  c.json(
    await new Google(c.env, c.get('user').id).getEvent(c.req.param('calendar'), c.req.param('id')),
  ),
);
app.post('/api/events/:calendar', async (c) =>
  c.json(
    await new Google(c.env, c.get('user').id).editEvent({
      ...eventMutationSchema.parse(await c.req.json()),
      calendarId: c.req.param('calendar'),
    }),
  ),
);
app.put('/api/events/:calendar/:id', async (c) =>
  c.json(
    await new Google(c.env, c.get('user').id).editEvent({
      ...eventMutationSchema.parse(await c.req.json()),
      calendarId: c.req.param('calendar'),
      id: c.req.param('id'),
    }),
  ),
);
app.delete('/api/events/:calendar/:id', async (c) => {
  const body = z
    .object({
      etag: z.string().optional(),
      scope: z.enum(['one', 'following', 'all']).default('one'),
      sendUpdates: z.enum(['all', 'none']).default('all'),
    })
    .parse(await c.req.json());
  await new Google(c.env, c.get('user').id).deleteEvent(
    c.req.param('calendar'),
    c.req.param('id'),
    body.scope,
    body.sendUpdates,
    body.etag,
  );
  return c.json({ ok: true });
});
app.post('/api/events/:calendar/:id/rsvp', async (c) => {
  const input = z
    .object({ status: z.enum(['accepted', 'declined', 'tentative']), etag: z.string().optional() })
    .parse(await c.req.json());
  return c.json(
    await new Google(c.env, c.get('user').id).rsvp(
      c.req.param('calendar'),
      c.req.param('id'),
      input.status,
      input.etag,
    ),
  );
});
app.get('/api/sync', async (c) => {
  const counts = await c.env.DB.prepare(
    'SELECT COUNT(*) pending,SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) failed FROM outbox WHERE user_id=?',
  )
    .bind(c.get('user').id)
    .first<{ pending: number; failed: number | null }>();
  const state = await c.env.DB.prepare('SELECT reconnect FROM sync_state WHERE user_id=?')
    .bind(c.get('user').id)
    .first<{ reconnect: number }>();
  return c.json({
    pending: counts?.pending || 0,
    failed: counts?.failed || 0,
    reconnect: !!state?.reconnect,
  });
});
app.post('/api/sync/retry', async (c) => {
  await c.env.DB.prepare('UPDATE outbox SET next_attempt=0,attempts=0,error=NULL WHERE user_id=?')
    .bind(c.get('user').id)
    .run();
  c.executionCtx.waitUntil(new TaskSync(c.env, c.get('user').id).drain());
  return c.json({ ok: true });
});
app.post('/api/sync/pump', async (c) => {
  c.executionCtx.waitUntil(new TaskSync(c.env, c.get('user').id).drain(1));
  return c.json({ ok: true });
});
app.get('/api/export', async (c) => {
  c.header('Content-Disposition', 'attachment; filename="daymark-backup.json"');
  return c.json(await c.get('repo').export());
});
app.post('/api/restore', async (c) => {
  const backup = backupSchema.parse(await c.req.json());
  await c.get('repo').restore(backup);
  c.executionCtx.waitUntil(new TaskSync(c.env, c.get('user').id).drain());
  return c.json({ ok: true });
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  if (error instanceof ZodError)
    return c.json({ error: error.issues.map((i) => i.message).join('. ') }, 400);
  if (error instanceof HTTPException)
    return c.json({ error: error.message || 'Request could not be completed.' }, error.status);
  if (error instanceof GoogleError)
    return c.json(
      { error: error.reason, reconnect: error.status === 401 },
      error.status === 412 ? 409 : error.status === 401 ? 401 : 502,
    );
  console.error(
    JSON.stringify({ event: 'request_failed', path: c.req.routePath || '/api', status: 500 }),
  );
  return c.json({ error: 'Something went wrong. Your saved data has not been cleared.' }, 500);
});
export { app };
export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    if (configured(env)) ctx.waitUntil(scheduledSync(env));
  },
};
