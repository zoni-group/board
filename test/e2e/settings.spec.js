import { test, expect } from '@playwright/test';
import { boardAction } from '../helpers/board-menu.js';

async function current(page) {
  return page.evaluate(async () => (await import('/test/helpers/board-browser.js')).activeBoard());
}
async function openSettings(page) {
  await boardAction(page, 'boardSettings');
  await expect(page.locator('.board-settings-panel')).toBeVisible();
}
async function closeSettings(page) {
  await page.locator('.board-settings-panel').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.board-settings-panel')).toHaveCount(0);
}
/** Distinct colors along one canvas row: 1 on blank paper, more with lines. */
async function rowColors(page, y = 200) {
  return page.locator('#pad').evaluate((canvas, y) => {
    const row = Math.round(y * devicePixelRatio);
    const data = canvas.getContext('2d').getImageData(0, row, canvas.width, 1).data;
    const colors = new Set();
    for (let index = 0; index < data.length; index += 4)
      colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    return colors.size;
  }, y);
}
async function pixel(page, x = 5, y = 5) {
  return page
    .locator('#pad')
    .evaluate(
      (canvas, { x, y }) =>
        [
          ...canvas
            .getContext('2d')
            .getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1)
            .data,
        ].slice(0, 3),
      { x, y }
    );
}
const dark = ([r, g, b]) => r + g + b < 200;

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('opens Settings from the Board menu without adding toolbar buttons', async ({ page }) => {
  await expect(page.locator('.board-action-strip > button')).toHaveCount(7);
  await page.locator('#boards').click();
  await expect(page.locator('#boardMenu .menu-item')).toHaveCount(9);
  await page.keyboard.press('End');
  await expect(page.locator('#clear')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#boardSettings')).toBeFocused();
  await page.keyboard.press('Enter');
  const panel = page.locator('.board-settings-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  await expect(panel.locator('h3')).toHaveText(['Board', 'Paper', 'Appearance', 'Storage']);
  await expect(page.locator('#settingsBoardName')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('#boards')).toBeFocused();
  await expect(page.locator('.board-action-strip > button')).toHaveCount(7);
});

test('a grid background is saved per board and survives reload', async ({ page }) => {
  expect(await rowColors(page)).toBe(1);
  await openSettings(page);
  const spacing = page.locator('.settings-field').filter({ hasText: 'Spacing' }).locator('button');
  await expect(spacing.first()).toBeDisabled();
  await page.locator('.settings-patterns [data-value="grid"]').click();
  await expect(spacing.first()).toBeEnabled();
  await spacing.filter({ hasText: 'Small' }).click();
  await expect(page.locator('.settings-patterns [data-value="grid"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await closeSettings(page);
  await expect.poll(() => rowColors(page)).toBeGreaterThan(1);
  const first = await current(page);
  expect(first.background).toEqual({ pattern: 'grid', spacing: 'small', color: 'auto' });
  // A board setting, not a drawing step.
  await expect(page.locator('#undo')).toBeDisabled();

  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await expect.poll(() => rowColors(page)).toBeGreaterThan(1);

  await boardAction(page, 'newBoard');
  await expect.poll(async () => (await current(page)).id).not.toBe(first.id);
  await expect.poll(() => rowColors(page)).toBe(1);

  await boardAction(page, 'openBoards');
  await page.locator(`[data-board-id="${first.id}"] .board-list-open`).click();
  await expect.poll(async () => (await current(page)).id).toBe(first.id);
  await expect.poll(() => rowColors(page)).toBeGreaterThan(1);
});

test('dark paper switches ink presets to light colors in the light theme', async ({ page }) => {
  await expect(page.locator('#swatches button').first()).toHaveAttribute('data-hex', '#111827');
  await openSettings(page);
  await page.locator('.settings-swatches [data-value="black"]').click();
  await closeSettings(page);
  expect(dark(await pixel(page))).toBe(true);
  await expect(page.locator('#swatches button').first()).toHaveAttribute('data-hex', '#e5e7eb');
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  expect(dark(await pixel(page))).toBe(true);
});

test('renames the board from Settings', async ({ page }) => {
  await openSettings(page);
  await page.locator('#settingsBoardName').fill('Fractions');
  await page.locator('#settingsBoardName').press('Enter');
  await expect(page.locator('#boardName')).toHaveText('Fractions');
  await page.locator('#settingsBoardName').fill('   ');
  await closeSettings(page);
  await expect(page.locator('#boardName')).toHaveText('Fractions');
  await expect.poll(async () => (await current(page)).name).toBe('Fractions');
  await page.locator('#boards').click();
  await expect(page.locator('#boardMenu [data-board-name]')).toHaveText('Fractions');
});

test('chooses the theme independently of the system setting', async ({ page }) => {
  await openSettings(page);
  await page
    .locator('.settings-field')
    .filter({ hasText: 'Theme' })
    .getByRole('button', { name: 'Dark' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await closeSettings(page);
  await expect.poll(async () => dark(await pixel(page))).toBe(true);
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(dark(await pixel(page))).toBe(true);

  await openSettings(page);
  await page
    .locator('.settings-field')
    .filter({ hasText: 'Theme' })
    .getByRole('button', { name: 'System' })
    .click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  await expect.poll(async () => dark(await pixel(page))).toBe(false);
});

test('shows storage use on this device', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Storage estimates differ between browsers.');
  await openSettings(page);
  await expect(page.locator('.settings-usage')).toContainText(/Using .+ of .+ on this device/);
  await expect(page.locator('.settings-storage')).toContainText('1 board');
});

test('Settings follow the language toggle', async ({ page, isMobile }) => {
  // The language toggle is hidden at phone width; pick the language as the toggle would.
  if (isMobile) {
    await page.evaluate(() => localStorage.setItem('vatio_board_lang', 'es'));
    await page.reload();
    await expect(page.locator('#boards')).toBeEnabled();
  } else await page.locator('#langToggle').click();
  await openSettings(page);
  await expect(page.locator('#boardPanelTitle')).toHaveText('Ajustes');
  await expect(page.locator('.settings-patterns')).toContainText('Cuadrícula');
  await expect(page.locator('#freeUpSpace')).toHaveText('Liberar espacio');
});
