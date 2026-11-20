import { test, expect } from '@playwright/test';
import { boardAction } from '../helpers/board-menu.js';
import { chooseObject } from '../helpers/object-picker.js';

async function board(page) {
  return page.evaluate(async () => {
    const board = await (await import('/test/helpers/board-browser.js')).activeBoard();
    return { commands: board.commands, pages: board.pages, pageIndex: board.pageIndex };
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
const label = (page) => page.locator('#pageMenuButton');
async function pageAction(page, id) {
  await page.locator('#pageMenuButton').click();
  await expect(page.locator('#pageMenu')).toBeVisible();
  await page.locator(`#pageMenu #${id}`).click();
}
const pageIds = async (page) => (await board(page)).pages.map((p) => p.id);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('a one-page board shows no page control and keeps the toolbar unchanged', async ({ page }) => {
  await expect(page.locator('#pageNav')).toBeHidden();
  await expect(page.locator('.board-action-strip > button')).toHaveCount(7);
  await page.locator('#boards').click();
  await expect(page.locator('#boardMenu #addPage')).toHaveText('Add page');
});

test('each page keeps its own drawing and undo history, and survives reload', async ({ page }) => {
  await drag(page, 120);
  await expect.poll(async () => (await board(page)).commands.length).toBe(1);

  await boardAction(page, 'addPage');
  await expect(page.locator('#pageNav')).toBeVisible();
  await expect(label(page)).toHaveText('2 / 2');
  await expect(page.locator('#status')).toContainText('Page 2 of 2');
  await expect(page.locator('#nextPage')).toBeDisabled();
  await expect(page.locator('#undo')).toBeDisabled();

  await drag(page, 200);
  await drag(page, 240);
  await expect.poll(async () => (await board(page)).commands.length).toBe(2);
  await page.locator('#undo').click();
  await expect.poll(async () => (await board(page)).commands.length).toBe(1);

  await page.locator('#prevPage').click();
  await expect(label(page)).toHaveText('1 / 2');
  await expect.poll(async () => (await board(page)).pageIndex).toBe(0);
  const saved = await board(page);
  expect(saved.pages).toHaveLength(2);
  expect(saved.commands).toHaveLength(1);
  expect(saved.commands[0].points[0].y).toBeCloseTo(120, 0);
  expect(saved.pages[1].commands).toHaveLength(1);
  expect(saved.pages[1].redoCommands).toHaveLength(1);
  // Page 1's history is its own: one undo step, nothing to redo.
  await expect(page.locator('#redo')).toBeDisabled();

  await page.locator('#nextPage').click();
  await expect(label(page)).toHaveText('2 / 2');
  await expect(page.locator('#redo')).toBeEnabled();
  await expect.poll(async () => (await board(page)).pageIndex).toBe(1);
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await expect(label(page)).toHaveText('2 / 2');
  expect((await board(page)).commands[0].points[0].y).toBeCloseTo(200, 0);
});

test('PageUp and PageDown change pages, but not while typing', async ({ page, isMobile }) => {
  await boardAction(page, 'addPage');
  await expect(label(page)).toHaveText('2 / 2');
  await page.keyboard.press('PageUp');
  await expect(label(page)).toHaveText('1 / 2');
  await page.keyboard.press('PageDown');
  await expect(label(page)).toHaveText('2 / 2');
  test.skip(isMobile, 'The text editor keyboard path is covered on desktop.');
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 100, y: 150 } });
  const input = page.locator('notectl-editor').getByRole('textbox');
  await expect(input).toBeVisible();
  await input.pressSequentially('Step 2');
  await page.keyboard.press('PageUp');
  await expect(label(page)).toHaveText('2 / 2');
});

test('the page control stays clear of the zoom bar on every screen size', async ({ page }) => {
  await boardAction(page, 'addPage');
  const pages = await page.locator('#pageNav').boundingBox(),
    zoom = await page.locator('.board-navigation').boundingBox();
  const overlaps =
    pages.x < zoom.x + zoom.width &&
    zoom.x < pages.x + pages.width &&
    pages.y < zoom.y + zoom.height &&
    zoom.y < pages.y + pages.height;
  expect(overlaps).toBe(false);
  const viewport = page.viewportSize();
  expect(pages.x).toBeGreaterThanOrEqual(0);
  expect(pages.y + pages.height).toBeLessThanOrEqual(viewport.height);
  for (const id of ['prevPage', 'pageMenuButton', 'nextPage']) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.id,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    );
    expect(hit).toBe(id);
  }
});

