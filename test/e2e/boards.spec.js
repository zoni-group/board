import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { boardAction } from '../helpers/board-menu.js';
import { chooseObject } from '../helpers/object-picker.js';
async function library(page) {
  return page.evaluate(async () => (await import('/src/board/storage.ts')).getBoardLibrary());
}
async function current(page) {
  return page.evaluate(async () => (await import('/test/helpers/board-browser.js')).activeBoard());
}
async function create(page) {
  const before = (await current(page)).id;
  await boardAction(page, 'newBoard');
  await expect.poll(async () => (await current(page)).id).not.toBe(before);
  await expect(page.locator('#boards')).toBeEnabled();
}
async function open(page, id) {
  await boardAction(page, 'openBoards');
  await page.locator(`[data-board-id="${id}"] .board-list-open`).click();
  await expect.poll(async () => (await current(page)).id).toBe(id);
  await expect(page.locator('.board-library-panel')).toHaveCount(0);
}
async function draw(page, x = 80) {
  await page.locator('#pen').click();
  await page.locator('#pad').click({ position: { x, y: 100 } });
}
async function download(page, action = 'exportBoard') {
  const pending = page.waitForEvent('download');
  await boardAction(page, action);
  const file = await pending,
    parts = [];
  for await (const part of await file.createReadStream()) parts.push(part);
  return { name: file.suggestedFilename(), buffer: Buffer.concat(parts) };
}
async function upload(page, file) {
  const chooser = page.waitForEvent('filechooser');
  await boardAction(page, 'importBoards');
  await (
    await chooser
  ).setFiles({ name: file.name, mimeType: 'application/zip', buffer: file.buffer });
}
function manifest(file) {
  return JSON.parse(strFromU8(unzipSync(file.buffer)['manifest.json']));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('keeps seven primary tools and independent histories, cameras, names and startup selection', async ({
  page,
}) => {
  await expect(page.locator('.board-action-strip > button')).toHaveCount(7);
  const first = (await current(page)).id;
  await draw(page);
  await page.locator('#zoomIn').click();
  await expect.poll(async () => (await current(page)).commands.length).toBe(1);
  await expect.poll(async () => (await current(page)).viewport.zoom).toBe(1.25);
  const view = (await current(page)).viewport;
  await create(page);
  const second = (await current(page)).id;
  await expect(page.locator('#boardName')).toHaveText('Board 2');
  expect((await current(page)).commands).toEqual([]);
  await expect(page.locator('#zoomReset')).toHaveText('100%');
  await draw(page, 120);
  await draw(page, 160);
  await expect.poll(async () => (await current(page)).commands.length).toBe(2);
  await page.locator('#undo').click();
  await expect.poll(async () => (await current(page)).redoCommands.length).toBe(1);
  await open(page, first);
  await expect(page.locator('#zoomReset')).toHaveText(`${Math.round(view.zoom * 100)}%`);
  expect((await current(page)).redoCommands).toEqual([]);
  await boardAction(page, 'openBoards');
  const row = page.locator(`[data-board-id="${first}"]`);
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  await row.getByRole('textbox', { name: 'Board name' }).fill('Lesson A');
  await row.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('#boardName')).toHaveText('Lesson A');
  await page.keyboard.press('Escape');
  await open(page, second);
  expect((await current(page)).redoCommands).toHaveLength(1);
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await expect(page.locator('#boardName')).toHaveText('Board 2');
});

