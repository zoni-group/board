import { boardAction } from '../helpers/board-menu.js';
import { chooseObject } from '../helpers/object-picker.js';
import { test, expect } from '@playwright/test';
import { textObject } from '../helpers/text-fixture.js';
import { imageObject, tableObject } from '../helpers/content-fixture.js';

const pen = (overrides = {}) => ({
  type: 'stroke',
  tool: 'pen',
  id: 'ink-1',
  size: 8,
  inkRaw: '#2563eb',
  points: [
    { x: 60, y: 120 },
    { x: 240, y: 120 },
  ],
  ...overrides,
});
const box = () => ({
  id: 'shape-1',
  kind: 'rectangle',
  start: { x: 60, y: 80 },
  end: { x: 240, y: 180 },
  size: 6,
  inkRaw: '#2563eb',
});
const eraser = (x, y, size = 36) => ({
  type: 'stroke',
  tool: 'eraser',
  size,
  inkRaw: '#000000',
  points: [{ x, y }],
});
async function snapshot(page) {
  return page.evaluate(async () => (await import('/test/helpers/board-browser.js')).activeBoard());
}
async function scene(page) {
  return page.evaluate(async () => {
    const commands = (await (await import('/test/helpers/board-browser.js')).activeBoard())
      .commands;
    const { createBoardScene } = await import('/src/board/scene-renderer.ts');
    return createBoardScene(commands, document.getElementById('textLayer').getContext('2d'));
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

async function pointer(page, type, id, x, y, extra = {}) {
  const rect = await page.locator('#pad').boundingBox();
  await page.locator('#pad').dispatchEvent(type, {
    pointerId: id,
    pointerType: 'touch',
    clientX: rect.x + x,
    clientY: rect.y + y,
    button: 0,
    bubbles: true,
    ...extra,
  });
}
async function drag(page, from, to) {
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + from.x, rect.y + from.y);
  await page.mouse.down();
  await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 4 });
  await page.mouse.up();
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
async function png(page) {
  const pending = page.waitForEvent('download');
  await boardAction(page, 'save');
  const chunks = [];
  for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('base64');
}
const fixture = (kind) =>
  kind === 'stroke'
    ? [pen()]
    : kind === 'shape'
      ? [{ type: 'shape-set', object: box() }]
      : [{ type: 'text-set', object: textObject({ position: { x: 80, y: 100 } }) }];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#select')).toBeEnabled();
});

for (const kind of ['stroke', 'shape', 'text']) {
  test(`Select moves and deletes a ${kind}, with one history entry and undo/redo`, async ({
    page,
    isMobile,
  }) => {
    await seed(page, fixture(kind));
    await page.locator('#select').click();
    const target = { x: 100, y: kind === 'shape' ? 130 : 120 };
    if (isMobile) {
      const rect = await page.locator('#pad').boundingBox();
      await page.touchscreen.tap(rect.x + target.x, rect.y + target.y);
    } else await page.locator('#pad').click({ position: target });
    await expect(page.locator('.object-selection-actions')).toBeVisible();
    expect((await snapshot(page)).commands).toHaveLength(1);
    await drag(page, target, { x: target.x + 20, y: target.y + 30 });
    await expect.poll(async () => (await snapshot(page)).commands.length).toBe(2);
    const moved = await scene(page);
    if (kind === 'stroke') expect(moved.strokes[0].offset).toEqual({ x: 20, y: 30 });
    if (kind === 'shape') expect(moved.shapes[0].start).toEqual({ x: 80, y: 110 });
    if (kind === 'text') expect(moved.text[0].position).toEqual({ x: 100, y: 130 });
    await page
      .locator('.object-selection-actions')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    const key = kind === 'stroke' ? 'strokes' : kind === 'shape' ? 'shapes' : 'text';
    await expect.poll(async () => (await scene(page))[key].length).toBe(0);
    await page.locator('#undo').click();
    await expect.poll(async () => (await scene(page))[key].length).toBe(1);
    await page.locator('#redo').click();
    await expect.poll(async () => (await scene(page))[key].length).toBe(0);
    await page.locator('#undo').click();
    await expect.poll(async () => (await scene(page))[key].length).toBe(1);
    await page.reload();
    await expect(page.locator('#select')).toBeEnabled();
    expect((await scene(page))[key]).toEqual(moved[key]);
  });
}

