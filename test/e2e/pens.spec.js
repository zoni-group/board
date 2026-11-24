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
  await expect(picker.locator('[data-kind="pen"]')).toHaveAttribute('aria-pressed', 'true');
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

test('the eraser has its own size, set with the same slider', async ({ page }) => {
  const size = page.locator('#size');
  await selectPen(page);
  await expect(size).toHaveValue('6');
  await page.locator('#erase').click();
  await expect(size).toHaveValue('24');
  await expect(size).toHaveAttribute('max', '80');
  await size.fill('60');
  await size.dispatchEvent('change');
  // Resizing keeps the eraser instead of switching back to the pen.
  await expect(page.locator('#erase')).toHaveAttribute('aria-pressed', 'true');
  await drag(page, { x: 60, y: 140 }, { x: 260, y: 140 });
  await expect
    .poll(async () => (await commands(page)).at(-1))
    .toMatchObject({
      tool: 'eraser',
      size: 60,
    });

  await page.locator('#pen').click();
  await expect(size).toHaveValue('6');
  await expect(size).toHaveAttribute('max', '22');

  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await page.locator('#erase').click();
  await expect(size).toHaveValue('60');
});

async function stylus(page, y, pressure) {
  const rect = await page.locator('#pad').boundingBox();
  const send = (type, x) =>
    page.locator('#pad').dispatchEvent(type, {
      pointerId: 7,
      pointerType: 'pen',
      isPrimary: true,
      pressure: type === 'pointerup' ? 0 : pressure,
      clientX: rect.x + x,
      clientY: rect.y + y,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true,
    });
  await send('pointerdown', 60);
  for (let x = 80; x <= 260; x += 20) await send('pointermove', x);
  await send('pointerup', 260);
}
/** How many CSS pixels tall the ink is in the canvas column at x, around y. */
async function thickness(page, x, y) {
  return page.locator('#pad').evaluate(
    (canvas, { x, y }) => {
      const ratio = devicePixelRatio,
        top = Math.round((y - 30) * ratio),
        height = Math.round(60 * ratio);
      const data = canvas.getContext('2d').getImageData(Math.round(x * ratio), top, 1, height).data;
      let inked = 0;
      for (let index = 0; index < data.length; index += 4)
        if (data[index] + data[index + 1] + data[index + 2] < 600) inked++;
      return inked / ratio;
    },
    { x, y }
  );
}

test('a stylus draws thicker lines the harder it presses', async ({ page }) => {
  await selectPen(page);
  await expect(page.locator('#size')).toHaveValue('6');
  await stylus(page, 100, 0.1);
  await stylus(page, 220, 1);
  await drag(page, { x: 60, y: 320 }, { x: 260, y: 320 });
  await expect.poll(async () => (await commands(page)).length).toBe(3);
  const [light, firm, mouse] = await commands(page);
  expect(light.pressure).toHaveLength(light.points.length);
  expect(Math.max(...light.pressure)).toBeLessThanOrEqual(0.1);
  expect(Math.min(...firm.pressure.slice(-3))).toBeGreaterThan(0.9);
  expect(mouse.pressure).toBeUndefined();

  const lightWidth = await thickness(page, 200, 100),
    firmWidth = await thickness(page, 200, 220),
    mouseWidth = await thickness(page, 200, 320);
  expect(lightWidth).toBeGreaterThan(0);
  // A mouse line stays at the chosen size, between a light and a firm stylus line.
  expect(mouseWidth).toBeGreaterThan(lightWidth);
  expect(firmWidth).toBeGreaterThan(mouseWidth);
  expect(firmWidth - lightWidth).toBeGreaterThanOrEqual(4);

  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  expect((await commands(page))[1].pressure).toEqual(firm.pressure);
  await expect.poll(() => thickness(page, 200, 220)).toBe(firmWidth);
});
