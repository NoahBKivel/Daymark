import { test, expect } from '@playwright/test';
test('creates and reopens a single-time event without adding a duration', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-03T15:00:00Z'));
  await page.route('**/api/config', (route) => route.fulfill({ json: { configured: false } }));
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Event', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Event title').fill('Time marker');
  await dialog.getByLabel('Event start', { exact: true }).fill('2026-11-03T11:00');
  await dialog.getByLabel('Event end', { exact: true }).fill('2026-11-03T11:00');
  await dialog.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.locator('.fc-day-today .fc-daygrid-day-number').click();
  const event = page.locator('.fc-timegrid-event').filter({ hasText: 'Time marker' });
  await expect(event).toBeVisible();
  await expect(event.locator('.event-card-time')).toHaveText('11:00 AM');
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('daymark.demo.v1')!).events.find(
      (event: { summary: string }) => event.summary === 'Time marker',
    ),
  );
  expect(stored.start.dateTime).toBe(stored.end.dateTime);
  await event.click();
  await expect(dialog.getByLabel('Event start', { exact: true })).toHaveValue('2026-11-03T11:00');
  await expect(dialog.getByLabel('Event end', { exact: true })).toHaveValue('2026-11-03T11:00');
});
