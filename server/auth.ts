import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import { allowedEmail, type Env } from './env';

const authCache = new WeakMap<D1Database, ReturnType<typeof buildAuth>>();
export function makeAuth(env: Env) {
  let auth = authCache.get(env.DB);
  if (!auth) {
    auth = buildAuth(env);
    authCache.set(env.DB, auth);
  }
  return auth;
}
function buildAuth(env: Env) {
  return betterAuth({
    appName: 'Daymark',
    baseURL: env.APP_URL!,
    secret: env.BETTER_AUTH_SECRET!,
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: 'sqlite', schema }),
    trustedOrigins: [
      env.APP_URL!,
      ...(env.APP_URL?.startsWith('http://localhost:') ? ['http://localhost:5173'] : []),
    ],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        accessType: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
          'https://www.googleapis.com/auth/tasks',
        ],
      },
    },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    advanced: {
      useSecureCookies: env.APP_URL?.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    rateLimit: { enabled: true, window: 60, max: 40 },
    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            if (!data.emailVerified || !allowedEmail(env, data.email))
              throw new APIError('FORBIDDEN', {
                message: 'This calendar is invitation-only. You can still try the public demo.',
              });
            return { data };
          },
        },
      },
      session: {
        create: {
          before: async (data) => {
            const u = await env.DB.prepare('SELECT email, email_verified FROM user WHERE id = ?')
              .bind(data.userId)
              .first<{ email: string; email_verified: number }>();
            if (!u || !u.email_verified || !allowedEmail(env, u.email))
              throw new APIError('FORBIDDEN', {
                message: 'This account is not on the invitation list.',
              });
            return { data };
          },
          after: async (data) => {
            await env.DB.batch([
              env.DB.prepare('UPDATE sync_state SET reconnect=0 WHERE user_id=?').bind(data.userId),
              env.DB.prepare(
                'UPDATE outbox SET next_attempt=0,attempts=0,error=NULL WHERE user_id=?',
              ).bind(data.userId),
            ]);
          },
        },
      },
    },
    logger: { disabled: true },
  });
}
