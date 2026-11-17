import { boardAction } from '../helpers/board-menu.js';
import { chooseObject } from '../helpers/object-picker.js';
import { test, expect } from '@playwright/test';
import { textObject } from '../helpers/text-fixture.js';

const dot = (x, y, inkRaw = '#0000ff', size = 10, tool = 'pen') => ({
  type: 'stroke',
  ...(tool === 'pen' ? { id: `dot-${x}-${y}` } : {}),
  tool,
  size,
  inkRaw,
  points: [{ x, y }],
});

async function snapshot(page) {
  return page.evaluate(async () => (await import('/test/helpers/board-browser.js')).activeBoard());
}
async function objects(page) {
  return page.evaluate(async () => {
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const { resolveTextObjects } = await import('/src/board/text-scene.ts');
    return resolveTextObjects((await activeBoard()).commands);
  });
}
async function seed(page, commands, view = null) {
  await page.evaluate(
    async ({ commands, view }) => {
      window.dispatchEvent(new Event('pagehide'));
      const { seedBoard } = await import('/test/helpers/board-browser.js');
      await seedBoard({ commands, viewport: view });
    },
    { commands, view }
  );
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
}

async function camera(page) {
  return page.evaluate(async () => {
    const saved = (await (await import('/test/helpers/board-browser.js')).activeBoard()).viewport;
    if (saved) return saved;
    const rect = document.getElementById('pad').getBoundingClientRect();
    return { center: { x: rect.width / 2, y: rect.height / 2 }, zoom: 1 };
  });
}
async function localPoint(page, world) {
  const view = await camera(page);
  return page.locator('#pad').evaluate(
    (canvas, { world, view }) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (world.x - view.center.x) * view.zoom + rect.width / 2,
        y: (world.y - view.center.y) * view.zoom + rect.height / 2,
      };
    },
    { world, view }
  );
}
async function pointer(page, type, id, x, y, pointerType = 'touch') {
  await page.locator('#pad').dispatchEvent(type, {
    pointerId: id,
    pointerType,
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
  });
}
async function png(page) {
  const pending = page.waitForEvent('download');
  await boardAction(page, 'save');
  const chunks = [];
  for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = { red: 0, blue: 0, yellow: 0, transparent: 0 };
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 204 && pixels[i + 1] === 0 && pixels[i + 2] === 0) counts.red++;
      if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 255) counts.blue++;
      if (pixels[i] === 255 && pixels[i + 1] === 241 && pixels[i + 2] === 118) counts.yellow++;
      if (pixels[i + 3] < 255) counts.transparent++;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      ...counts,
      erased: [...ctx.getImageData(132, 37, 1, 1).data],
    };
  }, Buffer.concat(chunks).toString('base64'));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#text')).toBeEnabled();
});

test('keeps bottom-edge text actions above the fixed navigation controls', async ({ page }) => {
  const rect = await page.locator('#pad').boundingBox();
  const object = textObject({ position: { x: 20, y: rect.height - 15 } });
  await seed(page, [{ type: 'text-set', object }]);
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 24, y: rect.height - 12 } });
  const move = page.getByRole('button', { name: 'Move', exact: true });
  await expect(move).toBeInViewport();
  const actions = await page.locator('.text-selection-actions').boundingBox();
  const navigation = await page.locator('.board-navigation').boundingBox();
  expect(actions.y + actions.height).toBeLessThan(navigation.y);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('notectl-editor').getByRole('textbox')).toBeVisible();
});