test('confirms deletion, removes owned media and replaces the last board with a fresh one', async ({
  page,
}) => {
  const first = (await current(page)).id;
  const file = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    return canvas.toDataURL().split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await chooseObject(page, 'image');
  await (
    await chooser
  ).setFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from(file, 'base64') });
  await expect.poll(async () => (await current(page)).commands.length).toBe(1);
  const assetId = (await current(page)).commands[0].object.assetId;
  await create(page);
  const second = (await current(page)).id;
  await boardAction(page, 'openBoards');
  await page
    .locator(`[data-board-id="${first}"]`)
    .getByRole('button', { name: 'Delete board', exact: true })
    .click();
  await expect(page.locator('.board-library-panel')).toContainText('Board 1');
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  expect((await library(page)).boards).toHaveLength(2);
  await boardAction(page, 'openBoards');
  await page
    .locator(`[data-board-id="${first}"]`)
    .getByRole('button', { name: 'Delete board', exact: true })
    .click();
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Delete board', exact: true })
    .click();
  await expect.poll(async () => (await library(page)).boards.length).toBe(1);
  expect(
    await page.evaluate(
      async (id) => (await import('/src/board/storage.ts')).getAssetRecord(id),
      assetId
    )
  ).toBeUndefined();
  await expect(page.locator('.board-list')).toBeVisible();
  await page
    .locator(`[data-board-id="${second}"]`)
    .getByRole('button', { name: 'Delete board', exact: true })
    .click();
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Delete board', exact: true })
    .click();
  await expect.poll(async () => (await library(page)).activeBoardId).not.toBe(second);
  await expect(page.locator('#boards')).toBeEnabled();
  expect((await current(page)).commands).toEqual([]);
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  expect((await library(page)).boards).toHaveLength(1);
});

test('exports all boards with history and local video, imports copies into another browser and preserves originals', async ({
  page,
  browser,
}) => {
  await draw(page);
  await chooseObject(page, 'video');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose video file', exact: true }).click();
  await (await chooser).setFiles('test/fixtures/sample.mp4');
  const supported = await page.evaluate(() =>
    Boolean(document.createElement('video').canPlayType('video/mp4'))
  );
  if (supported)
    await expect
      .poll(async () => (await current(page)).commands.length, { timeout: 15000 })
      .toBe(2);
  else await expect(page.locator('#status')).toContainText('could not be opened');
  const a = (await current(page)).id;
  await create(page);
  await draw(page, 160);
  await page.locator('#undo').click();
  await expect.poll(async () => (await current(page)).redoCommands.length).toBe(1);
  const file = await download(page, 'exportAllBoards'),
    source = manifest(file);
  expect(source.boards).toHaveLength(2);
  expect(source.boards.find((b) => b.id === a).commands[0].type).toBe('stroke');
  if (supported) expect(source.assets.some((a) => a.kind === 'video' && a.poster)).toBe(true);
  const target = await browser.newContext(),
    other = await target.newPage();
  await other.goto(page.url());
  await expect(other.locator('#boards')).toBeEnabled();
  await upload(other, file);
  await expect(other.locator('#status')).toContainText('imported');
  expect((await library(other)).boards).toHaveLength(3);
  const imported = await current(other);
  expect(imported.id).not.toBe(source.activeBoardId);
  expect(imported.redoCommands).toHaveLength(1);
  await upload(other, file);
  await expect.poll(async () => (await library(other)).boards.length).toBe(5);
  expect((await library(page)).boards).toHaveLength(2);
  await target.close();
});

test('blocks switching on failed saves while allowing export of in-memory changes', async ({
  page,
}) => {
  const first = (await current(page)).id;
  await create(page);
  const unused = (await current(page)).id;
  await open(page, first);
  await draw(page);
  await expect.poll(async () => (await current(page)).commands.length).toBe(1);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'boards') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await draw(page, 160);
  await boardAction(page, 'newBoard');
  await expect(page.locator('#status')).toContainText('Could not save');
  expect((await library(page)).boards).toHaveLength(2);
  expect((await current(page)).commands).toHaveLength(1);
  const file = await download(page);
  expect(manifest(file).boards[0].commands).toHaveLength(2);
  await boardAction(page, 'openBoards');
  await page
    .locator(`[data-board-id="${unused}"]`)
    .getByRole('button', { name: 'Delete board', exact: true })
    .click();
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Delete board', exact: true })
    .click();
  await expect.poll(async () => (await library(page)).boards.length).toBe(1);
  expect((await current(page)).id).toBe(first);
});

