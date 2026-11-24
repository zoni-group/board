import { boardAction } from '../helpers/board-menu.js';
import { test, expect } from '@playwright/test';

const shape = (overrides = {}) => ({
  id: 'shape-1',
  kind: 'rectangle',
  start: { x: 60, y: 80 },
  end: { x: 220, y: 180 },
  size: 6,
  inkRaw: '#2563eb',
  ...overrides,
});
async function snapshot(page) {
  return page.evaluate(async () => (await import('/test/helpers/board-browser.js')).activeBoard());
}
async function shapes(page) {
  return page.evaluate(async () => {
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const { resolveShapes } = await import('/src/board/shapes.ts');
    return resolveShapes((await activeBoard()).commands);
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

async function choose(page, kind) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.locator(`#shapePicker [data-shape="${kind}"]`).click();
  await expect(page.locator('#shapePicker')).toBeHidden();
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
async function drag(page, from, to, modifiers = []) {
  const rect = await page.locator('#pad').boundingBox();
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.mouse.move(rect.x + from.x, rect.y + from.y);
  await page.mouse.down();
  await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 5 });
  await page.mouse.up();
  for (const modifier of modifiers) await page.keyboard.up(modifier);
}
async function pixel(page, x, y) {
  return page
    .locator('#shapeLayer')
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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#shapes')).toBeEnabled();
});

for (const kind of [
  'rectangle',
  'ellipse',
  'line',
  'arrow',
  'triangle',
  'speechBubble',
  'numberLine',
  'axes',
]) {
  test(`draws a ${kind} with a live preview and stores one editable command`, async ({ page }) => {
    await choose(page, kind);
    await pointer(page, 'pointerdown', 1, 60, 100);
    await pointer(page, 'pointermove', 1, 220, 180);
    expect((await snapshot(page)).commands).toHaveLength(0);
    expect(
      await page.locator('#shapeLayer').evaluate((canvas) =>
        canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((value, i) => i % 4 === 3 && value)
      )
    ).toBe(true);
    await pointer(page, 'pointerup', 1, 220, 180);
    await expect.poll(async () => (await snapshot(page)).commands.length).toBe(1);
    expect((await shapes(page))[0]).toMatchObject({
      kind,
      start: { x: 60, y: 100 },
      end: { x: 220, y: 180 },
      size: 6,
    });
    await expect(page.locator('.shape-selection-actions')).toBeVisible();
    await page.reload();
    await expect(page.locator('#shapes')).toBeEnabled();
    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    expect((await shapes(page))[0].kind).toBe(kind);
    await expect(page.locator('#shapeLayer')).toBeVisible();
  });
}

test('constrains reverse drags to squares/circles and arrows to 45-degree angles', async ({
  page,
}) => {
  for (const kind of ['rectangle', 'ellipse', 'arrow']) {
    await seed(page, []);
    await choose(page, kind);
    await drag(page, { x: 220, y: 200 }, { x: 100, y: 160 }, ['Shift']);
    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const object = (await shapes(page))[0];
    if (kind === 'arrow') {
      expect(object.start).toEqual({ x: 220, y: 200 });
      expect(object.end.y).toBeCloseTo(200);
      expect(object.end.x).toBeLessThan(100);
    } else {
      expect(object.start).toEqual({ x: 100, y: 80 });
      expect(object.end).toEqual({ x: 220, y: 200 });
    }
  }
});

test('moves small shapes with touch without mistaking the body for a resize handle', async ({
  page,
}) => {
  for (const kind of ['rectangle', 'ellipse', 'line', 'arrow']) {
    const box = kind === 'rectangle' || kind === 'ellipse';
    const object = shape({ kind, end: { x: 80, y: box ? 100 : 80 }, size: 2 });
    await seed(page, [{ type: 'shape-set', object }]);
    await choose(page, kind);
    const y = box ? 90 : 80;
    await pointer(page, 'pointerdown', 1, 70, y);
    await pointer(page, 'pointerup', 1, 70, y);
    await pointer(page, 'pointerdown', 2, 70, y);
    await pointer(page, 'pointermove', 2, 90, y + 20);
    await pointer(page, 'pointerup', 2, 90, y + 20);
    await expect.poll(async () => (await shapes(page))[0].start).toEqual({ x: 80, y: 100 });
    expect((await shapes(page))[0].end).toEqual({ x: 100, y: object.end.y + 20 });
    expect((await snapshot(page)).commands).toHaveLength(2);
  }
});

