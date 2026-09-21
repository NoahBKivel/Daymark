import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: false, appName: 'Daymark' } }),
  );
  await page.goto('/?demo=1');
});
test('switches month creation between task and event while retaining title and date', async ({ page }) => {
  await page.locator('.fc-daygrid-day').last().locator('.fc-daygrid-day-frame').click({ position: { x: 12, y: 45 } });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task title', { exact: true }).fill('Switchable item');
  const date = await dialog.getByLabel('Deadline', { exact: true }).inputValue();
  await dialog.getByRole('button', { name: 'Event', exact: true }).click();
  await expect(dialog.getByLabel('Event title')).toHaveValue('Switchable item');
  await expect(dialog.getByLabel('Event start')).toHaveValue(new RegExp(`^${date}`));
  await expect(dialog.getByRole('button', { name: 'Event', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(dialog.getByLabel('Task title', { exact: true })).toHaveValue('Switchable item');
  await expect(dialog.getByLabel('Deadline', { exact: true })).toHaveValue(date);
});

test('renders a working public calendar with timed events and opens a day timeline', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', { name: DateTime.now().toFormat('MMMM yyyy') }),
  ).toBeVisible();
  await expect(
    page.locator('.fc-daygrid-event').filter({ hasText: 'Textbook presentation' }),
  ).toBeVisible();
  await expect(
    page.locator('.fc-daygrid-event').filter({ hasText: 'Coffee with Jenna' }),
  ).toContainText('11:00 AM');
  await page.locator('.fc-day-today .fc-daygrid-day-number').click();
  await expect(page.locator('.fc-timeGridDay-view')).toBeVisible();
  await expect(
    page.locator('.fc-timegrid-event').filter({ hasText: 'Coffee with Jenna' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
});
test('creates a spanning task, retains completion and dates after reload, and supports checklists', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task title', { exact: true }).fill('Browser acceptance assignment');
  const first = DateTime.now().startOf('month').plus({ days: 7 }).toISODate()!;
  const last = DateTime.now().startOf('month').plus({ days: 11 }).toISODate()!;
  await dialog.getByLabel('Start date', { exact: true }).fill(first);
  await dialog.getByLabel('Deadline', { exact: true }).fill(last);
  await dialog.getByLabel('New subtask').fill('Write an outline');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save task' }).click();
  await expect(dialog).not.toBeVisible();
  const bar = page
    .locator('.fc-daygrid-event')
    .filter({ hasText: 'Browser acceptance assignment' })
    .first();
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Complete Browser acceptance assignment' }).click();
  await expect(bar).toHaveClass(/completed/);
  await page.reload();
  await expect(bar).toHaveClass(/completed/);
  await bar.click();
  await expect(page.getByRole('dialog').getByLabel('Start date', { exact: true })).toHaveValue(
    first,
  );
  await expect(page.getByRole('dialog').getByLabel('Deadline', { exact: true })).toHaveValue(last);
  await expect(page.getByRole('dialog').getByLabel('Subtask title')).toHaveValue(
    'Write an outline',
  );
});
test('supports custom list colors, dark mode, keyboard dialog dismissal, and an event editor', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Create task list' }).click();
  await page.getByLabel('List name').fill('My new list');
  await page.getByRole('button', { name: 'Color #b783a0', exact: true }).click();
  await page.getByRole('button', { name: 'Save list' }).click();
  await expect(page.getByRole('button', { name: 'My new list', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Event', exact: true }).click();
  await page.getByLabel('Event title').fill('A test appointment');
  await page.getByRole('button', { name: 'Save event' }).click();
  await page.locator('.fc-day-today .fc-daygrid-day-number').click();
  await expect(page.locator('.fc-event').filter({ hasText: 'A test appointment' })).toBeVisible();
});
test('exports and restores task data without authorization secrets', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export tasks' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByRole('status')).toContainText('Task backup restored');
});
test('desktop and mobile visual smoke tests have no horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: '.runtime/daymark-desktop.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector('.fc-daygrid-event');
  await page.screenshot({ path: '.runtime/daymark-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Create a task', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
});
