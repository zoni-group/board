import { test, expect } from '@playwright/test';
import { textObject } from '../helpers/text-fixture.js';
import { chooseSelectMode, selectSelectTool } from '../helpers/select-picker.js';

const stroke = (id, x0, x1, y) => ({
  type: 'stroke',
  tool: 'pen',
  id,
  size: 4,
  inkRaw: '#111827',
  points: Array.from({ length: 6 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 5, y })),
});

async function commands(page) {
  return page.evaluate(
    async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).commands
  );
}
async function seed(page, list) {
  await page.evaluate(async (list) => {
    window.dispatchEvent(new Event('pagehide'));
    const { seedBoard } = await import('/test/helpers/board-browser.js');
    await seedBoard({ commands: list });
  }, list);
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
}
async function path(page, points) {
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + points[0].x, rect.y + points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1))
    await page.mouse.move(rect.x + point.x, rect.y + point.y, { steps: 4 });
  await page.mouse.up();
}
async function pointer(page, type, id, x, y) {
  const rect = await page.locator('#pad').boundingBox();
  await page.locator('#pad').dispatchEvent(type, {
    pointerId: id,
    pointerType: 'touch',
    isPrimary: id === 1,
    clientX: rect.x + x,
    clientY: rect.y + y,
    button: 0,
    bubbles: true,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('opens select modes above the active Select button', async ({ page }) => {
  const picker = page.locator('#selectPicker');
  await page.locator('#select').click();
  await expect(page.locator('#select')).toHaveAttribute('aria-pressed', 'true');
  await expect(picker).toBeHidden();
  await page.locator('#select').click();
  await expect(picker).toBeVisible();
  await expect(picker.locator('button')).toHaveText(['Select one', 'Box', 'Lasso']);
  const menu = await picker.boundingBox(),
    button = await page.locator('#select').boundingBox();
  expect(menu.y + menu.height).toBeLessThanOrEqual(button.y + 1);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();

  await chooseSelectMode(page, 'box');
  await expect(page.locator('#select')).toHaveAccessibleName('Box');
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await expect(page.locator('#select')).toHaveAccessibleName('Box');
});

test('Box selects several strokes, moves them together, and one Undo restores both', async ({
  page,
}) => {
  await seed(page, [
    stroke('a', 60, 140, 120),
    stroke('b', 60, 140, 150),
    stroke('c', 60, 140, 320),
  ]);
  await chooseSelectMode(page, 'box');
  await path(page, [
    { x: 40, y: 100 },
    { x: 170, y: 175 },
  ]);
  await expect(page.locator('#groupSelection')).toBeVisible();
  await expect(page.locator('#status')).toContainText('2 objects selected');
  await expect(page.locator('.group-selection-actions button:visible')).toHaveText([
    'Duplicate',
    'Order',
    'Delete',
    'Done',
  ]);

  await path(page, [
    { x: 100, y: 135 },
    { x: 150, y: 175 },
  ]);
  await expect.poll(async () => (await commands(page)).length).toBe(4);
  const batch = (await commands(page))[3];
  expect(batch.type).toBe('batch');
  expect(batch.commands).toEqual([
    { type: 'stroke-edit', id: 'a', translate: { x: 50, y: 40 } },
    { type: 'stroke-edit', id: 'b', translate: { x: 50, y: 40 } },
  ]);

  await page.locator('#undo').click();
  await expect.poll(async () => (await commands(page)).length).toBe(3);
  await page.locator('#redo').click();
  await expect.poll(async () => (await commands(page)).length).toBe(4);
});

test('Lasso catches exactly a handwritten word, and Delete removes it in one step', async ({
  page,
}) => {
  const word = [
    stroke('w1', 300, 320, 120),
    stroke('w2', 325, 345, 125),
    stroke('w3', 350, 370, 118),
    stroke('w4', 375, 395, 122),
  ];
  await seed(page, [...word, stroke('other', 300, 400, 200)]);
  await chooseSelectMode(page, 'lasso');
  await path(page, [
    { x: 290, y: 100 },
    { x: 410, y: 100 },
    { x: 410, y: 145 },
    { x: 290, y: 145 },
    { x: 290, y: 102 },
  ]);
  await expect(page.locator('#status')).toContainText('4 objects selected');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await commands(page)).length).toBe(6);
  // Same-kind deletes need no batch: one command already removes all four strokes.
  expect((await commands(page))[5]).toEqual({
    type: 'stroke-delete',
    ids: ['w1', 'w2', 'w3', 'w4'],
  });
  await expect(page.locator('#groupSelection')).toBeHidden();
  await page.locator('#undo').click();
  await expect.poll(async () => (await commands(page)).length).toBe(5);
});

test('restyles every stroke in a group in one step; text-only groups keep controls disabled', async ({
  page,
}) => {
  await seed(page, [
    stroke('a', 60, 140, 120),
    stroke('b', 60, 140, 150),
    { type: 'text-set', object: textObject({ id: 't1', position: { x: 400, y: 120 } }) },
    { type: 'text-set', object: textObject({ id: 't2', position: { x: 400, y: 200 } }) },
  ]);
  await chooseSelectMode(page, 'box');
  await path(page, [
    { x: 40, y: 100 },
    { x: 170, y: 175 },
  ]);
  await expect(page.locator('#status')).toContainText('2 objects selected');
  await page.locator('#swatches [data-hex="#2563eb"]').click();
  await expect.poll(async () => (await commands(page)).length).toBe(5);
  expect((await commands(page))[4]).toEqual({
    type: 'batch',
    commands: [
      { type: 'stroke-edit', id: 'a', inkRaw: '#2563eb' },
      { type: 'stroke-edit', id: 'b', inkRaw: '#2563eb' },
    ],
  });

  await path(page, [
    { x: 380, y: 90 },
    { x: 620, y: 290 },
  ]);
  await expect(page.locator('#status')).toContainText('2 objects selected');
  await expect(page.locator('#size')).toBeDisabled();
  await expect(page.locator('#swatches button').first()).toBeDisabled();
});

test('a box around one object makes a normal selection, and an empty box clears', async ({
  page,
}) => {
  await seed(page, [stroke('a', 60, 140, 120), stroke('b', 60, 140, 320)]);
  await chooseSelectMode(page, 'box');
  await path(page, [
    { x: 40, y: 100 },
    { x: 170, y: 140 },
  ]);
  await expect(page.locator('#objectSelection')).toBeVisible();
  await expect(page.locator('#groupSelection')).toHaveCount(0);
  // Stays inside a phone-width pad (390 px on the touch project).
  await path(page, [
    { x: 200, y: 220 },
    { x: 300, y: 280 },
  ]);
  await expect(page.locator('.object-selection')).toBeHidden();
  expect(await commands(page)).toHaveLength(2);
});

test('a second finger cancels a lasso in progress', async ({ page }) => {
  await seed(page, [stroke('a', 60, 140, 120), stroke('b', 60, 140, 150)]);
  await chooseSelectMode(page, 'lasso');
  await selectSelectTool(page);
  await pointer(page, 'pointerdown', 1, 40, 100);
  await pointer(page, 'pointermove', 1, 170, 100);
  await pointer(page, 'pointermove', 1, 170, 175);
  await expect(page.locator('.selection-marquee')).toBeVisible();
  await pointer(page, 'pointerdown', 2, 300, 300);
  await expect(page.locator('.selection-marquee')).toBeHidden();
  await pointer(page, 'pointermove', 1, 40, 175);
  await pointer(page, 'pointerup', 2, 300, 300);
  await pointer(page, 'pointerup', 1, 40, 102);
  await expect(page.locator('#groupSelection')).toHaveCount(0);
});