test('draws overlapping and nested shapes, then taps to select and move an existing shape', async ({
  page,
}) => {
  const outer = shape();
  await seed(page, [{ type: 'shape-set', object: outer }]);
  await choose(page, 'ellipse');
  await drag(page, { x: 90, y: 100 }, { x: 140, y: 150 });
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
  expect((await shapes(page))[0]).toEqual(outer);
  expect((await shapes(page))[1]).toMatchObject({
    kind: 'ellipse',
    start: { x: 90, y: 100 },
    end: { x: 140, y: 150 },
  });
  await choose(page, 'rectangle');
  await drag(page, { x: 100, y: 120 }, { x: 250, y: 160 });
  await expect.poll(async () => (await shapes(page)).length).toBe(3);
  expect((await shapes(page))[0]).toEqual(outer);
  await page.locator('.shape-selection-actions').getByRole('button', { name: 'Done' }).click();
  await page.locator('#pad').click({ position: { x: 60, y: 130 } });
  await drag(page, { x: 60, y: 130 }, { x: 80, y: 130 });
  await expect.poll(async () => (await shapes(page))[0].start).toEqual({ x: 80, y: 80 });
  expect((await shapes(page))[0].end).toEqual({ x: 240, y: 180 });
});

test('a selected shape shows a Move grip that drags it', async ({ page }) => {
  await seed(page, [{ type: 'shape-set', object: shape({ fill: { color: '#2563eb' } }) }]);
  await page.locator('#select').click();
  await page.locator('#pad').click({ position: { x: 140, y: 130 } });
  const actions = page.locator('.shape-selection-actions');
  await expect(actions.locator('button:visible')).toHaveText([
    'Move',
    'Fill',
    'Duplicate',
    'Delete',
    'Done',
  ]);
  const grip = await actions.getByRole('button', { name: 'Move', exact: true }).boundingBox();
  await page.mouse.move(grip.x + 10, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(grip.x + 40, grip.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await shapes(page))[0].start).toEqual({ x: 90, y: 100 });
  expect((await shapes(page))[0].end).toEqual({ x: 250, y: 200 });
});

test('keeps controls bounded when selecting a stored shape wider than the current slider range', async ({
  page,
}) => {
  const object = shape({ size: 1000 });
  await seed(page, [{ type: 'shape-set', object }]);
  await choose(page, 'rectangle');
  await page.locator('#pad').click({ position: { x: 140, y: 130 } });
  await expect(page.locator('#size')).toHaveValue('22');
  expect(
    await page
      .locator('#sizePreview')
      .evaluate((button) => button.style.getPropertyValue('--board-size-preview'))
  ).toBe('22px');
  expect(await shapes(page)).toEqual([object]);
  expect(
    await page.evaluate(async () => document.documentElement.scrollHeight <= innerHeight)
  ).toBe(true);
});

test('selects, moves, resizes, styles, deletes and restores a shape with undo/redo', async ({
  page,
}) => {
  const object = shape();
  await seed(page, [{ type: 'shape-set', object }]);
  await choose(page, 'rectangle');
  await page.locator('#pad').click({ position: { x: 140, y: 130 } });
  await expect(page.locator('#swatches [data-hex="#2563eb"]')).toHaveClass(/is-active/);
  expect((await snapshot(page)).commands).toHaveLength(1);
  await drag(page, { x: 140, y: 130 }, { x: 160, y: 150 });
  await expect.poll(async () => (await shapes(page))[0].start).toEqual({ x: 80, y: 100 });
  await drag(page, { x: 240, y: 200 }, { x: 260, y: 230 });
  await expect.poll(async () => (await shapes(page))[0].end).toEqual({ x: 260, y: 230 });
  expect((await snapshot(page)).commands).toHaveLength(3);
  await page.locator('#swatches button[data-hex="#e11d48"]').click();
  await expect.poll(async () => (await shapes(page))[0].inkRaw).toBe('#e11d48');
  await expect(page.locator('#shapes')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#size').evaluate((input) => {
    for (const value of [8, 10, 12]) {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  expect((await snapshot(page)).commands).toHaveLength(4);
  await page.locator('#size').dispatchEvent('change');
  await expect.poll(async () => (await shapes(page))[0].size).toBe(12);
  expect((await snapshot(page)).commands).toHaveLength(5);
  await page.locator('.shape-selection-actions').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await shapes(page)).length).toBe(0);
  await page.locator('#undo').click();
  await expect.poll(async () => (await shapes(page))[0]?.size).toBe(12);
  await page.locator('#redo').click();
  await expect.poll(async () => (await shapes(page)).length).toBe(0);
  await page.locator('#undo').click();
  await boardAction(page, 'clear');
  await expect.poll(async () => (await shapes(page)).length).toBe(0);
  await page.locator('#undo').click();
  await expect.poll(async () => (await shapes(page)).length).toBe(1);
});

