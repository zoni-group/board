import { test, expect } from '@playwright/test';
import { choosePen, selectPen } from '../helpers/pen-picker.js';

async function commands(page) {
  return page.evaluate(
    async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).commands
  );
}
async function drag(page, from, to) {
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + from.x, rect.y + from.y);
  await page.mouse.down();
  await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 6 });
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
async function laserPixels(page) {
  return page.locator('#laserLayer').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index]) count++;
    return count;
  });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('opens pen types from the active Pen button without adding toolbar buttons', async ({
  page,
}) => {
  const toolbarButtons = await page.locator('.toolbar button').count();
  const picker = page.locator('#penPicker');
  await page.locator('#erase').click();
  await page.locator('#pen').click();
  await expect(page.locator('#pen')).toHaveAttribute('aria-pressed', 'true');
  await expect(picker).toBeHidden();

  await page.locator('#pen').click();
  await expect(picker).toBeVisible();
  await expect(picker.locator('button')).toHaveText(['Pen', 'Highlighter', 'Laser']);
  await expect(picker.locator('[data-pen="pen"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();

  await page.locator('#pen').click();
  await expect(picker).toBeVisible();
  await page.locator('#pad').click({ position: { x: 300, y: 300 } });
  await expect(picker).toBeHidden();
  expect(await page.locator('.toolbar button').count()).toBe(toolbarButtons);
});

test('draws see-through highlights under pen ink with their own remembered style', async ({
  page,
}) => {
  await selectPen(page);
  await expect(page.locator('#size')).toHaveValue('6');
  await drag(page, { x: 150, y: 60 }, { x: 150, y: 220 });

  await choosePen(page, 'highlighter');
  await expect(page.locator('#pen')).toHaveAccessibleName('Highlighter');
  await expect(page.locator('#size')).toHaveValue('18');
  await drag(page, { x: 60, y: 140 }, { x: 260, y: 140 });
  await expect.poll(async () => (await commands(page)).length).toBe(2);
  const [ink, highlight] = await commands(page);
  expect(ink.pen).toBeUndefined();
  expect(highlight).toMatchObject({ tool: 'pen', pen: 'highlighter', size: 18 });

  // The highlight is see-through on its own and drawn under the earlier pen stroke.
  const [r, g, b] = await pixel(page, 220, 140);
  expect(r).toBeGreaterThan(220);
  expect(b).toBeLessThan(200);
  expect(await pixel(page, 150, 140)).toEqual(await pixel(page, 150, 100));

  await choosePen(page, 'pen');
  await expect(page.locator('#size')).toHaveValue('6');

  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  expect((await commands(page))[1].pen).toBe('highlighter');
  await choosePen(page, 'highlighter');
  await expect(page.locator('#size')).toHaveValue('18');
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await expect(page.locator('#pen')).toHaveAccessibleName('Highlighter');
});

test('laser trails fade away and are never saved or added to history', async ({ page }) => {
  await choosePen(page, 'laser');
  await expect(page.locator('#status')).toContainText('nothing is saved');
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + 80, rect.y + 120);
  await page.mouse.down();
  await page.mouse.move(rect.x + 240, rect.y + 160, { steps: 6 });
  await expect.poll(() => laserPixels(page)).toBeGreaterThan(0);
  await page.mouse.up();
  await expect.poll(() => laserPixels(page), { timeout: 3000 }).toBe(0);
  expect(await commands(page)).toEqual([]);
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#status')).not.toContainText('Draft');
});

test('a second finger cancels an unfinished highlight or laser trail', async ({ page }) => {
  await choosePen(page, 'highlighter');
  await pointer(page, 'pointerdown', 1, 60, 100);
  await pointer(page, 'pointermove', 1, 160, 100);
  await pointer(page, 'pointerdown', 2, 200, 200);
  await pointer(page, 'pointerup', 2, 200, 200);
  await pointer(page, 'pointerup', 1, 160, 100);
  expect(await commands(page)).toEqual([]);

  await choosePen(page, 'laser');
  await pointer(page, 'pointerdown', 3, 60, 100);
  await pointer(page, 'pointermove', 3, 160, 100);
  await expect.poll(() => laserPixels(page)).toBeGreaterThan(0);
  await pointer(page, 'pointerdown', 4, 200, 200);
  await expect.poll(() => laserPixels(page)).toBe(0);
  await pointer(page, 'pointerup', 4, 200, 200);
  await pointer(page, 'pointerup', 3, 160, 100);
  expect(await commands(page)).toEqual([]);
});
