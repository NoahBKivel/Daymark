# Daymark

A private calendar with Google events and multi-day tasks, plus an interactive public demo. Tasks keep their original dates after completion. Task ranges, recurrence history, colors, and checklists belong to Daymark; Google receives supported task fields as a one-way copy.

Public deployment: [Daymark](https://daymark.calendarview.workers.dev). Google sign-in is disabled until the owner supplies the Google OAuth configuration and invitation allowlist. The published demo uses fictional browser-local data.

Production Google redirect URI: `https://daymark.calendarview.workers.dev/api/auth/callback/google`. Production privacy page: [Privacy](https://daymark.calendarview.workers.dev/privacy).

## Run locally

Use Node 24 (Node 22+ is required for the Cloudflare CLI).

```sh
npm ci
npm run dev
```

`npm run dev` starts both the local backend and Vite frontend, applies pending local database migrations, and waits for the backend before serving the interface at `http://localhost:5173`. Ctrl+C stops both servers. If either server stops, the other is shut down too. Ports 5173 and 8787 must be free; stop any earlier dev servers first. No remote database is modified.

The launcher requires Node 22.12+ and can use the compatible bundled Codex runtime if the default Node is older. You can explicitly select a runtime with `CALENDAR_NODE`. On other computers, install Node 24. `npm run dev:frontend` and `npm run worker:dev` remain available for running each server separately.

Without local Google configuration, the app shows its fictional demo, stored under `daymark.demo.v1` in this browser. It does not send demo tasks or events to Google. Local Google login requires a separate development OAuth client configured in `.dev.vars`; `.env.google.local` is for production setup and is not loaded by the development launcher.

For the full Worker, copy `.dev.vars.example` to `.dev.vars`, fill in the values locally, and run:

```sh
npm run build
npm run db:local
npm run worker:dev
```

The complete app runs at `http://localhost:8787`. Vite proxies `/api` to that Worker during frontend development. Never commit `.dev.vars`.

## Google setup

1. Create a Google Cloud project for production and another for development. Enable Google Calendar API and Google Tasks API.
2. Configure Google Auth Platform with an External audience. Personal use and a few personally known friends can use Google's verification exception. Unverified-app warnings and Google's user cap still apply.
3. Add these scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/tasks`.
4. Create a Web application OAuth client. Set the authorized redirect URI to `https://YOUR-WORKER.workers.dev/api/auth/callback/google`. Use `http://localhost:8787/api/auth/callback/google` for the separate development client. The app URL is the HTTPS homepage; the privacy URL is `/privacy`.
5. For ongoing personal use, change the production project's OAuth publishing status to **In production**. Calendar/Tasks refresh tokens from a project left in **Testing** expire after seven days. Production publishing status does not itself mean Google has verified the app.
6. Set the Worker secrets below. Google login stays disabled until the configuration is complete. Do not send a Google password or paste secrets into an issue or commit.

```sh
node scripts/cloudflare.mjs secret put APP_URL
node scripts/cloudflare.mjs secret put BETTER_AUTH_SECRET
node scripts/cloudflare.mjs secret put GOOGLE_CLIENT_ID
node scripts/cloudflare.mjs secret put GOOGLE_CLIENT_SECRET
node scripts/cloudflare.mjs secret put ALLOWED_EMAILS
```

`APP_URL` is the exact HTTPS deployment origin, with no trailing slash. `BETTER_AUTH_SECRET` must be an unpredictable secret of at least 32 characters. It encrypts provider tokens as well as signing sessions; retain it securely. Changing it invalidates sessions and can require everyone to reconnect Google. `ALLOWED_EMAILS` is a comma-separated list of invited Google addresses. The verified email is checked both at account creation and on every private API request.

No public password registration or token-retrieval endpoint is enabled. Google OAuth refresh and access tokens stay encrypted in D1 and are decrypted only on the server. Google scopes authorize broader operations than the app's one-way Tasks policy; Daymark itself does not import Google-created tasks.

## Deployment

The project uses a dedicated D1 database, specified in `wrangler.jsonc`, and Worker static assets. It does not use GitHub Pages. To install a separate copy in another Cloudflare account, create a new database and replace its ID first.

The deployment account is pinned in `wrangler.jsonc` and `scripts/cloudflare.mjs`. Local deployment commands use `scripts/cloudflare.mjs`, which loads the ignored `.env.cloudflare.local` file and explicitly overrides inherited Cloudflare credentials for its child process. This prevents another project's globally configured token from taking precedence. The token needs Account / Workers Scripts / Edit, Account / D1 / Edit, and Account / Account Settings / Read permissions, restricted to this account. GitHub Actions uses its repository secrets and the same pinned account ID instead.

Browser-local demo changes remain in the browser storage for their original website address and can be transferred using task export/restore.

```sh
npm run build
npm run db:remote
node scripts/cloudflare.mjs deploy
```

GitHub Actions runs type checking, unit/integration tests, the production build, and browser tests. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository Actions secrets to enable automatic deployment after successful checks on `main`. The Google secrets belong in Cloudflare, not GitHub. The pipeline never publishes pull requests.

No paid resources are enabled by the application. Free-tier quotas still apply. Task sync handles small batches, checkpointing subtask progress so large checklists can continue on another invocation. A five-minute scheduled Worker extends the recurring task export window and retries queued operations. While the app is open, pending work also advances through authenticated, bounded requests.

## Behavior and data

- Date ranges use an exclusive end internally. A task due September 12 occupies September 12; its calendar end is September 13.
- Completed tasks remain visible by default. Actual completion time is independent of the scheduled dates.
- Task recurrence supports daily/weekly/monthly/yearly intervals, selected weekdays, and count/date endings. Missing month dates are skipped. Each occurrence has a stable ID and may have its own completion or edit exception.
- Editing following task occurrences splits the rule and retains prior history. Checklist items have no independent calendar dates.
- Overdue indicators use the task's saved timezone. Date-only deadlines become overdue at the next local midnight. There are no task notifications.
- Calendar loads are limited to the visible grid. Navigation reuses fresh, non-invalidated range caches. Google events are paginated and refreshed every minute while visible.
- The task panel searches stored history and expands recurring tasks through the next 90 days. Farther-future recurring tasks are available by navigating the calendar.
- Google Calendar remains authoritative for events. Edits use etags and preserve untouched provider fields. Calendar permissions and organizer restrictions are enforced on the server.
- Google Tasks stores the deadline's **date**, not its time or full date range. App-owned Google lists contain a short stable identifier for recovery. Recurring copies are generated through the next 90 days; explicitly edited occurrences outside that window are also copied.
- Sync operations are committed with local task changes. Ambiguous task insert responses are reconciled using a stable app link and the attempt timestamp before creation is retried. Google task changes are not imported.
- Backups contain task data and settings, not sessions, Google events, provider IDs, or credentials. Private-account restore requires an empty task account; demo restore replaces the browser's demo tasks.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
node scripts/verify-deployment.mjs
```

Browser tests use installed Microsoft Edge on Windows. On other systems, install Playwright Chromium with `npx playwright install chromium`. SQLite tests execute the real migration and SQL using `sql.js`, including ownership checks, transactional writes, interval filtering, query plans, recurrence exceptions, and export/restore. Google API tests mock provider responses and cover pagination, attendee preservation, conflict detection, and uncertain task creation responses.

Real Google invitations, OAuth consent/refresh, Meet provisioning, and production authenticated CPU usage must also be verified with the owner's connected account. A successful demo or mocked API test does not establish that those live flows have passed.

## Operations

- Inspect `outbox` counts and Worker error status metrics for synchronization failures. Logs intentionally omit task titles, email bodies, tokens, and provider responses.
- Never share the D1 database or a database export publicly. Task export is available in the app; Google access can be revoked in Google Account settings.
- Invite another person by updating `ALLOWED_EMAILS`. Removing an address prevents login and stops background synchronization for that user.
- Before modifying the database, export it with `wrangler d1 export DB --remote --output <private-backup-path>`. Keep database backups outside the repository.
- For an account-deletion request, revoke the user's Google grant and remove owned task, mapping, sync, and preference rows before deleting the auth user. Google task copies are independent after account deletion; remove them first if requested.

The code is organized into `src` (interface and shared types), `server` (auth, API, storage, Google, and sync), `migrations` (D1 schema), and `tests`.

## Future architecture options

- [Store Daymark tasks as Google Calendar events](docs/future-google-calendar-task-storage.md) is a deferred idea for potentially making Google Calendar authoritative for both events and tasks. It is not part of the current implementation.
