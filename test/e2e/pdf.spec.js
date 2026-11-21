import { test, expect } from '@playwright/test';
import { boardAction } from '../helpers/board-menu.js';
import { vectorPdf } from '../helpers/pdf-fixture.js';

const pdfFile = (pages, name = 'worksheet.pdf') => ({
  name,
  mimeType: 'application/pdf',
  buffer: vectorPdf(pages),
});

async function board(page) {
  return page.evaluate(async () => {
    const board = await (await import('/test/helpers/board-browser.js')).activeBoard();
    return {
      id: board.id,
      commands: board.commands,
      pages: board.pages,
      pageIndex: board.pageIndex,
    };
  });
}
async function boardAssets(page) {
  return page.evaluate(async () => {
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const id = (await activeBoard()).id;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('zoni-board-library');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db
          .transaction('assets')
          .objectStore('assets')
          .index('byBoard')
          .getAllKeys(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}
/** The colour at a point of a stored image, as fractions of its width and height. */
async function assetPixel(page, assetId, fx, fy) {
  return page.evaluate(
    async ({ assetId, fx, fy }) => {
      const { getAssetRecord } = await import('/src/board/storage.ts');
      const record = await getAssetRecord(assetId);
      const bitmap = await createImageBitmap(
        new Blob([record.blob.bytes], { type: record.blob.type })
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return Array.from(
        ctx.getImageData(Math.floor(bitmap.width * fx), Math.floor(bitmap.height * fy), 1, 1).data
      );
    },
    { assetId, fx, fy }
  );
}
async function insertPdf(page, file) {
  const chooser = page.waitForEvent('filechooser');
  await boardAction(page, 'insertPdf');
  await (await chooser).setFiles(file);
}
async function savePdf(page) {
  const pending = page.waitForEvent('download');
  await boardAction(page, 'savePdf');
  const file = await pending,
    parts = [];
  for await (const part of await file.createReadStream()) parts.push(part);
  return { name: file.suggestedFilename(), buffer: Buffer.concat(parts) };
}
async function drag(page, y) {
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + 60, rect.y + y);
  await page.mouse.down();
  await page.mouse.move(rect.x + 220, rect.y + y, { steps: 6 });
  await page.mouse.up();
}
const isRed = ([r, g, b]) => r > 200 && g < 60 && b < 60;
const isWhite = ([r, g, b]) => r > 240 && g > 240 && b > 240;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boards')).toBeEnabled();
});

test('Insert PDF adds one page per PDF page, after the open page', async ({ page }) => {
  await drag(page, 120);
  await insertPdf(page, pdfFile(2));
  await expect(page.locator('#status')).toContainText('Inserted 2 pages from the PDF');
  await expect(page.locator('#pageMenuButton')).toHaveText('2 / 3');
  await expect.poll(async () => (await board(page)).pageIndex).toBe(1);
  const saved = await board(page);
  expect(saved.pages[0].commands).toHaveLength(1);
  for (const commands of [saved.commands, saved.pages[2].commands]) {
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'content-set',
      object: {
        kind: 'image',
        position: { x: 0, y: 0 },
        title: expect.stringMatching(/^worksheet\.pdf · \d$/),
      },
    });
  }
  const image = saved.commands[0].object;
  // A4 is 1:√2, rendered at 2048 px tall and placed at half size.
  expect(image.height).toBe(1024);
  expect(Math.abs(image.width - 724)).toBeLessThanOrEqual(1);
  expect(isRed(await assetPixel(page, image.assetId, 0.5, 0.25))).toBe(true);
  expect(isWhite(await assetPixel(page, image.assetId, 0.5, 0.9))).toBe(true);
  expect(await boardAssets(page)).toHaveLength(2);
  // The new page can be written on, and Undo only removes the writing.
  await drag(page, 300);
  await page.locator('#undo').click();
  await expect.poll(async () => (await board(page)).commands).toHaveLength(1);
});

test('Save PDF exports every page, and the file can be inserted again', async ({ page }) => {
  await drag(page, 120);
  await boardAction(page, 'addPage');
  await drag(page, 200);
  const file = await savePdf(page);
  expect(file.name).toMatch(/^Board[ _]1\.pdf$/);
  const text = file.buffer.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
  await expect(page.locator('#status')).toContainText('Downloaded PDF');
  await expect(page.locator('#pageMenuButton')).toHaveText('2 / 2');

  await insertPdf(page, { name: file.name, mimeType: 'application/pdf', buffer: file.buffer });
  await expect(page.locator('#status')).toContainText('Inserted 2 pages from the PDF');
  await expect(page.locator('#pageMenuButton')).toHaveText('3 / 4');
});

test('a PDF dropped on the board becomes pages', async ({ page }) => {
  await page.locator('#pad').evaluate(
    (canvas, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], 'dropped.pdf', { type: 'application/pdf' })
      );
      canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    },
    Array.from(vectorPdf(1))
  );
  await expect(page.locator('#status')).toContainText('Inserted 1 page from the PDF');
  await expect(page.locator('#pageMenuButton')).toHaveText('2 / 2');
});

test('a damaged PDF adds nothing and says why', async ({ page }) => {
  await insertPdf(page, {
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('These are notes, not a PDF.'),
  });
  await expect(page.locator('#status')).toContainText('Could not read this PDF');
  await expect(page.locator('#pageNav')).toBeHidden();
  await expect(page.locator('.board-library-panel')).toHaveCount(0);
  expect(await boardAssets(page)).toEqual([]);
});

test('Cancel stops the import and leaves no pages or images behind', async ({ page }) => {
  await insertPdf(page, pdfFile(60));
  const panel = page.locator('.board-library-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('#pageNav')).toBeHidden();
  expect(await boardAssets(page)).toEqual([]);
});

test('only the pages that fit are inserted into a nearly full board', async ({ page }) => {
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('pagehide'));
    const { seedBoard } = await import('/test/helpers/board-browser.js');
    const empty = (id) => ({ id, commands: [], redoCommands: [], viewport: null });
    await seedBoard({
      commands: [],
      pages: Array.from({ length: 199 }, (_, i) => empty(i ? `page-${i + 1}` : 'page-1')),
      pageIndex: 0,
    });
  });
  await page.reload();
  await expect(page.locator('#boards')).toBeEnabled();
  await insertPdf(page, pdfFile(3));
  await expect(page.locator('#status')).toContainText(
    'Inserted 1 of 3 PDF pages · a board holds up to 200 pages'
  );
  await expect(page.locator('#pageMenuButton')).toHaveText('2 / 200');
});