test('pans and zooms the workspace while controls and drawing history stay fixed', async ({
  page,
}) => {
  await seed(page, [dot(100, 100), dot(150, 150)]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).redoCommands.length).toBe(1);
  const saved = await snapshot(page),
    original = await camera(page);
  const penBounds = await page.getByRole('button', { name: 'Pen', exact: true }).boundingBox();
  const controls = await page.locator('.board-navigation').boundingBox();
  const buffer = await page.locator('#pad').evaluate((canvas) => [canvas.width, canvas.height]);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await camera(page)).zoom).toBe(1.25);
  await expect(page.locator('#zoomReset')).toHaveText('125%');
  await page.getByRole('button', { name: 'Hand', exact: true }).click();
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + 80, rect.y + 120);
  await page.mouse.down();
  await page.mouse.move(rect.x + 120, rect.y + 150);
  await page.mouse.up();
  await expect
    .poll(async () => (await camera(page)).center)
    .toEqual({ x: original.center.x - 32, y: original.center.y - 24 });
  expect((await snapshot(page)).commands).toEqual(saved.commands);
  expect((await snapshot(page)).redoCommands).toEqual(saved.redoCommands);
  expect(await page.getByRole('button', { name: 'Pen', exact: true }).boundingBox()).toEqual(
    penBounds
  );
  expect(await page.locator('.board-navigation').boundingBox()).toEqual(controls);
  expect(await page.locator('#pad').evaluate((canvas) => [canvas.width, canvas.height])).toEqual(
    buffer
  );
  const moved = await camera(page);
  await page.locator('#zoomReset').click();
  await expect.poll(async () => (await camera(page)).zoom).toBe(1);
  expect((await camera(page)).center).toEqual(moved.center);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).commands.length).toBe(2);
  await page.getByRole('button', { name: 'Fit drawing', exact: true }).click();
  await expect.poll(async () => (await camera(page)).center).toEqual({ x: 125, y: 125 });
});

test('draws, edits, moves, and erases highlighted text in world coordinates at zoom', async ({
  page,
}) => {
  const object = textObject({ position: { x: -150, y: -150 } });
  object.paragraphs[0].runs[0].text = 'Zoom';
  object.paragraphs[0].runs[0].highlightRaw = '#fff176';
  await seed(page, [{ type: 'text-set', object }], { center: { x: -100, y: -100 }, zoom: 2 });
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: await localPoint(page, { x: -145, y: -145 }) });
  const selected = await page.locator('#textSelection').boundingBox();
  expect(selected.height).toBeCloseTo(76.8, 0);
  const handle = await page.getByRole('button', { name: 'Move', exact: true }).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 20);
  await page.mouse.up();
  await expect.poll(async () => (await objects(page))[0].position).toEqual({ x: -130, y: -140 });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const input = page.locator('notectl-editor').getByRole('textbox');
  await expect(input.locator('p')).toHaveCSS('font-size', '32px');
  await input.press('End');
  await input.pressSequentially('!');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page))[0].paragraphs[0].runs[0].text).toBe('Zoom!');
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.locator('#pad').click({ position: await localPoint(page, { x: -80, y: -60 }) });
  await expect.poll(async () => (await snapshot(page)).commands.at(-1).type).toBe('stroke');
  const point = (await snapshot(page)).commands.at(-1).points[0];
  expect(point.x).toBeCloseTo(-80, 0);
  expect(point.y).toBeCloseTo(-60, 0);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.locator('#pad').click({ position: await localPoint(page, { x: -120, y: -130 }) });
  await expect.poll(async () => (await objects(page)).length).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await objects(page))[0]?.paragraphs[0].runs[0].highlightRaw)
    .toBe('#fff176');
});

