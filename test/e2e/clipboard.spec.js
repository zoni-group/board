import { test, expect } from '@playwright/test';
import { boardAction } from '../helpers/board-menu.js';
import { chooseObject } from '../helpers/object-picker.js';
import { chooseSelectMode, selectSelectTool } from '../helpers/select-picker.js';
import { textObject } from '../helpers/text-fixture.js';

// Filled, so a tap anywhere inside selects it. Coordinates fit a phone-width pad.
const card = (id, x, y) => ({
  type: 'shape-set',
  object: {
    id,
    kind: 'rectangle',
    start: { x, y },
    end: { x: x + 80, y: y + 50 },
    size: 4,
    inkRaw: '#2563eb',
    fill: { color: '#2563eb' },
  },
});
const stroke = (id, x0, x1, y) => ({
  type: 'stroke',
  tool: 'pen',
  id,
  size: 4,
  inkRaw: '#111827',
  points: Array.from({ length: 6 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 5, y })),
});

async function board(page) {
  return page.evaluate(async () => {
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const { createBoardScene } = await import('/src/board/scene-renderer.ts');
    const board = await activeBoard();
    const scene = createBoardScene(
      board.commands,
      document.createElement('canvas').getContext('2d')
    );
    return {
      id: board.id,
      shapes: scene.shapes,
      strokes: scene.strokes.map((s) => ({ id: s.id, points: s.stroke.points })),
      text: scene.text,
      content: scene.content,
    };
  });
}
const shapes = async (page) => (await board(page)).shapes;
async function seed(page, commands) {
  await page.evaluate(async (commands) => {
    window.dispatchEvent(new Event('pagehide'));
    const { seedBoard } = await import('/test/helpers/board-browser.js');
    await seedBoard({ commands });
  }, commands);
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
}
/** Taps a board point (in board units) with the Select tool. */
async function tapAt(page, x, y) {
  const at = await page.evaluate(
    async ({ x, y }) => {
      const { worldToScreen } = await import('/src/board/viewport.ts');
      const { activeBoard } = await import('/test/helpers/board-browser.js');
      const { initialViewport } = await import('/src/board/viewport.ts');
      const pad = document.querySelector('#pad').getBoundingClientRect();
      const view = (await activeBoard()).viewport ?? initialViewport(pad);
      return worldToScreen({ x, y }, view, pad);
    },
    { x, y }
  );
  await page.locator('#pad').click({ position: at });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('Duplicate places a selected copy next to the original; one Undo removes it', async ({
  page,
}) => {
  await seed(page, [card('a', 0, 0)]);
  await selectSelectTool(page);
  await tapAt(page, 40, 25);
  const actions = page.locator('.object-selection-actions');
  await expect(actions.locator('button:visible')).toHaveText([
    'Move',
    'Fill',
    'Duplicate',
    'Order',
    'Delete',
    'Done',
  ]);
  await actions.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('#status')).toContainText('Duplicated');
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
  const [original, copy] = await shapes(page);
  expect(copy.id).not.toBe(original.id);
  expect(copy.start).toEqual({ x: 24, y: 24 });
  expect(copy.fill).toEqual(original.fill);

  // The copy is selected: duplicating again cascades from it.
  await actions.getByRole('button', { name: 'Duplicate' }).click();
  await expect.poll(async () => (await shapes(page)).length).toBe(3);
  expect((await shapes(page))[2].start).toEqual({ x: 48, y: 48 });

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
});

test('Ctrl+D duplicates a Box selection as one undo step', async ({ page }) => {
  await seed(page, [
    card('a', 40, 40),
    stroke('s', 40, 120, 130),
    { type: 'text-set', object: textObject({ id: 't', position: { x: 40, y: 150 } }) },
  ]);
  await chooseSelectMode(page, 'box');
  const rect = await page.locator('#pad').boundingBox();
  const corner = await page.evaluate(async () => {
    const { worldToScreen, initialViewport } = await import('/src/board/viewport.ts');
    const pad = document.querySelector('#pad').getBoundingClientRect();
    return [
      worldToScreen({ x: 20, y: 20 }, initialViewport(pad), pad),
      worldToScreen({ x: 200, y: 230 }, initialViewport(pad), pad),
    ];
  });
  await page.mouse.move(rect.x + corner[0].x, rect.y + corner[0].y);
  await page.mouse.down();
  await page.mouse.move(rect.x + corner[1].x, rect.y + corner[1].y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#status')).toContainText('3 objects selected');
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('#status')).toContainText('3 objects duplicated');
  await expect
    .poll(async () => {
      const b = await board(page);
      return [b.shapes.length, b.strokes.length, b.text.length];
    })
    .toEqual([2, 2, 2]);
  const after = await board(page);
  expect(after.strokes[1].points[0]).toEqual({ x: 64, y: 154 });
  expect(after.text[1].position).toEqual({ x: 64, y: 174 });
  await expect(page.locator('#groupSelection')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => {
      const b = await board(page);
      return [b.shapes.length, b.strokes.length, b.text.length];
    })
    .toEqual([1, 1, 1]);
});