test('rejects corrupt imports without changing the library', async ({ page }) => {
  await draw(page);
  await expect.poll(async () => (await current(page)).commands.length).toBe(1);
  const before = (await current(page)).id;
  await upload(page, { name: 'broken.zoniboard', buffer: Buffer.from('not an archive') });
  await expect(page.locator('#status')).toContainText('incomplete or damaged');
  expect((await library(page)).boards).toHaveLength(1);
  expect((await current(page)).id).toBe(before);
  expect((await current(page)).commands).toHaveLength(1);
});

test('rejects stale-tab saves and lets that tab export its unsaved content', async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('#boards')).toBeEnabled();
  await draw(page);
  await expect.poll(async () => (await current(page)).commands.length).toBe(1);
  await draw(other, 230);
  await expect(other.locator('#status')).toContainText('changed in another tab');
  const file = await download(other);
  expect(manifest(file).boards[0].commands[0].points[0].x).toBe(230);
  expect((await current(page)).commands[0].points[0].x).toBe(80);
  await other.close();
});

test('keeps simultaneous edits on different boards in their originating tabs', async ({
  page,
  context,
}) => {
  const a = (await current(page)).id;
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('#boards')).toBeEnabled();
  await create(other);
  const b = (await current(other)).id;
  await draw(page, 80);
  await draw(other, 160);
  await expect.poll(async () => (await current(page)).commands.length).toBe(1);
  await expect.poll(async () => (await current(other)).commands.length).toBe(1);
  expect((await current(page)).id).toBe(a);
  expect((await current(other)).id).toBe(b);
  expect((await current(page)).commands[0].points[0].x).toBe(80);
  expect((await current(other)).commands[0].points[0].x).toBe(160);
  await other.close();
});

test('finishes edits before switching and recovers only the open board’s text draft', async ({
  page,
}) => {
  const a = (await current(page)).id;
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 50, y: 100 } });
  await page.locator('notectl-editor').getByRole('textbox').pressSequentially('Text A');
  await create(page);
  const b = (await current(page)).id;
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  expect((await current(page)).commands).toEqual([]);
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 50, y: 100 } });
  await page.locator('notectl-editor').getByRole('textbox').pressSequentially('Draft B');
  await expect
    .poll(async () =>
      (await current(page)).draft?.object.paragraphs[0].runs.map((r) => r.text).join('')
    )
    .toBe('Draft B');
  await page.reload();
  await expect(page.locator('notectl-editor').getByRole('textbox')).toContainText('Draft B');
  await open(page, a);
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  expect((await current(page)).commands[0].object.paragraphs[0].runs[0].text).toBe('Text A');
  await open(page, b);
  expect((await current(page)).commands[0].object.paragraphs[0].runs[0].text).toBe('Draft B');
});

test('cancels a transfer while code loads and keeps the current board intact', async ({ page }) => {
  let release, requested;
  const paused = new Promise((resolve) => (release = resolve)),
    arrived = new Promise((resolve) => (requested = resolve));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/src/board/board-files.ts*', async (route) => {
    requested();
    await paused;
    await route.continue();
  });
  await boardAction(page, 'exportBoard');
  await arrived;
  await page
    .locator('.board-library-panel')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  const response = page.waitForResponse('**/src/board/board-files.ts*');
  release();
  await response;
  await expect(page.locator('.board-library-panel')).toHaveCount(0);
  await expect(page.locator('#boards')).toBeEnabled();
  expect(downloads).toBe(0);
  expect((await library(page)).boards).toHaveLength(1);
});

test('keeps board menus and navigation usable in a short viewport and translates them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 160 });
  await page.locator('#boards').click();
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector('#boardMenu').getBoundingClientRect(),
      nav = document.querySelector('.board-navigation').getBoundingClientRect();
    return {
      menu: menu.bottom,
      nav: nav.top,
      scroll: document.documentElement.scrollHeight,
      height: innerHeight,
    };
  });
  expect(geometry.menu).toBeLessThanOrEqual(geometry.nav);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.height);
  await expect(page.locator('#zoomReset')).toBeInViewport();
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('vatio_board_lang', 'es'));
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await page.locator('#boards').click();
  await expect(page.locator('#boardMenu')).toContainText('Nueva pizarra');
});