test('the page control follows the language', async ({ page, isMobile }) => {
  if (isMobile) {
    await page.evaluate(() => localStorage.setItem('vatio_board_lang', 'es'));
    await page.reload();
    await expect(page.locator('#boards')).toBeEnabled();
  } else await page.locator('#langToggle').click();
  await boardAction(page, 'addPage');
  await expect(page.locator('#boardMenu #addPage')).toHaveText('Añadir página');
  await expect(page.locator('#pageNav')).toHaveAttribute('aria-label', 'Páginas');
  await expect(page.locator('#prevPage')).toHaveAttribute('aria-label', 'Página anterior');
  await expect(page.locator('#pageLive')).toHaveText('Página 2 de 2');
  await page.locator('#pageMenuButton').click();
  await expect(page.locator('#pageMenu #duplicatePage')).toHaveText('Duplicar página');
});

test('Duplicate copies the page, and the copy changes on its own', async ({ page }) => {
  await drag(page, 120);
  await boardAction(page, 'addPage');
  await page.locator('#prevPage').click();
  await expect(label(page)).toHaveText('1 / 2');
  await pageAction(page, 'duplicatePage');
  await expect(label(page)).toHaveText('2 / 3');
  await expect(page.locator('#status')).toContainText('Page 2 of 3 · duplicated');
  // The copy keeps page 1's history, so Undo works on it.
  await expect(page.locator('#undo')).toBeEnabled();
  await drag(page, 220);
  await expect.poll(async () => (await board(page)).commands.length).toBe(2);
  await page.locator('#prevPage').click();
  await expect.poll(async () => (await board(page)).pageIndex).toBe(0);
  const saved = await board(page);
  expect(saved.commands).toHaveLength(1);
  expect(saved.pages[1].commands).toHaveLength(2);
  expect(saved.pages[1].commands[0]).toEqual(saved.commands[0]);
  expect(saved.pages[2].commands).toHaveLength(0);
  expect(new Set(saved.pages.map((p) => p.id)).size).toBe(3);
});

test('Move earlier and Move later reorder pages and survive reload', async ({ page }) => {
  await boardAction(page, 'addPage');
  await boardAction(page, 'addPage');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  await expect(label(page)).toHaveText('1 / 3');
  await expect.poll(async () => (await board(page)).pageIndex).toBe(0);
  const [a, b, c] = await pageIds(page);
  await page.locator('#pageMenuButton').click();
  await expect(page.locator('#movePageEarlier')).toBeDisabled();
  await page.locator('#movePageLater').click();
  await expect(label(page)).toHaveText('2 / 3');
  await expect(page.locator('#status')).toContainText('Moved to page 2');
  await expect.poll(() => pageIds(page)).toEqual([b, a, c]);
  await pageAction(page, 'movePageLater');
  await expect(label(page)).toHaveText('3 / 3');
  await page.locator('#pageMenuButton').click();
  await expect(page.locator('#movePageLater')).toBeDisabled();
  await page.locator('#movePageEarlier').click();
  await expect.poll(() => pageIds(page)).toEqual([b, a, c]);
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await expect(label(page)).toHaveText('2 / 3');
  expect(await pageIds(page)).toEqual([b, a, c]);
});

test('an empty page is deleted at once, and the control hides with one page left', async ({
  page,
}) => {
  await drag(page, 120);
  await boardAction(page, 'addPage');
  await pageAction(page, 'deletePage');
  await expect(page.locator('.board-library-panel')).toHaveCount(0);
  await expect(page.locator('#pageNav')).toBeHidden();
  await expect(page.locator('#status')).toContainText('Page deleted');
  await expect.poll(async () => (await board(page)).pages.length).toBe(1);
  expect((await board(page)).commands).toHaveLength(1);
});

test('deleting a page with drawing asks first', async ({ page }) => {
  await boardAction(page, 'addPage');
  await drag(page, 200);
  await boardAction(page, 'addPage');
  await drag(page, 120);
  await page.locator('#prevPage').click();
  await expect(label(page)).toHaveText('2 / 3');
  await pageAction(page, 'deletePage');
  const dialog = page.locator('.board-library-panel');
  await expect(dialog).toContainText('Delete page 2? Its drawing will be lost.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(label(page)).toHaveText('2 / 3');

  await pageAction(page, 'deletePage');
  await dialog.getByRole('button', { name: 'Delete page' }).click();
  await expect(dialog).toHaveCount(0);
  // The next page opens with its own drawing.
  await expect(label(page)).toHaveText('2 / 2');
  await expect.poll(async () => (await board(page)).pages.length).toBe(2);
  const saved = await board(page);
  expect(saved.commands).toHaveLength(1);
  expect(saved.commands[0].points[0].y).toBeCloseTo(120, 0);
});

test('the Page menu works from the keyboard and stays on screen', async ({ page }) => {
  await boardAction(page, 'addPage');
  await page.locator('#pageMenuButton').focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('#pageMenu');
  await expect(menu).toBeVisible();
  await expect(page.locator('#addPageAfter')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#duplicatePage')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#deletePage')).toBeFocused();
  const box = await menu.boundingBox(),
    control = await page.locator('#pageNav').boundingBox(),
    viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(control.y);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('#pageMenuButton')).toBeFocused();
  await expect(label(page)).toHaveText('2 / 2');
});
