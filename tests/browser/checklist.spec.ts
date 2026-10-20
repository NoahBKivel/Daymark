import { test, expect } from '@playwright/test';

test('keeps steps beyond ten visible and saves the full checklist', async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ json: { configured: false } }));
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task title', { exact: true }).fill('Long checklist');
  for (let step = 1; step <= 15; step++) {
    await dialog.getByLabel('New subtask').fill(`Step ${step}`);
    await dialog.getByLabel('New subtask').press('Enter');
    await expect(dialog.getByLabel('Subtask title').last()).toBeInViewport();
  }
  await expect(dialog.getByLabel('Subtask title')).toHaveCount(15);
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const checklist = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('daymark.demo.v1')!).tasks.find(
      (task: { title: string }) => task.title === 'Long checklist',
    ).checklist,
  );
  expect(checklist.map((step: { title: string }) => step.title)).toEqual(
    Array.from({ length: 15 }, (_, index) => `Step ${index + 1}`),
  );
});
