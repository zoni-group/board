import { test, expect } from '@playwright/test';
import { chooseObject } from '../helpers/object-picker.js';

async function waitUntilControlled(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) =>
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
    );
  });
}

test('opens and uses every tool without a connection after one online visit', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
  await waitUntilControlled(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#pad')).toBeVisible();
  await expect(page.locator('#boards')).toBeEnabled();

  // Draw, then make sure the stroke survives an offline reload.
  await page.locator('#pen').click();
  await page.locator('#pad').click({ position: { x: 120, y: 120 } });
  await expect(page.locator('#undo')).toBeEnabled();

  // Lazy-loaded editors come from the precache.
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 200, y: 200 } });
  await expect(page.locator('notectl-editor').getByRole('textbox')).toBeVisible();
  await page.keyboard.press('Escape');

  await chooseObject(page, 'table');
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Insert', exact: true })
    .click();
  await expect(
    page.locator('.board-table-editor notectl-editor').getByRole('textbox')
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await expect(page.locator('#undo')).toBeEnabled();
});