for (const kind of ['stroke', 'shape']) {
  test(`Select changes ${kind} color and width without changing tools or adding redundant history`, async ({
    page,
  }) => {
    await seed(page, fixture(kind));
    await page.locator('#select').click();
    await page.locator('#pad').click({ position: { x: 100, y: 120 } });
    await page.locator('#swatches [data-hex="#2563eb"]').click();
    expect((await snapshot(page)).commands).toHaveLength(1);
    await page.locator('#swatches [data-hex="#e11d48"]').click();
    await expect.poll(async () => (await snapshot(page)).commands.length).toBe(2);
    await page.locator('#size').evaluate((input) => {
      for (const value of [10, 12, 14]) {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    expect((await snapshot(page)).commands).toHaveLength(2);
    await page.locator('#size').dispatchEvent('change');
    await expect.poll(async () => (await snapshot(page)).commands.length).toBe(3);
    await expect(page.locator('#select')).toHaveAttribute('aria-pressed', 'true');
    const styled = await scene(page),
      object = kind === 'stroke' ? styled.strokes[0].stroke : styled.shapes[0];
    expect(object).toMatchObject({ size: 14, inkRaw: '#e11d48' });
    await page.locator('#undo').click();
    await expect(page.locator('#size')).toHaveValue(kind === 'stroke' ? '8' : '6');
    await page.locator('#redo').click();
    await expect(page.locator('#size')).toHaveValue('14');
    await page.locator('#sizePreview').click();
    await page.locator('#hexInput').focus();
    await page.locator('#hexInput').press('Delete');
    expect((await snapshot(page)).commands).toHaveLength(3);
    await page.locator('#hexInput').fill('#123456');
    await page.locator('#hexInput').press('Tab');
    await page.locator('#colorPopupClose').click();
    await expect
      .poll(async () => {
        const current = await scene(page);
        return kind === 'stroke' ? current.strokes[0].stroke.inkRaw : current.shapes[0].inkRaw;
      })
      .toBe('#123456');
    expect((await snapshot(page)).commands).toHaveLength(4);
    await expect(page.locator('#select')).toHaveAttribute('aria-pressed', 'true');
    if (kind === 'stroke') expect((await snapshot(page)).commands[0]).toEqual(pen());
  });
}

test('selects visible ink, moves partial erasing with it, and keeps subsequent erasing after reload', async ({
  page,
}) => {
  await seed(page, [
    pen({
      points: [
        { x: 50, y: 120 },
        { x: 250, y: 120 },
      ],
    }),
    eraser(150, 120),
    pen({
      id: 'later',
      inkRaw: '#cc0000',
      points: [
        { x: 60, y: 200 },
        { x: 240, y: 200 },
      ],
    }),
  ]);
  await page.locator('#select').click();
  await page.locator('#pad').click({ position: { x: 150, y: 120 } });
  await expect(page.locator('.object-selection')).toBeHidden();
  await pointer(page, 'pointerdown', 1, 100, 120);
  await pointer(page, 'pointermove', 1, 140, 150);
  await expect(page.locator('#size')).toBeDisabled();
  expect((await snapshot(page)).commands).toHaveLength(3);
  expect(await pixel(page, 100, 120)).toEqual([255, 255, 255, 255]);
  expect(await pixel(page, 140, 150)).toEqual([37, 99, 235, 255]);
  expect(await pixel(page, 190, 150)).toEqual([255, 255, 255, 255]);
  await pointer(page, 'pointerup', 1, 140, 150);
  await expect(page.locator('#size')).toBeEnabled();
  await expect.poll(async () => (await scene(page)).strokes[0].offset).toEqual({ x: 40, y: 30 });
  expect(await pixel(page, 100, 200)).toEqual([204, 0, 0, 255]);
  await page.locator('#erase').click();
  await page.locator('#size').fill('20');
  // Size intentionally activates Pen in drawing modes; explicitly resume Eraser.
  await page.locator('#erase').click();
  await page.locator('#pad').click({ position: { x: 220, y: 150 } });
  await page.locator('#select').click();
  await drag(page, { x: 140, y: 150 }, { x: 100, y: 170 });
  await expect.poll(async () => (await scene(page)).strokes[0].offset).toEqual({ x: 0, y: 50 });
  expect(await pixel(page, 100, 170)).toEqual([37, 99, 235, 255]);
  expect(await pixel(page, 150, 170)).toEqual([255, 255, 255, 255]);
  expect(await pixel(page, 180, 170)).toEqual([255, 255, 255, 255]);
  const selectedExport = await png(page);
  await page.reload();
  await expect(page.locator('#select')).toBeEnabled();
  expect(await pixel(page, 150, 170)).toEqual([255, 255, 255, 255]);
  expect(await pixel(page, 180, 170)).toEqual([255, 255, 255, 255]);
  expect(await png(page)).toBe(selectedExport);
});

test('picks text above shapes above ink, and edits text through the existing editor while Select stays active', async ({
  page,
}) => {
  const object = textObject({ position: { x: 80, y: 95 } });
  object.paragraphs[0].runs[0].highlightRaw = '#fff176';
  await seed(page, [pen(), { type: 'shape-set', object: box() }, { type: 'text-set', object }]);
  await page.locator('#select').click();
  await page.locator('#pad').click({ position: { x: 100, y: 120 } });
  await expect(page.locator('#size')).toBeDisabled();
  await expect(page.locator('#sizePreview')).toBeDisabled();
  await page.locator('.object-selection-actions').getByRole('button', { name: 'Edit' }).click();
  const input = page.locator('notectl-editor').getByRole('textbox');
  await input.press('End');
  await input.pressSequentially('!');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => (await scene(page)).text[0].paragraphs[0].runs[0].text)
    .toBe('Hello!');
  expect((await scene(page)).text[0].paragraphs[0].runs[0].highlightRaw).toBe('#fff176');
  await expect(page.locator('#select')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.object-selection-actions').getByRole('button', { name: 'Delete' }).click();
  await page.locator('#pad').click({ position: { x: 100, y: 120 } });
  await expect(page.locator('#size')).toBeEnabled();
  await expect(page.locator('.shape-selection-actions')).toBeVisible();
  await page.locator('.object-selection-actions').getByRole('button', { name: 'Delete' }).click();
  await page.locator('#pad').click({ position: { x: 100, y: 120 } });
  await expect(page.locator('.stroke-selection-actions')).toBeVisible();
  await page.locator('#pad').press('Delete');
  await expect.poll(async () => (await scene(page)).strokes.length).toBe(0);
  for (let i = 0; i < 3; i++) await page.locator('#undo').click();
  await expect.poll(async () => (await scene(page)).text.length).toBe(1);
  expect((await scene(page)).shapes).toHaveLength(1);
  expect((await scene(page)).strokes).toHaveLength(1);
});

// One test per kind: each reloads the page, which a slow runner cannot fit three times in one timeout.
for (const kind of ['stroke', 'shape', 'text']) {
  test(`cancels ${kind} moves on second touch, capture loss, Escape and blur`, async ({ page }) => {
    await seed(page, fixture(kind));
    await page.locator('#select').click();
    const original = await snapshot(page),
      y = kind === 'shape' ? 130 : 120;
    await pointer(page, 'pointerdown', 1, 100, y);
    await pointer(page, 'pointermove', 1, 130, y + 20);
    await pointer(page, 'pointerdown', 2, 230, y + 20);
    await pointer(page, 'pointerup', 2, 230, y + 20);
    await pointer(page, 'pointerup', 1, 130, y + 20);
    expect(await snapshot(page)).toEqual(original);
    await pointer(page, 'pointerdown', 3, 100, y);
    await pointer(page, 'pointermove', 3, 130, y + 20);
    await pointer(page, 'lostpointercapture', 3, 130, y + 20);
    expect(await snapshot(page)).toEqual(original);
    await pointer(page, 'pointerdown', 4, 100, y);
    await pointer(page, 'pointermove', 4, 130, y + 20);
    await page.keyboard.press('Escape');
    await pointer(page, 'pointerup', 4, 130, y + 20);
    expect(await snapshot(page)).toEqual(original);
    await pointer(page, 'pointerdown', 5, 100, y);
    await pointer(page, 'pointermove', 5, 130, y + 20);
    await page.evaluate(async () => window.dispatchEvent(new Event('blur')));
    await pointer(page, 'pointerup', 5, 130, y + 20);
    expect(await snapshot(page)).toEqual(original);
  });
}

test('supports V, keyboard movement, shape resizing, blank deselection and stylus palm rejection', async ({
  page,
}) => {
  await seed(page, [{ type: 'shape-set', object: box() }]);
  await page.locator('#pad').focus();
  await page.keyboard.press('v');
  await expect(page.locator('#select')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pad').click({ position: { x: 100, y: 130 } });
  await drag(page, { x: 240, y: 180 }, { x: 260, y: 200 });
  await expect.poll(async () => (await scene(page)).shapes[0].end).toEqual({ x: 260, y: 200 });
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await scene(page)).shapes[0].start).toEqual({ x: 70, y: 81 });
  await page.locator('#pad').click({ position: { x: 300, y: 250 } });
  await expect(page.locator('.object-selection-actions')).toBeHidden();
  await seed(page, [pen()]);
  await page.locator('#select').click();
  await pointer(page, 'pointerdown', 10, 100, 120, { pointerType: 'pen' });
  await pointer(page, 'pointerdown', 11, 250, 120);
  await pointer(page, 'pointermove', 10, 120, 140, { pointerType: 'pen' });
  await pointer(page, 'pointerup', 11, 250, 120);
  await pointer(page, 'pointerup', 10, 120, 140, { pointerType: 'pen' });
  await expect.poll(async () => (await scene(page)).strokes[0].offset).toEqual({ x: 20, y: 20 });
  expect((await snapshot(page)).commands).toHaveLength(2);
});

test('moves and erases ink in negative world coordinates at zoom, with whole-board PNG and Fit', async ({
  page,
}) => {
  const original = pen({
    points: [
      { x: -100, y: -100 },
      { x: 100, y: -100 },
    ],
  });
  await seed(page, [original, eraser(0, -100)], { center: { x: 0, y: -100 }, zoom: 2 });
  await page.locator('#select').click();
  const rect = await page.locator('#pad').boundingBox();
  const start = { x: rect.width / 2 - 100, y: rect.height / 2 };
  await drag(page, start, { x: start.x + 40, y: start.y + 20 });
  await expect.poll(async () => (await scene(page)).strokes[0].offset).toEqual({ x: 20, y: 10 });
  const first = await png(page);
  await page.locator('#zoomOut').click();
  expect(await png(page)).toBe(first);
  await page.locator('#fitDrawing').click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await (await import('/test/helpers/board-browser.js')).activeBoard()).viewport.center
      )
    )
    .toEqual({ x: 20, y: -90 });
  expect(await png(page)).toBe(first);
});

