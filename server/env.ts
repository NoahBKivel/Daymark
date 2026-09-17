export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_URL?: string;
  APP_NAME?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ALLOWED_EMAILS?: string;
};
export function configured(env: Env) {
  return !!(
    env.APP_URL &&
    env.BETTER_AUTH_SECRET &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.ALLOWED_EMAILS
  );
}
export function allowedEmail(env: Env, email: string) {
  return (env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase());
}