test('two-finger navigation cancels ink and text erasing and never creates a text block', async ({
  page,
}) => {
  const rect = await page.locator('#pad').boundingBox();
  const x = rect.x + 80,
    y = rect.y + 140;
  await pointer(page, 'pointerdown', 11, x, y);
  await pointer(page, 'pointermove', 11, x + 5, y);
  await pointer(page, 'pointerdown', 12, x + 100, y);
  await pointer(page, 'pointermove', 12, x + 160, y);
  await pointer(page, 'pointerup', 12, x + 160, y);
  await pointer(page, 'pointermove', 11, x + 30, y);
  await pointer(page, 'pointerup', 11, x + 30, y);
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(1);
  expect((await snapshot(page)).commands).toEqual([]);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await chooseObject(page, 'text');
  await pointer(page, 'pointerdown', 21, x, y);
  await pointer(page, 'pointerdown', 22, x + 100, y);
  await pointer(page, 'pointermove', 22, x + 130, y + 10);
  await pointer(page, 'pointerup', 22, x + 130, y + 10);
  await pointer(page, 'pointerup', 21, x, y);
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  expect((await snapshot(page)).commands).toEqual([]);
  const object = textObject({ position: { x: 80, y: 120 } });
  await seed(page, [{ type: 'text-set', object }]);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await pointer(page, 'pointerdown', 31, rect.x + 85, rect.y + 125);
  await pointer(page, 'pointerdown', 32, rect.x + 180, rect.y + 125);
  await pointer(page, 'pointerup', 32, rect.x + 180, rect.y + 125);
  await pointer(page, 'pointerup', 31, rect.x + 85, rect.y + 125);
  expect(await objects(page)).toEqual([object]);
  expect((await snapshot(page)).commands).toHaveLength(1);
  expect(
    await page.locator('#textLayer').evaluate((canvas) =>
      canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, index) => index % 4 === 3 && value > 0)
    )
  ).toBe(true);
});

test('exports offscreen ink, erasing, and highlighted text independently of the viewport', async ({
  page,
}) => {
  const object = textObject({ position: { x: -300, y: 150 } });
  object.paragraphs[0].runs[0].highlightRaw = '#fff176';
  await seed(
    page,
    [
      dot(50000, 50000),
      { type: 'clear' },
      dot(-200, -100, '#cc0000'),
      dot(1200, 600),
      dot(-200, -100, '#000000', 4, 'eraser'),
      { type: 'text-set', object },
    ],
    { center: { x: 300, y: 200 }, zoom: 2 }
  );
  const first = await png(page);
  expect(first.width).toBe(1569);
  expect(first.height).toBe(774);
  expect(first.red).toBeGreaterThan(10);
  expect(first.blue).toBeGreaterThan(30);
  expect(first.yellow).toBeGreaterThan(100);
  expect(first.transparent).toBe(0);
  expect(first.erased).toEqual([255, 255, 255, 255]);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect.poll(async () => (await camera(page)).zoom).toBe(1.6);
  await page.locator('#pad').dispatchEvent('wheel', { deltaX: 1000, deltaY: 1000 });
  expect(await png(page)).toEqual(first);
});

test('caps large exports and reports the reduced resolution', async ({ page }) => {
  await seed(page, [dot(-20000, -20000, '#0000ff', 100), dot(20000, 20000, '#0000ff', 100)]);
  const result = await png(page);
  expect(result.width).toBeLessThanOrEqual(4096);
  expect(result.height).toBeLessThanOrEqual(4096);
  expect(result.width * result.height).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(result.blue).toBeGreaterThan(10);
  await expect(page.locator('#status')).toContainText('resolution reduced');
});

test('restores the last view, preserves it on resize and clear, and keeps drawings intact', async ({
  page,
}) => {
  const view = { center: { x: -1500, y: 700 }, zoom: 0.5 };
  await seed(page, [dot(-1500, 700)], view);
  await expect(page.locator('#zoomReset')).toHaveText('50%');
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  expect(await camera(page)).toEqual(view);
  await page.setViewportSize({ width: 700, height: 500 });
  await expect(page.locator('#zoomReset')).toHaveText('50%');
  expect(await camera(page)).toEqual(view);
  await boardAction(page, 'clear');
  await expect.poll(async () => (await snapshot(page)).commands.at(-1).type).toBe('clear');
  expect(await camera(page)).toEqual(view);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).commands.length).toBe(1);
});