test('a second touch cancels movement begun with the existing Text Move handle', async ({
  page,
}) => {
  const commands = fixture('text');
  await seed(page, commands);
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 100, y: 120 } });
  const move = page.getByRole('button', { name: 'Move', exact: true });
  const rect = await move.boundingBox();
  await move.dispatchEvent('pointerdown', {
    pointerId: 71,
    pointerType: 'touch',
    clientX: rect.x + 10,
    clientY: rect.y + 10,
    button: 0,
  });
  await page.locator('#pad').dispatchEvent('pointermove', {
    pointerId: 71,
    pointerType: 'touch',
    clientX: rect.x + 40,
    clientY: rect.y + 40,
  });
  await pointer(page, 'pointerdown', 72, 200, 200);
  await pointer(page, 'pointerup', 72, 200, 200);
  await pointer(page, 'pointerup', 71, 100, 200);
  expect((await snapshot(page)).commands).toEqual(commands);
  await expect(move).toBeVisible();
});

test('blocks switching to Select during text composition and preserves text editor undo', async ({
  page,
}) => {
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 80, y: 100 } });
  const input = page.locator('notectl-editor').getByRole('textbox');
  await input.pressSequentially('Draft');
  await input.dispatchEvent('compositionstart', { bubbles: true, composed: true, data: '' });
  await page.locator('#select').click();
  await expect(page.locator('#text')).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toBeVisible();
  expect((await snapshot(page)).commands).toHaveLength(0);
  await input.dispatchEvent('compositionend', { bubbles: true, composed: true, data: '' });
  await page.locator('#select').click();
  await expect(page.locator('#select')).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await scene(page)).text[0]?.paragraphs[0].runs[0].text)
    .toBe('Draft');
  await page.locator('.object-selection-actions').getByRole('button', { name: 'Edit' }).click();
  const reopened = page.locator('notectl-editor').getByRole('textbox');
  await reopened.press('End');
  await reopened.pressSequentially('!');
  await page.locator('#undo').click();
  await expect(reopened).not.toContainText('!');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await snapshot(page)).commands).toHaveLength(1);
  await expect(page.locator('#select')).toHaveAttribute('aria-pressed', 'true');
});

