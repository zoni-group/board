import { test, expect } from '@playwright/test';
import { selectSelectTool } from '../helpers/select-picker.js';

// Solid cards, so a pixel shows which one is on top. Coordinates fit a phone-width pad.
const card = (id, color, x, z) => ({
  type: 'shape-set',
  object: {
    id,
    kind: 'rectangle',
    start: { x, y: 60 },
    end: { x: x + 140, y: 160 },
    size: 4,
    inkRaw: color,
    fill: { color, solid: true },
    ...(z === undefined ? {} : { z }),
  },
});
const line = (z) => ({
  type: 'stroke',
  tool: 'pen',
  id: 'ink',
  size: 12,
  inkRaw: '#111827',
  points: Array.from({ length: 8 }, (_, i) => ({ x: 30 + i * 30, y: 110 })),
  ...(z === undefined ? {} : { z }),
});
const BLUE = '#2563eb',
  RED = '#dc2626';
const isBlue = ([r, , b]) => b > r + 80;
const isRed = ([r, , b]) => r > b + 80;
const isInk = ([r, g, b]) => r < 90 && g < 90 && b < 110;

async function seed(page, commands) {
  await page.evaluate(async (commands) => {
    window.dispatchEvent(new Event('pagehide'));
    const { seedBoard } = await import('/test/helpers/board-browser.js');
    await seedBoard({ commands });
  }, commands);
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
}
async function pixel(page, x, y) {
  return page
    .locator('#pad')
    .evaluate(
      (canvas, { x, y }) => [
        ...canvas
          .getContext('2d')
          .getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1)
          .data,
      ],
      { x, y }
    );
}
async function order(page, item) {
  await page.locator('.object-selection-actions').getByRole('button', { name: 'Order' }).click();
  const menu = page.locator('#orderMenu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item }).click();
  await expect(menu).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('Send to back puts ink under a card; one Undo restores it; the menu disables no-ops', async ({
  page,
}) => {
  await seed(page, [card('card', BLUE, 40, 0), line(1)]);
  await expect.poll(async () => isInk(await pixel(page, 120, 110))).toBe(true);

  await selectSelectTool(page);
  await page.locator('#pad').click({ position: { x: 120, y: 110 } });
  await expect(page.locator('#objectSelection')).toBeVisible();
  // The ink is on top: a tap picks it, and it cannot go further up.
  await page.locator('.object-selection-actions').getByRole('button', { name: 'Order' }).click();
  const menu = page.locator('#orderMenu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Bring to front',
    'Bring forward',
    'Send backward',
    'Send to back',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Bring to front' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Bring forward' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Send to back' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await order(page, 'Send to back');
  await expect(page.locator('#status')).toContainText('Sent to back');
  await expect.poll(async () => isBlue(await pixel(page, 120, 110))).toBe(true);
  // Outside the card the ink still shows.
  expect(isInk(await pixel(page, 30, 110))).toBe(true);
  await expect(page.locator('#objectSelection')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => isInk(await pixel(page, 120, 110))).toBe(true);
});

test('Bring forward and the shortcuts move a card past the one it overlaps', async ({ page }) => {
  await seed(page, [card('blue', BLUE, 40, 0), card('red', RED, 120, 1)]);
  await expect.poll(async () => isRed(await pixel(page, 150, 110))).toBe(true);
  await selectSelectTool(page);
  // Tap the part of the blue card that shows, then bring it forward over the red one.
  await page.locator('#pad').click({ position: { x: 70, y: 110 } });
  await order(page, 'Bring forward');
  await expect(page.locator('#status')).toContainText('Brought forward');
  await expect.poll(async () => isBlue(await pixel(page, 150, 110))).toBe(true);

  await page.keyboard.press('ControlOrMeta+Shift+BracketLeft');
  await expect(page.locator('#status')).toContainText('Sent to back');
  await expect.poll(async () => isRed(await pixel(page, 150, 110))).toBe(true);
  await page.keyboard.press('ControlOrMeta+BracketRight');
  await expect.poll(async () => isBlue(await pixel(page, 150, 110))).toBe(true);
  await page.keyboard.press('ControlOrMeta+BracketRight');
  await expect(page.locator('#status')).toContainText('Already in front');
});

test('boards saved before stacking look the same, and new ink goes on top', async ({ page }) => {
  // No stack positions: the old layers apply, so the card covers the ink drawn before it.
  await seed(page, [line(), card('card', BLUE, 40)]);
  await expect.poll(async () => isBlue(await pixel(page, 120, 110))).toBe(true);

  // New ink is drawn above the old card.
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + 100, rect.y + 80);
  await page.mouse.down();
  await page.mouse.move(rect.x + 100, rect.y + 140, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => isInk(await pixel(page, 100, 110))).toBe(true);
  const stored = await page.evaluate(
    async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).commands
  );
  expect(stored.at(-1)).toMatchObject({ tool: 'pen', z: 0 });

  // Sending the card to back numbers the old objects once and puts the old ink on top too.
  await selectSelectTool(page);
  await page.locator('#pad').click({ position: { x: 160, y: 140 } });
  await order(page, 'Send to back');
  await expect.poll(async () => isInk(await pixel(page, 120, 110))).toBe(true);
});