test('moves and resizes endpoints in world coordinates at zoom, with keyboard editing', async ({
  page,
}) => {
  await seed(
    page,
    [
      {
        type: 'shape-set',
        object: shape({ kind: 'arrow', start: { x: -60, y: -40 }, end: { x: 40, y: -40 } }),
      },
    ],
    { center: { x: 0, y: 0 }, zoom: 2 }
  );
  await choose(page, 'arrow');
  const rect = await page.locator('#pad').boundingBox();
  const from = { x: rect.width / 2 - 20, y: rect.height / 2 - 80 };
  await page.locator('#pad').click({ position: from });
  await drag(page, from, { x: from.x + 40, y: from.y + 20 });
  await expect.poll(async () => (await shapes(page))[0].start).toEqual({ x: -40, y: -30 });
  const endpoint = { x: rect.width / 2 - 80, y: rect.height / 2 - 60 };
  await drag(page, endpoint, { x: endpoint.x - 20, y: endpoint.y + 20 });
  await expect.poll(async () => (await shapes(page))[0].start).toEqual({ x: -50, y: -20 });
  await page.locator('#pad').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await shapes(page))[0].start).toEqual({ x: -40, y: -20 });
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(async () => (await shapes(page))[0].end).toEqual({ x: 70, y: -29 });
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await shapes(page)).length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await shapes(page)).length).toBe(1);
});

test('erases whole shapes only on their outlines and undoes a swept gesture in one step', async ({
  page,
}) => {
  const a = shape(),
    b = shape({ id: 'second', kind: 'ellipse', start: { x: 240, y: 80 }, end: { x: 320, y: 180 } });
  await seed(page, [
    { type: 'shape-set', object: a },
    { type: 'shape-set', object: b },
  ]);
  await page.locator('#erase').click();
  await page.locator('#pad').click({ position: { x: 140, y: 130 } });
  expect(await shapes(page)).toEqual([a, b]);
  await pointer(page, 'pointerdown', 1, 20, 130);
  await pointer(page, 'pointermove', 1, 340, 130);
  await pointer(page, 'pointerup', 1, 340, 130);
  await expect.poll(async () => (await shapes(page)).length).toBe(0);
  expect((await snapshot(page)).commands.at(-1).erasedShapeIds).toEqual([a.id, b.id]);
  await page.locator('#undo').click();
  await expect.poll(() => shapes(page)).toEqual([a, b]);
  await page.reload();
  await expect(page.locator('#shapes')).toBeEnabled();
  await expect.poll(() => shapes(page)).toEqual([a, b]);
});

test('cancels previews and transforms for two-finger navigation, capture loss and Escape', async ({
  page,
}) => {
  await choose(page, 'rectangle');
  await page.locator('#pad').click({ position: { x: 50, y: 100 } });
  expect((await snapshot(page)).commands).toHaveLength(0);
  await pointer(page, 'pointerdown', 1, 50, 100);
  await pointer(page, 'pointermove', 1, 180, 180);
  await pointer(page, 'pointerdown', 2, 250, 180);
  await pointer(page, 'pointermove', 2, 280, 180);
  await pointer(page, 'pointerup', 2, 280, 180);
  await pointer(page, 'pointerup', 1, 180, 180);
  expect((await snapshot(page)).commands).toHaveLength(0);
  const object = shape();
  await seed(page, [{ type: 'shape-set', object }]);
  await choose(page, 'rectangle');
  await page.locator('#pad').click({ position: { x: 140, y: 130 } });
  await pointer(page, 'pointerdown', 3, 140, 130);
  await pointer(page, 'pointermove', 3, 170, 150);
  await pointer(page, 'pointerdown', 4, 270, 150);
  await pointer(page, 'pointerup', 4, 270, 150);
  await pointer(page, 'pointerup', 3, 170, 150);
  expect(await shapes(page)).toEqual([object]);
  await pointer(page, 'pointerdown', 5, 220, 180, { pointerType: 'pen' });
  await pointer(page, 'pointermove', 5, 260, 200, { pointerType: 'pen' });
  await pointer(page, 'lostpointercapture', 5, 260, 200, { pointerType: 'pen' });
  expect(await shapes(page)).toEqual([object]);
  await pointer(page, 'pointerdown', 6, 220, 180);
  await pointer(page, 'pointermove', 6, 260, 200);
  await page.keyboard.press('Escape');
  await pointer(page, 'pointerup', 6, 260, 200);
  expect(await shapes(page)).toEqual([object]);
  expect((await snapshot(page)).commands).toHaveLength(1);
  await page.locator('#erase').click();
  await pointer(page, 'pointerdown', 7, 60, 130);
  expect((await pixel(page, 60, 130))[3]).toBe(0);
  await pointer(page, 'pointerdown', 8, 160, 130);
  await pointer(page, 'pointerup', 8, 160, 130);
  await pointer(page, 'pointerup', 7, 60, 130);
  expect(await shapes(page)).toEqual([object]);
  expect((await pixel(page, 60, 130))[3]).toBeGreaterThan(0);
});

