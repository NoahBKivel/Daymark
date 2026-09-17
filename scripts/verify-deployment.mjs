import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.PLAYWRIGHT_BASE_URL || 'https://daymark.calendarview.workers.dev';
const config = await fetch(`${origin}/api/config`);
assert.equal(config.status, 200);
assert.equal(typeof (await config.json()).configured, 'boolean');
for (const path of ['/api/tasks', '/api/settings', '/api/export', '/api/sync']) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 401, `${path} must require a session`);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
}
const homepage = await fetch(origin);
assert.equal(homepage.status, 200);
assert.match(homepage.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
try {
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  await page.goto(`${origin}/?demo=1`);
  await page.locator('.fc-dayGridMonth-view').waitFor();
  await page.getByText('Demo workspace', { exact: true }).waitFor();
  await page.locator('.fc-day-today .fc-daygrid-day-number').click();
  await page.locator('.fc-timeGridDay-view').waitFor();
  await page.goto(`${origin}/privacy`);
  await page.getByRole('dialog').waitFor();
  assert.deepEqual(failures, [], 'The deployed demo must run without JS/CSP errors');
  console.log('Deployment verified: public demo, day navigation, privacy page, CSP, private API authorization, and no-store headers.');
} finally {
  await browser.close();
}