test('reports failed object saves, preserves the previous snapshot and retries the full history on the next edit', async ({
  page,
}) => {
  await seed(page, [pen()]);
  await page.evaluate(async () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'boards' && !window.allowObjectSave)
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await page.locator('#select').click();
  await drag(page, { x: 100, y: 120 }, { x: 130, y: 140 });
  await expect(page.locator('#status')).toContainText('Could not save the change');
  expect((await snapshot(page)).commands).toEqual([pen()]);
  expect(await pixel(page, 130, 140)).toEqual([37, 99, 235, 255]);
  await page.evaluate(async () => {
    window.allowObjectSave = true;
  });
  await page.locator('#pad').press('ArrowRight');
  await expect.poll(async () => (await scene(page)).strokes[0].offset).toEqual({ x: 31, y: 20 });
  await page.reload();
  await expect(page.locator('#select')).toBeEnabled();
  expect((await scene(page)).strokes[0].offset).toEqual({ x: 31, y: 20 });
});

test('every selected object shows a Move grip that drags it', async ({ page }) => {
  const video = {
    kind: 'video',
    id: 'video-1',
    position: { x: 20, y: 260 },
    width: 200,
    height: 112,
    title: 'Clip',
    source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
  };
  await seed(page, [
    { type: 'content-set', object: imageObject() },
    { type: 'text-set', object: textObject({ position: { x: 20, y: 190 } }) },
    { type: 'content-set', object: video },
    { type: 'content-set', object: { ...tableObject(), position: { x: 20, y: 400 } } },
    pen({
      points: [
        { x: 250, y: 200 },
        { x: 330, y: 200 },
      ],
    }),
  ]);
  await page.locator('#select').click();
  const actions = page.locator('.object-selection-actions');
  const grip = actions.getByRole('button', { name: 'Move', exact: true });
  for (const [x, y] of [
    [40, 210],
    [120, 316],
    [100, 430],
  ]) {
    await page.locator('#pad').click({ position: { x, y } });
    await expect(grip).toBeVisible();
  }
  // A pen stroke too: drag it by the grip.
  await page.locator('#pad').click({ position: { x: 290, y: 200 } });
  await expect(grip).toBeVisible();
  const strokeGrip = await grip.boundingBox();
  await page.mouse.move(strokeGrip.x + 10, strokeGrip.y + 10);
  await page.mouse.down();
  await page.mouse.move(strokeGrip.x + 30, strokeGrip.y + 50, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await scene(page)).strokes.find((o) => o.id === 'ink-1').offset)
    .toEqual({ x: 20, y: 40 });

  // Drag the image by its grip.
  await page.locator('#pad').click({ position: { x: 120, y: 80 } });
  const rect = await grip.boundingBox();
  await page.mouse.move(rect.x + 10, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(rect.x + 40, rect.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await scene(page)).content.find((o) => o.id === 'image-1').position)
    .toEqual({ x: 50, y: 50 });
});