test('keeps the picker, actions and navigation accessible at 320×160 without page scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 160 });
  await page.locator('#shapes').click();
  await expect(page.locator('#shapePicker')).toBeVisible();
  const picker = await page.locator('#shapePicker').boundingBox(),
    nav = await page.locator('.board-navigation').boundingBox();
  expect(picker.y + picker.height).toBeLessThan(nav.y);
  await page.locator('#shapePicker [data-shape="arrow"]').click();
  await pointer(page, 'pointerdown', 1, 5, 10);
  await pointer(page, 'pointermove', 1, 180, 25);
  await pointer(page, 'pointerup', 1, 180, 25);
  await expect.poll(async () => (await shapes(page)).length).toBe(1);
  const actions = await page.locator('.shape-selection-actions').boundingBox();
  expect(actions.y).toBeGreaterThanOrEqual(0);
  expect(actions.y + actions.height).toBeLessThan(nav.y);
  await page.locator('#shapes').click();
  await expect(page.locator('.shape-selection-actions')).toBeHidden();
  await page.locator('#shapePicker [data-shape="arrow"]').click();
  // Choosing a drawing kind dismisses selection; tap the arrow to select again.
  await page.locator('#pad').click({ position: { x: 8, y: 10.3 } });
  expect(
    await page
      .locator('.board-action-strip button:visible, .board-navigation button:visible')
      .evaluateAll((buttons) =>
        buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight &&
            button.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            )
          );
        })
      )
  ).toBe(true);
  expect(
    await page.evaluate(
      async () => document.documentElement.scrollHeight <= innerHeight && scrollY === 0
    )
  ).toBe(true);
  await page.locator('.shape-selection-actions').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await shapes(page)).length).toBe(0);
});

test('includes offscreen shapes in Fit and PNG independently of the current view', async ({
  page,
}) => {
  await seed(page, [
    { type: 'shape-set', object: shape({ start: { x: -300, y: -100 }, end: { x: -100, y: 100 } }) },
    {
      type: 'shape-set',
      object: shape({
        id: 'arrow',
        kind: 'arrow',
        start: { x: 700, y: 300 },
        end: { x: 1000, y: 300 },
        inkRaw: '#cc0000',
      }),
    },
  ]);
  async function png() {
    const pending = page.waitForEvent('download');
    await boardAction(page, 'save');
    const chunks = [];
    for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
    return Buffer.concat(chunks).toString('base64');
  }
  const first = await png();
  const result = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0,
      red = 0,
      transparent = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 37 && pixels[i + 1] === 99 && pixels[i + 2] === 235) blue++;
      if (pixels[i] === 204 && pixels[i + 1] === 0 && pixels[i + 2] === 0) red++;
      if (pixels[i + 3] !== 255) transparent++;
    }
    return { blue, red, transparent, width: image.width };
  }, first);
  expect(result.blue).toBeGreaterThan(500);
  expect(result.red).toBeGreaterThan(500);
  expect(result.transparent).toBe(0);
  expect(result.width).toBe(1370);
  await page.locator('#zoomIn').click();
  expect(await png()).toBe(first);
  await page.locator('#fitDrawing').click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await (await import('/test/helpers/board-browser.js')).activeBoard()).viewport?.center.x
      )
    )
    .toBe(350);
});