test('Ctrl+C and Ctrl+V copy to another page; Cut and paste puts it back in place', async ({
  page,
}) => {
  await seed(page, [card('a', 0, 0)]);
  await selectSelectTool(page);
  await tapAt(page, 40, 25);
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.locator('#status')).toContainText('Copied');

  // Same page: a paste lands next to the original.
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
  expect((await shapes(page))[1].start).toEqual({ x: 24, y: 24 });

  await boardAction(page, 'addPage');
  await expect(page.locator('#pageMenuButton')).toHaveText('2 / 2');
  await page.locator('#pad').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#status')).toContainText('Pasted');
  await expect.poll(async () => (await shapes(page)).length).toBe(1);
  // Another page: centred in the view.
  const centre = await page.evaluate(async () => {
    const { initialViewport } = await import('/src/board/viewport.ts');
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const pad = document.querySelector('#pad').getBoundingClientRect();
    return ((await activeBoard()).viewport ?? initialViewport(pad)).center;
  });
  const [pasted] = await shapes(page);
  expect((pasted.start.x + pasted.end.x) / 2).toBeCloseTo(centre.x, 0);
  expect((pasted.start.y + pasted.end.y) / 2).toBeCloseTo(centre.y, 0);
  await expect(page.locator('#objectSelection')).toBeVisible();

  // Cut removes it; the first paste puts it back where it was.
  await page.keyboard.press('ControlOrMeta+x');
  await expect(page.locator('#status')).toContainText('Cut');
  await expect.poll(async () => (await shapes(page)).length).toBe(0);
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await shapes(page)).length).toBe(1);
  expect((await shapes(page))[0].start).toEqual(pasted.start);
});

test('a copied image pastes into another board with its own stored copy', async ({ page }) => {
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 120, 80);
    return c.toDataURL().split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await chooseObject(page, 'image');
  await (
    await chooser
  ).setFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await expect.poll(async () => (await board(page)).content.length).toBe(1);
  const source = await board(page);
  const image = source.content[0];
  await selectSelectTool(page);
  await tapAt(page, image.position.x + image.width / 2, image.position.y + image.height / 2);
  await expect(page.locator('#objectSelection')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.locator('#status')).toContainText('Copied');

  await boardAction(page, 'newBoard');
  await expect.poll(async () => (await board(page)).id).not.toBe(source.id);
  await expect(page.locator('#boards')).toBeEnabled();
  await page.locator('#pad').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await board(page)).content.length).toBe(1);
  const pasted = (await board(page)).content[0];
  expect(pasted.assetId).not.toBe(image.assetId);
  const stored = await page.evaluate(async (id) => {
    const { readAsset } = await import('/src/board/assets.ts');
    const asset = await readAsset(id);
    return asset ? { type: asset.blob.type, width: asset.width } : null;
  }, pasted.assetId);
  expect(stored).toEqual({ type: 'image/png', width: 120 });
});

test('text editing keeps its own paste, and a locked board ignores the shortcuts', async ({
  page,
}) => {
  await seed(page, [card('a', 0, 0)]);
  await selectSelectTool(page);
  await tapAt(page, 40, 25);
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.locator('#status')).toContainText('Copied');

  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 30, y: 200 } });
  const input = page.locator('notectl-editor').getByRole('textbox');
  await expect(input).toBeVisible();
  await input.press('ControlOrMeta+v');
  await input.pressSequentially('Hi');
  await page.waitForTimeout(300);
  expect((await shapes(page)).length).toBe(1);
  await page.keyboard.press('Escape');

  await boardAction(page, 'lockBoard');
  await page.locator('#pad').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await page.keyboard.press('ControlOrMeta+d');
  await page.waitForTimeout(300);
  expect((await shapes(page)).length).toBe(1);
});
