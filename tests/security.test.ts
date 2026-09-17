import { beforeEach, describe, it, expect, vi } from 'vitest';
import { testDatabase } from './d1';
import type { Env } from '../server/env';
import { allowedEmail } from '../server/env';
import { Repository } from '../server/repository';
import { task } from './fixtures';

vi.mock('../server/auth', () => ({
  makeAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get('x-test-user');
        return id
          ? { user: { id, name: id, email: `${id}@example.com`, emailVerified: true } }
          : null;
      },
    },
    handler: () => new Response('{}'),
  }),
}));
vi.mock('../server/sync', () => ({
  TaskSync: class {
    async drain() {}
  },
  scheduledSync: async () => {},
}));
import { app } from '../server/index';
describe('API privacy boundary', () => {
  let env: Env, id: string;
  beforeEach(async () => {
    const { db } = await testDatabase();
    env = {
      DB: db,
      ASSETS: {} as Fetcher,
      APP_URL: 'https://calendar.example',
      BETTER_AUTH_SECRET: 'test-secret-not-for-deployment',
      GOOGLE_CLIENT_ID: 'test',
      GOOGLE_CLIENT_SECRET: 'test',
      ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
    };
    const repo = new Repository(db, 'alice');
    await repo.saveList({ id: 'school', name: 'School', color: '#77946d' });
    id = (await repo.save(task())).id;
  });
  const headers = (user = 'alice') => ({
    'x-test-user': user,
    Origin: 'https://calendar.example',
    'Content-Type': 'application/json',
  });
  it('rejects anonymous, unapproved and cross-origin requests', async () => {
    expect((await app.request('/api/tasks', {}, env)).status).toBe(401);
    expect((await app.request('/api/tasks', { headers: headers('mallory') }, env)).status).toBe(
      401,
    );
    expect(
      (
        await app.request(
          '/api/tasks',
          { method: 'POST', headers: { ...headers(), Origin: 'https://evil.example' }, body: '{}' },
          env,
        )
      ).status,
    ).toBe(403);
    expect(allowedEmail(env, 'ALICE@example.com')).toBe(true);
  });
  it('blocks cross-account reads and writes even when an ID is known', async () => {
    expect((await app.request(`/api/tasks/${id}`, { headers: headers('bob') }, env)).status).toBe(
      404,
    );
    expect(
      (
        await app.request(
          `/api/tasks/${id}`,
          {
            method: 'PUT',
            headers: headers('bob'),
            body: JSON.stringify({ task: task(), version: 1 }),
          },
          env,
        )
      ).status,
    ).toBe(404);
    const response = await app.request('/api/tasks', { headers: headers('bob') }, env);
    expect(await response.json()).toMatchObject({ tasks: [] });
  });
  it('does not expose provider tokens or private responses through public auth routes or caches', async () => {
    expect(
      (
        await app.request(
          '/api/auth/get-access-token',
          { method: 'POST', headers: headers(), body: '{}' },
          env,
        )
      ).status,
    ).toBe(404);
    expect((await app.request('/api/auth/list-accounts', { headers: headers() }, env)).status).toBe(
      404,
    );
    const response = await app.request(`/api/tasks/${id}`, { headers: headers() }, env);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const exported = await app.request('/api/export', { headers: headers() }, env);
    expect(await exported.text()).not.toMatch(/test-secret|GOOGLE_CLIENT|refresh_token/);
  });
});
