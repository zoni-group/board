import { test, expect } from '@playwright/test';
import { boardAction } from '../helpers/board-menu.js';

async function board(page) {
  return page.evaluate(async () => {
    const board = await (await import('/test/helpers/board-browser.js')).activeBoard();
    return { commands: board.commands, viewport: board.viewport, pageIndex: board.pageIndex };
  });
}
// Coordinates stay inside a phone-width pad (390 px on the touch project).
async function drag(page, y) {
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + 60, rect.y + y);
  await page.mouse.down();
  await page.mouse.move(rect.x + 220, rect.y + y, { steps: 6 });
  await page.mouse.up();
}
async function hold(page, ms) {
  const box = await page.locator('#unlockBoard').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}
const strip = (page) => page.locator('.board-action-strip');
const pill = (page) => page.locator('#unlockBoard');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('a locked board can be moved around but not changed, even after a reload', async ({
  page,
}) => {
  await drag(page, 120);
  await expect.poll(async () => (await board(page)).commands.length).toBe(1);
  await boardAction(page, 'lockBoard');
  await expect(page.locator('#status')).toContainText('Board locked');
  await expect(strip(page)).toBeHidden();
  await expect(page.locator('#select')).toBeHidden();
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveText('Locked');
  await expect(page.locator('#hand')).toHaveAttribute('aria-pressed', 'true');

  // Dragging pans instead of drawing.
  const before = (await board(page)).viewport ?? null;
  await drag(page, 200);
  await expect.poll(async () => (await board(page)).viewport).not.toEqual(before);
  expect((await board(page)).commands).toHaveLength(1);

  // Undo, the tool shortcut and Delete do nothing.
  await page.locator('#pad').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('v');
  await expect(page.locator('#hand')).toHaveAttribute('aria-pressed', 'true');
  expect((await board(page)).commands).toHaveLength(1);

  // Dropping an image adds nothing.
  await page.locator('#pad').evaluate((canvas) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(8)], 'drop.png', { type: 'image/png' }));
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await page.waitForTimeout(300);
  expect((await board(page)).commands).toHaveLength(1);
  await expect(page.locator('.board-content-panel')).toHaveCount(0);

  await page.reload();
  await expect(pill(page)).toBeVisible();
  await expect(strip(page)).toBeHidden();
  await drag(page, 260);
  await page.waitForTimeout(300);
  expect((await board(page)).commands).toHaveLength(1);
});

test('page arrows still work while locked, but the Page menu does not open', async ({ page }) => {
  await boardAction(page, 'addPage');
  await expect(page.locator('#pageMenuButton')).toHaveText('2 / 2');
  await boardAction(page, 'lockBoard');
  await expect(page.locator('#pageMenuButton')).toBeDisabled();
  await page.locator('#prevPage').click();
  await expect(page.locator('#pageMenuButton')).toHaveText('1 / 2');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#pageMenuButton')).toHaveText('2 / 2');
  await expect(page.locator('#pageMenu')).toBeHidden();
});

test('a tap shows the hint; holding the Locked pill unlocks', async ({ page }) => {
  await boardAction(page, 'lockBoard');
  await pill(page).click();
  await expect(page.locator('#status')).toContainText('Press and hold to unlock');
  await expect(pill(page)).toBeVisible();
  await hold(page, 500);
  await expect(pill(page)).toBeVisible();
  await hold(page, 1300);
  await expect(pill(page)).toBeHidden();
  await expect(strip(page)).toBeVisible();
  await expect(page.locator('#status')).toContainText('Board unlocked');
  await expect(page.locator('#pen')).toHaveAttribute('aria-pressed', 'true');
  await drag(page, 160);
  await expect.poll(async () => (await board(page)).commands.length).toBe(1);
  await page.reload();
  await expect(strip(page)).toBeVisible();
  await expect(pill(page)).toBeHidden();
});

test('Full screen toggles from the zoom bar where the browser allows it', async ({ page }) => {
  const button = page.locator('#fullScreen');
  // The same check as the app: Safari on iPad only has the webkit-prefixed API.
  const supported = await page.evaluate(() =>
    Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled)
  );
  if (!supported) {
    await expect(button).toBeHidden();
    return;
  }
  const active = () =>
    page.evaluate(() => Boolean(document.fullscreenElement ?? document.webkitFullscreenElement));
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-label', 'Full screen');
  await button.click();
  await expect.poll(active).toBe(true);
  await expect(button).toHaveAttribute('aria-label', 'Exit full screen');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect.poll(active).toBe(false);
  await expect(button).toHaveAttribute('aria-label', 'Full screen');
});
