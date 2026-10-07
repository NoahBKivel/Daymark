import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: false, appName: 'Daymark' } }),
  );
  await page.goto('/?demo=1');
});

test('opens desktop panels when a narrow window is widened', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.reload();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.task-panel')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.task-panel')).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.setViewportSize({ width: 1020, height: 900 });
  await expect(page.locator('.sidebar')).toHaveCount(0);
});

test('refreshes untouched demo samples when reopening in a later month', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-16T16:00:00Z'));
  await page.evaluate(() => localStorage.removeItem('daymark.demo.v1'));
  await page.reload();
  await page.locator('.fc-day-today .fc-daygrid-day-number').click();
  await expect(page.locator('.fc-event').filter({ hasText: 'Coffee with Jenna' })).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-10-16T16:00:00Z'));
  await page.reload();
  await page.locator('.fc-day-today .fc-daygrid-day-number').click();
  await expect(page.locator('.fc-event').filter({ hasText: 'Coffee with Jenna' })).toBeVisible();
  await expect(page.locator('.fc-event').filter({ hasText: 'Math problem set' }).first()).toBeVisible();
  const createdAt = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('daymark.demo.v1')!).tasks[0].createdAt,
  );
  expect(createdAt).toContain('2026-10-16');
});
test('switches month creation between task and event while retaining title and date', async ({
  page,
}) => {
  await page
    .locator('.fc-daygrid-day')
    .last()
    .locator('.fc-daygrid-day-frame')
    .click({ position: { x: 12, y: 45 } });
  const dialog = page.getByRole('dialog');
  const initialDialog = await dialog.elementHandle();
  await dialog.getByLabel('Task title', { exact: true }).fill('Switchable item');
  const date = await dialog.getByLabel('Deadline', { exact: true }).inputValue();
  const weekday = DateTime.fromISO(date).toFormat('ccc');
  await expect(dialog.getByLabel('Deadline', { exact: true }).locator('..')).toContainText(weekday);
  await dialog.getByRole('button', { name: 'Event', exact: true }).click();
  const switchedDialog = await dialog.elementHandle();
  expect(await initialDialog?.evaluate((node, other) => node === other, switchedDialog)).toBe(true);
  await expect(dialog.locator('.modal-heading p')).toHaveCount(0);
  await expect(dialog.getByLabel('Event title')).toHaveValue('Switchable item');
  await expect(dialog.getByLabel('Event start')).toHaveValue(new RegExp(`^${date}`));
  await expect(dialog.getByLabel('Event start').locator('..')).toContainText(weekday);
  await expect(dialog.getByRole('button', { name: 'Event', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(dialog.getByLabel('Task title', { exact: true })).toHaveValue('Switchable item');
  await expect(dialog.getByLabel('Deadline', { exact: true })).toHaveValue(date);
});

test('fits task and event creation forms in the desktop dialog without scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
    .toBe(true);

  await dialog.getByRole('button', { name: 'Event', exact: true }).click();
  await expect(dialog.getByLabel('Event title')).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
    .toBe(true);
});

test('renders a working public calendar with timed events and opens a day timeline', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', { name: DateTime.now().toFormat('MMMM yyyy') }),
  ).toBeVisible();
  await expect(
    page.locator('.fc-daygrid-event').filter({ hasText: 'Textbook presentation' }).first(),
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
test('expands a crowded month row instead of opening the more popover', async ({ page }) => {
  const todayCell = page.locator('.fc-day-today');
  const date = (await todayCell.getAttribute('data-date'))!;
  const sameWeekDate = DateTime.fromISO(date)
    .plus({ days: DateTime.fromISO(date).weekday % 7 === 6 ? -1 : 1 })
    .toISODate()!;
  const otherWeekDate = DateTime.fromISO(date)
    .plus({ days: DateTime.fromISO(date).day > 21 ? -7 : 7 })
    .toISODate()!;
  await page.evaluate(
    ({ dueDate, sameWeekDate, otherWeekDate }) => {
      const key = 'daymark.demo.v1';
      const state = JSON.parse(localStorage.getItem(key)!);
      const template = state.tasks[0];
      state.tasks.push(
        ...[dueDate, sameWeekDate, otherWeekDate].flatMap((taskDate) =>
          Array.from({ length: 8 }, (_, index) => ({
            ...template,
            id: 'overflow-' + taskDate + '-' + index,
            title: 'Overflow task ' + (index + 1),
            startDate: taskDate,
            dueDate: taskDate,
            checklist: [],
            recurrence: null,
          })),
        ),
      );
      localStorage.setItem(key, JSON.stringify(state));
    },
    { dueDate: date, sameWeekDate, otherWeekDate },
  );
  await page.reload();

  const moreLink = page
    .locator('[data-date="' + date + '"] .fc-daygrid-more-link')
    .filter({ hasText: /^Show \+/ });
  await expect(moreLink).toBeVisible();
  await expect(moreLink).toHaveText(/Show \+ \d+ more/);
  const heightBefore = await moreLink.evaluate(
    (element) => element.closest('tr')!.getBoundingClientRect().height,
  );
  const otherWeekMore = page.locator(`[data-date="${otherWeekDate}"] .fc-daygrid-more-link`);
  await expect(otherWeekMore).toBeVisible();
  await moreLink.click();
  await expect(otherWeekMore).toBeVisible();

  await expect(moreLink).toHaveCount(0);
  await expect(page.locator(`[data-date="${sameWeekDate}"] .fc-daygrid-more-link`)).toHaveCount(0);
  await expect(page.locator(`[data-date="${sameWeekDate}"]`)).toContainText('Overflow task 8');
  await expect(page.locator('.fc-popover')).toHaveCount(0);
  const expandedCell = page.locator('[data-date="' + date + '"]');
  await expect(expandedCell).toContainText('Overflow task 8');
  const hideButton = expandedCell.getByRole('button', { name: 'Hide' });
  await expect(hideButton).toBeVisible();
  const heightAfter = await page
    .locator('[data-date="' + date + '"]')
    .evaluate((element) => element.closest('tr')!.getBoundingClientRect().height);
  expect(heightAfter).toBeGreaterThan(heightBefore);
  const offsetBeforeScroll = await hideButton.evaluate((button, targetDate) => {
    const cell = document.querySelector(`[data-date="${targetDate}"]`)!;
    return button.getBoundingClientRect().top - cell.getBoundingClientRect().bottom;
  }, date);
  await page.locator('.fc-scroller-liquid-absolute').evaluate((scroller) => {
    scroller.scrollTop += 100;
  });
  const offsetAfterScroll = await hideButton.evaluate((button, targetDate) => {
    const cell = document.querySelector(`[data-date="${targetDate}"]`)!;
    return button.getBoundingClientRect().top - cell.getBoundingClientRect().bottom;
  }, date);
  expect(Math.abs(offsetAfterScroll - offsetBeforeScroll)).toBeLessThan(1);
  await hideButton.scrollIntoViewIfNeeded();
  const dayTopBeforeCollapse = await expandedCell.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await hideButton.click();
  await expect(hideButton).toHaveCount(0);
  await expect(moreLink).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(() => expandedCell.evaluate((element) => element.getBoundingClientRect().top))
    .toBeCloseTo(dayTopBeforeCollapse, 0);
  const heightCollapsed = await expandedCell.evaluate(
    (element) => element.closest('tr')!.getBoundingClientRect().height,
  );
  expect(heightCollapsed).toBeLessThan(heightAfter);
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
  await expect(page.getByLabel('Visibility')).toHaveValue('private');
  await page.getByRole('button', { name: 'Event color Sage' }).click();
  await page.getByRole('button', { name: 'Save event' }).click();
  await page.locator('.fc-day-today .fc-daygrid-day-number').click();
  const appointment = page.locator('.fc-event').filter({ hasText: 'A test appointment' });
  await expect(appointment).toBeVisible();
  await expect
    .poll(() =>
      appointment
        .locator('.event-card')
        .evaluate((element) => getComputedStyle(element).getPropertyValue('--event-color').trim()),
    )
    .toBe('#33b679');
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

test('saves an externally organized event color while keeping its details locked', async ({
  page,
}) => {
  await expect(
    page.locator('.fc-event').filter({ hasText: 'Coffee with Jenna' }).first(),
  ).toBeAttached();
  await page.evaluate(() => {
    const key = 'daymark.demo.v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.tasks = [];
    state.events = [state.events[0]];
    state.events[0].organizer = { self: false, email: 'organization@example.com' };
    state.events[0].guestsCanModify = false;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.locator('.fc-event:visible').filter({ hasText: 'Coffee with Jenna' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Event title')).toBeDisabled();
  await expect(dialog.getByLabel('Event start')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Event color Blueberry', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save color', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('daymark.demo.v1')!).events.find(
      (event: { id: string }) => event.id === 'demo-jenna',
    ),
  );
  expect(saved.colorId).toBe('9');
  expect(saved.summary).toBe('Coffee with Jenna');
  expect(saved.organizer).toEqual({ self: false, email: 'organization@example.com' });
  await page.reload();
  await page.locator('.fc-event:visible').filter({ hasText: 'Coffee with Jenna' }).first().click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Event color Blueberry', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

for (const fail of [false, true]) {
  test(`task drop stays on the new day during a delayed save${fail ? ' and reverts on failure' : ''}`, async ({
    page,
  }) => {
    await expect(page.locator('.fc-day-today')).toBeVisible({ timeout: 30_000 });
    const date = (await page.locator('.fc-day-today').getAttribute('data-date'))!;
    const destination = DateTime.fromISO(date).plus({ days: 1 }).toISODate()!;
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('daymark.demo.v1')!));
    let task = {
      ...state.tasks[0],
      id: 'drag-task',
      title: 'Drag task',
      startDate: null,
      dueDate: date,
      recurrence: null,
      seriesId: undefined,
      completed: false,
    };
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let saveStarted = false;
    let rangeReads = 0;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path === '/api/config') return route.fulfill({ json: { configured: true } });
      if (path === '/api/me')
        return route.fulfill({
          json: {
            user: { id: 'tester', name: 'Tester', email: 'tester@example.com' },
            settings: state.settings,
            hasSettings: true,
          },
        });
      if (path === '/api/lists') return route.fulfill({ json: state.lists });
      if (path === '/api/calendars') return route.fulfill({ json: [] });
      if (path === '/api/range') {
        rangeReads++;
        return route.fulfill({ json: { tasks: [task], events: [], errors: [] } });
      }
      if (path === '/api/tasks/drag-task' && route.request().method() === 'PUT') {
        saveStarted = true;
        const body = route.request().postDataJSON();
        await saveGate;
        if (fail) return route.fulfill({ status: 409, json: { error: 'Task save rejected' } });
        task = { ...task, ...body.task, version: task.version + 1 };
        return route.fulfill({ json: task });
      }
      if (path === '/api/tasks') return route.fulfill({ json: { tasks: [task], hasMore: false } });
      return route.fulfill({ json: { pending: 0, reconnect: false } });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const sourceTask = page
      .locator(`[data-date="${date}"] .fc-event:visible`)
      .filter({ hasText: 'Drag task' });
    const targetTask = page
      .locator(`[data-date="${destination}"] .fc-event:visible`)
      .filter({ hasText: 'Drag task' });
    await expect(sourceTask).toBeVisible();
    const from = (await sourceTask.boundingBox())!;
    const to = (await page
      .locator(`[data-date="${destination}"] .fc-daygrid-day-frame`)
      .boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 45, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => saveStarted).toBe(true);
    await expect(targetTask).toBeVisible();
    const previousReads = rangeReads;
    await page.evaluate(async () => {
      const now = Date.now;
      Date.now = () => now() + 60_000;
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      window.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      window.dispatchEvent(new Event('visibilitychange'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      Reflect.deleteProperty(document, 'visibilityState');
      Date.now = now;
    });
    await expect.poll(() => rangeReads).toBeGreaterThan(previousReads);
    const jumpedBack = await page.evaluate(async (oldDate) => {
      let jumped = false;
      for (let i = 0; i < 30; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        jumped ||= [...document.querySelectorAll(`[data-date="${oldDate}"] .fc-event`)].some(
          (event) =>
            event.textContent?.includes('Drag task') && event.getBoundingClientRect().height > 0,
        );
      }
      return jumped;
    }, date);
    expect(jumpedBack).toBe(false);
    releaseSave();
    if (fail) {
      await expect(sourceTask).toBeVisible();
      await expect(targetTask).toHaveCount(0);
      await expect(page.getByText('Task save rejected', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText('Task dates updated', { exact: true })).toBeVisible();
      await expect(targetTask).toBeVisible();
      await expect(sourceTask).toHaveCount(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(targetTask).toBeVisible();
    }
  });
}