test('preserves the initial view across resize and reopen and anchors native wheel zoom', async ({
  page,
  isMobile,
}) => {
  const initial = await camera(page);
  await page.setViewportSize({ width: 700, height: 500 });
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  expect(await camera(page)).toEqual(initial);
  const rect = await page.locator('#pad').boundingBox();
  const anchor = { x: 150, y: 180 };
  const world = {
    x: initial.center.x + anchor.x - rect.width / 2,
    y: initial.center.y + anchor.y - rect.height / 2,
  };
  await page.mouse.move(rect.x + anchor.x, rect.y + anchor.y);
  await page.keyboard.down('Control');
  // Playwright cannot dispatch native mouse wheels in its mobile WebKit profile.
  if (isMobile)
    await page.locator('#pad').dispatchEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      clientX: rect.x + anchor.x,
      clientY: rect.y + anchor.y,
    });
  else await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(1);
  const zoomed = await camera(page);
  expect(zoomed.center.x + (anchor.x - rect.width / 2) / zoomed.zoom).toBeCloseTo(world.x);
  expect(zoomed.center.y + (anchor.y - rect.height / 2) / zoomed.zoom).toBeCloseTo(world.y);
  expect(await page.evaluate(async () => window.visualViewport.scale)).toBe(1);
  if (isMobile) await page.locator('#pad').dispatchEvent('wheel', { deltaY: 40 });
  else await page.mouse.wheel(0, 40);
  await expect
    .poll(async () => (await camera(page)).center.y)
    .toBeCloseTo(zoomed.center.y + 40 / zoomed.zoom);
  expect((await snapshot(page)).commands).toEqual([]);
});

test('supports temporary Hand navigation and protects active text composition', async ({
  page,
}) => {
  const rect = await page.locator('#pad').boundingBox();
  await page.locator('#pad').focus();
  await page.keyboard.down('Space');
  await page.mouse.move(rect.x + 80, rect.y + 120);
  await page.mouse.down();
  await page.mouse.move(rect.x + 120, rect.y + 160);
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(page.getByRole('button', { name: 'Pen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect((await snapshot(page)).commands).toEqual([]);
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 100, y: 150 } });
  const input = page.locator('notectl-editor').getByRole('textbox');
  await input.pressSequentially('Draft');
  await input.dispatchEvent('compositionstart', { bubbles: true, composed: true, data: '' });
  await page.locator('#pad').dispatchEvent('wheel', {
    deltaY: -200,
    ctrlKey: true,
    clientX: rect.x + 200,
    clientY: rect.y + 200,
  });
  await expect(page.locator('#zoomReset')).toHaveText('100%');
  await expect(input).toBeVisible();
  expect((await snapshot(page)).commands).toEqual([]);
  await input.dispatchEvent('compositionend', { bubbles: true, composed: true, data: '' });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  await expect.poll(async () => (await objects(page))[0]?.paragraphs[0].runs[0].text).toBe('Draft');
  await expect(page.locator('#zoomReset')).toHaveText('125%');
});

test('recovers an offscreen draft into view without changing its board coordinates', async ({
  page,
}) => {
  await seed(page, [], { center: { x: -2000, y: -1500 }, zoom: 0.5 });
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 100, y: 150 } });
  let input = page.locator('notectl-editor').getByRole('textbox');
  await input.pressSequentially('Recovered');
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await (await import('/test/helpers/board-browser.js')).activeBoard()).draft?.object
            .paragraphs[0].runs[0].text
      )
    )
    .toBe('Recovered');
  const position = await page.evaluate(
    async () =>
      (await (await import('/test/helpers/board-browser.js')).activeBoard()).draft.object.position
  );
  await page.evaluate(async () => {
    const { activeBoard, seedBoard } = await import('/test/helpers/board-browser.js');
    const record = await activeBoard();
    await seedBoard({ ...record, viewport: { center: { x: 9000, y: 9000 }, zoom: 1 } });
  });
  await page.reload();
  input = page.locator('notectl-editor').getByRole('textbox');
  await expect(input).toBeVisible();
  await expect(input).toContainText('Recovered');
  await expect.poll(async () => (await camera(page)).center.x).toBeLessThan(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page))[0]?.position).toEqual(position);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeInViewport();
});
