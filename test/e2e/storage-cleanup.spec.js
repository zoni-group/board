import { test, expect } from '@playwright/test';
import { boardAction } from '../helpers/board-menu.js';

// A 1×1 PNG, so the stored image is a real one.
const PNG = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253,
  227, 85, 242, 156, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];
const image = (assetId) => ({
  type: 'content-set',
  object: {
    kind: 'image',
    id: `image-${assetId}`,
    position: { x: 20, y: 30 },
    width: 120,
    height: 80,
    title: 'Picture',
    assetId,
  },
});
const stroke = (id, y) => ({
  type: 'stroke',
  tool: 'pen',
  id,
  size: 4,
  inkRaw: '#111827',
  points: [
    { x: 60, y },
    { x: 200, y },
  ],
});
const emptyPage = (id) => ({ id, commands: [], redoCommands: [], viewport: null });

/** Stores the media, writes the board state, and reloads so the app opens it. */
async function seed(page, { assets = [], ...state }) {
  await page.evaluate(
    async ({ assets, state, png }) => {
      window.dispatchEvent(new Event('pagehide'));
      const { activeBoard, seedBoard } = await import('/test/helpers/board-browser.js');
      const { putAssetRecord } = await import('/src/board/storage.ts');
      const board = await activeBoard();
      for (const id of assets)
        await putAssetRecord({
          id,
          boardId: board.id,
          kind: 'image',
          width: 1,
          height: 1,
          blob: { bytes: new Uint8Array(png).buffer, type: 'image/png' },
        });
      await seedBoard(state);
    },
    { assets, state, png: PNG }
  );
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
}
async function stored(page, id) {
  return page.evaluate(
    async (id) => Boolean(await (await import('/src/board/storage.ts')).getAssetRecord(id)),
    id
  );
}
async function board(page) {
  return page.evaluate(async () => {
    const board = await (await import('/test/helpers/board-browser.js')).activeBoard();
    return { commands: board.commands, pages: board.pages };
  });
}
async function draw(page, y) {
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + 60, rect.y + y);
  await page.mouse.down();
  await page.mouse.move(rect.x + 220, rect.y + y, { steps: 6 });
  await page.mouse.up();
}
/** Clean-up runs about 2 s after a change; wait past it before checking that media stayed. */
const afterCleanup = (page) => page.waitForTimeout(3000);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('opening a board removes media that nothing refers to', async ({ page }) => {
  await seed(page, { assets: ['orphan', 'used'], commands: [image('used')] });
  await expect.poll(() => stored(page, 'orphan')).toBe(false);
  expect(await stored(page, 'used')).toBe(true);
});

test('deleting a page frees its images, but not images a duplicate still shows', async ({
  page,
}) => {
  await seed(page, {
    assets: ['shared', 'own'],
    commands: [image('shared')],
    pages: [emptyPage('page-1'), { ...emptyPage('two'), commands: [image('own')] }],
    pageIndex: 0,
  });
  await page.locator('#pageMenuButton').click();
  await page.locator('#duplicatePage').click();
  await expect(page.locator('#pageMenuButton')).toHaveText('2 / 3');

  // Delete page 3, the only page that shows "own".
  await page.locator('#nextPage').click();
  await page.locator('#pageMenuButton').click();
  await page.locator('#deletePage').click();
  await page.locator('.board-library-panel').getByRole('button', { name: 'Delete page' }).click();
  await expect.poll(() => stored(page, 'own')).toBe(false);

  // Delete page 1; its copy on page 2 still shows "shared".
  await page.keyboard.press('PageUp');
  await expect(page.locator('#pageMenuButton')).toHaveText('1 / 2');
  await page.locator('#pageMenuButton').click();
  await page.locator('#deletePage').click();
  await page.locator('.board-library-panel').getByRole('button', { name: 'Delete page' }).click();
  await expect(page.locator('#pageNav')).toBeHidden();
  await afterCleanup(page);
  expect(await stored(page, 'shared')).toBe(true);
});

test('Undo keeps an image for Redo; new drawing then frees it', async ({ page }) => {
  await seed(page, { assets: ['undone'], commands: [image('undone')] });
  await page.locator('#undo').click();
  await afterCleanup(page);
  expect(await stored(page, 'undone')).toBe(true);
  await draw(page, 300);
  await expect(page.locator('#redo')).toBeDisabled();
  await expect.poll(() => stored(page, 'undone')).toBe(false);
});

test('Clear keeps images so Undo can restore them', async ({ page }) => {
  await seed(page, { assets: ['cleared'], commands: [image('cleared')] });
  await boardAction(page, 'clear');
  await afterCleanup(page);
  expect(await stored(page, 'cleared')).toBe(true);
  await page.locator('#undo').click();
  await expect.poll(async () => (await board(page)).commands).toEqual([image('cleared')]);
});

test('Free up space drops history before Clear and frees its images', async ({ page }) => {
  await seed(page, {
    assets: ['old', 'closed'],
    commands: [image('old'), { type: 'clear' }, stroke('kept', 200)],
    pages: [
      emptyPage('page-1'),
      { ...emptyPage('two'), commands: [image('closed'), { type: 'clear' }] },
    ],
    pageIndex: 0,
  });
  await boardAction(page, 'boardSettings');
  const panel = page.locator('.board-settings-panel');
  await panel.locator('#freeUpSpace').click();
  await expect(panel).toContainText('on all boards?');
  await panel.locator('#confirmFreeUpSpace').click();
  await expect(panel.locator('.settings-free-result')).toHaveText(/Freed|Nothing to free up/);
  expect(await stored(page, 'old')).toBe(false);
  expect(await stored(page, 'closed')).toBe(false);
  await panel.getByRole('button', { name: 'Done' }).click();
  const saved = await board(page);
  expect(saved.commands).toEqual([stroke('kept', 200)]);
  expect(saved.pages[1].commands).toEqual([]);
  // The drawing after the Clear can still be undone, but nothing before it.
  await page.locator('#undo').click();
  await expect.poll(async () => (await board(page)).commands).toEqual([]);
  await expect(page.locator('#undo')).toBeDisabled();
});