test('fills closed shapes from the picker and from a selected shape', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const palette = page.locator('#fillPalette');
  const actions = page.locator('.shape-selection-actions');
  // Choose Blue in the picker's Fill row: the next shapes are filled.
  await page.locator('#shapes').click();
  await page.locator('#shapePicker .shape-fill-row').click();
  await expect(palette).toBeVisible();
  await palette.locator('.swatch[data-hex="#2563eb"]').click();
  await expect(palette).toBeHidden();
  await expect(page.locator('#shapePicker .shape-fill-row')).toHaveAccessibleName(
    'Fill: Blue, light'
  );
  await page.locator('#shapePicker [data-shape="rectangle"]').click();
  await drag(page, { x: 60, y: 100 }, { x: 260, y: 220 });
  await expect.poll(async () => (await shapes(page)).length).toBe(1);
  expect((await shapes(page))[0].fill).toEqual({ color: '#2563eb' });
  const light = await pixel(page, 160, 160);
  expect(light[2]).toBeGreaterThan(light[0] + 40);
  expect(light[3]).toBeLessThan(140);

  // The new shape is selected; its Fill chip makes the fill solid, then removes it.
  const fill = actions.getByRole('button', { name: /^Fill:/ });
  await expect(fill).toHaveAccessibleName('Fill: Blue, light');
  await fill.click();
  await palette.getByRole('button', { name: 'Solid' }).click();
  await expect(palette).toBeVisible();
  await expect
    .poll(async () => (await shapes(page))[0].fill)
    .toEqual({ color: '#2563eb', solid: true });
  expect((await pixel(page, 160, 160))[3]).toBe(255);
  await palette.getByRole('button', { name: 'None' }).click();
  await expect(palette).toBeHidden();
  await expect.poll(async () => (await shapes(page))[0].fill).toBeUndefined();
  expect((await pixel(page, 160, 160))[3]).toBe(0);
  await page.locator('#undo').click();
  await expect
    .poll(async () => (await shapes(page))[0].fill)
    .toEqual({ color: '#2563eb', solid: true });

  // Outline follows the outline colour; a custom colour comes from the device picker.
  await fill.click();
  await palette.getByRole('button', { name: 'Outline' }).click();
  await expect
    .poll(async () => (await shapes(page))[0].fill)
    .toEqual({ color: 'outline', solid: true });
  await fill.click();
  await palette.locator('input[type="color"]').fill('#ff0000');
  await expect
    .poll(async () => (await shapes(page))[0].fill)
    .toEqual({ color: '#ff0000', solid: true });
  await page.reload();
  await expect(page.locator('#shapes')).toBeEnabled();
  expect((await shapes(page))[0].fill).toEqual({ color: '#ff0000', solid: true });

  // Open shapes have no fill.
  await choose(page, 'line');
  await drag(page, { x: 60, y: 300 }, { x: 260, y: 300 });
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('button', { name: /^Fill:/ })).toBeHidden();
  expect((await shapes(page))[1].fill).toBeUndefined();
});

async function paper(page, pattern) {
  await page.evaluate(async (pattern) => {
    window.dispatchEvent(new Event('pagehide'));
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const { updateBoardBackground } = await import('/src/board/storage.ts');
    await updateBoardBackground((await activeBoard()).id, {
      pattern,
      spacing: 'medium',
      color: 'auto',
    });
  }, pattern);
  await page.reload();
  await expect(page.locator('#shapes')).toBeEnabled();
}

test('number lines and axes snap to a grid background and keep its spacing', async ({ page }) => {
  await paper(page, 'grid');
  const onGrid = (point) => point.x % 32 === 0 && point.y % 32 === 0;

  await choose(page, 'numberLine');
  await drag(page, { x: 45, y: 110 }, { x: 290, y: 118 });
  await expect.poll(async () => (await shapes(page)).length).toBe(1);
  const line = (await shapes(page))[0];
  expect(line).toMatchObject({ kind: 'numberLine', step: 32 });
  expect(onGrid(line.start) && onGrid(line.end)).toBe(true);

  // The selected line moves in whole grid steps.
  const middle = { x: (line.start.x + line.end.x) / 2, y: line.start.y };
  await drag(page, middle, { x: middle.x + 45, y: middle.y + 20 });
  await expect.poll(async () => (await shapes(page))[0].start).not.toEqual(line.start);
  const moved = (await shapes(page))[0];
  expect(onGrid(moved.start) && onGrid(moved.end)).toBe(true);
  expect(moved.end.x - moved.start.x).toBe(line.end.x - line.start.x);

  await choose(page, 'axes');
  await drag(page, { x: 50, y: 200 }, { x: 250, y: 330 });
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
  const axes = (await shapes(page))[1];
  expect(axes).toMatchObject({ kind: 'axes', step: 32 });
  expect(onGrid(axes.start)).toBe(true);
  expect((axes.end.x - axes.start.x) % 64).toBe(0);
  expect((axes.end.y - axes.start.y) % 64).toBe(0);

  // On blank paper nothing snaps.
  await seed(page, []);
  await paper(page, 'blank');
  await choose(page, 'numberLine');
  await drag(page, { x: 45, y: 110 }, { x: 290, y: 110 });
  await expect.poll(async () => (await shapes(page)).length).toBe(1);
  const free = (await shapes(page))[0];
  expect(free.step).toBeUndefined();
  expect(free.start).toEqual({ x: 45, y: 110 });
});
