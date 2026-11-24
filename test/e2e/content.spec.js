import { boardAction } from '../helpers/board-menu.js';
import { test, expect } from '@playwright/test';
import { chooseObject } from '../helpers/object-picker.js';

async function objects(page) {
  return page.evaluate(async () => {
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const { resolveContent } = await import('/src/board/content.ts');
    return resolveContent((await activeBoard()).commands);
  });
}
async function imageFile(page) {
  const base64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 160, 100);
    return c.toDataURL().split(',')[1];
  });
  return { name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}
async function uploadImage(page) {
  const file = await imageFile(page),
    chooser = page.waitForEvent('filechooser');
  await chooseObject(page, 'image');
  await (await chooser).setFiles(file);
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  await expect
    .poll(() =>
      page
        .locator('#pad')
        .evaluate((c) =>
          Array.from(
            c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1)
              .data
          ).slice(0, 3)
        )
    )
    .toEqual([255, 0, 0]);
  return (await objects(page))[0];
}
async function openTable(page) {
  await chooseObject(page, 'table');
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Insert', exact: true })
    .click();
  const root = page.locator('.board-table-editor notectl-editor');
  await expect(root.getByRole('textbox')).toBeVisible();
  return root;
}
async function doneTable(page) {
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(page.locator('.board-content-panel')).toHaveCount(0);
}
async function pngHasRed(page) {
  const downloadPromise = page.waitForEvent('download');
  await boardAction(page, 'save');
  const stream = await (await downloadPromise).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const base64 = Buffer.concat(chunks).toString('base64');
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 0) return true;
    return false;
  }, base64);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#text')).toBeEnabled();
});

test('uses one existing toolbar slot for all four object choices and keeps Shapes separate', async ({
  page,
}) => {
  await expect(page.locator('.board-action-strip > button')).toHaveCount(7);
  await page.locator('#text').click();
  await expect(page.locator('#objectPicker button')).toHaveCount(4);
  await expect(page.locator('#objectPicker')).toContainText('Text');
  await expect(page.locator('#objectPicker')).toContainText('Image');
  await expect(page.locator('#objectPicker')).toContainText('Table');
  await expect(page.locator('#objectPicker')).toContainText('Video');
  await page.locator('#objectPicker button').first().press('Escape');
  await expect(page.locator('#objectPicker')).toBeHidden();
  await page.locator('#shapes').click();
  await expect(page.locator('#shapePicker [data-shape]')).toHaveCount(8);
  await expect(page.locator('#shapePicker .shape-fill-row')).toBeVisible();
  await page.locator('#text').click();
  await expect(page.locator('#shapePicker')).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.locator('#langToggle').click();
  await expect(page.locator('#text')).toHaveAttribute('aria-label', 'Añadir objeto');
  await page.locator('#text').click();
  await expect(page.locator('#objectPicker')).toContainText('Imagen');
});

test('saves image pixels locally, restores them, and exports them without a connection', async ({
  page,
  context,
}) => {
  const image = await uploadImage(page);
  const record = await page.evaluate(async (id) => {
    const { readAsset } = await import('/src/board/assets.ts');
    const a = await readAsset(id);
    return { size: a.blob.size, type: a.blob.type };
  }, image.assetId);
  expect(record.type).toBe('image/png');
  expect(record.size).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  await expect.poll(async () => (await objects(page))[0]?.assetId).toBe(image.assetId);
  await context.setOffline(true);
  expect(await pngHasRed(page)).toBe(true);
});

test('preserves image transparency over other board content', async ({ page }) => {
  await uploadImage(page);
  const data = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(80, 0, 80, 100);
    return c.toDataURL().split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await chooseObject(page, 'image');
  await (
    await chooser
  ).setFiles({
    name: 'transparent.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  await expect.poll(async () => (await objects(page)).length).toBe(2);
  await expect
    .poll(() =>
      page.locator('#pad').evaluate((c) => {
        const ctx = c.getContext('2d');
        return [-40, 40].map((dx) =>
          Array.from(
            ctx.getImageData(
              Math.floor(c.width / 2 + dx * devicePixelRatio),
              Math.floor(c.height / 2),
              1,
              1
            ).data
          ).slice(0, 3)
        );
      })
    )
    .toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
});

test('moves, resizes and deletes images through shared selection, with undo and clear recovery', async ({
  page,
}) => {
  const image = await uploadImage(page);
  const outline = page.locator('#objectSelection');
  await expect(outline).toBeVisible();
  await page.locator('#pad').press('Shift+ArrowRight');
  await expect.poll(async () => (await objects(page))[0]?.position.x).toBe(image.position.x + 10);
  const box = await outline.boundingBox(),
    rect = await page.locator('#pad').boundingBox();
  await page.locator('#pad').dispatchEvent('pointerdown', {
    pointerId: 3,
    pointerType: 'mouse',
    button: 0,
    clientX: box.x + box.width,
    clientY: box.y + box.height,
  });
  await page.locator('#pad').dispatchEvent('pointermove', {
    pointerId: 3,
    pointerType: 'mouse',
    buttons: 1,
    clientX: Math.min(rect.x + rect.width - 10, box.x + box.width + 60),
    clientY: box.y + box.height + 30,
  });
  await page.locator('#pad').dispatchEvent('pointerup', {
    pointerId: 3,
    pointerType: 'mouse',
    button: 0,
    clientX: box.x + box.width + 60,
    clientY: box.y + box.height + 30,
  });
  await expect.poll(async () => (await objects(page))[0]?.width).toBeGreaterThan(image.width);
  const resized = (await objects(page))[0];
  expect(resized.width / resized.height).toBeCloseTo(image.width / image.height);
  await page.locator('#pad').press('Delete');
  await expect.poll(() => objects(page)).toEqual([]);
  await page.locator('#undo').click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  await boardAction(page, 'clear');
  await expect.poll(() => objects(page)).toEqual([]);
  await page.locator('#undo').click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  expect(await pngHasRed(page)).toBe(true);
});

test('erases annotations while preserving the image during and after the gesture', async ({
  page,
}) => {
  await uploadImage(page);
  await page.locator('#pen').click();
  const rect = await page.locator('#pad').boundingBox(),
    x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  const pad = page.locator('#pad');
  for (const [type, dx] of [
    ['pointerdown', -30],
    ['pointermove', 0],
    ['pointermove', 30],
    ['pointerup', 30],
  ])
    await pad.dispatchEvent(type, {
      pointerId: 8,
      pointerType: 'mouse',
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x + dx,
      clientY: y,
    });
  await page.locator('#erase').click();
  await pad.dispatchEvent('pointerdown', {
    pointerId: 9,
    pointerType: 'mouse',
    button: 0,
    clientX: x,
    clientY: y - 10,
  });
  await pad.dispatchEvent('pointermove', {
    pointerId: 9,
    pointerType: 'mouse',
    buttons: 1,
    clientX: x,
    clientY: y + 10,
  });
  const pixel = () =>
    pad.evaluate((c) =>
      Array.from(
        c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1)
          .data
      ).slice(0, 3)
    );
  await expect.poll(pixel).toEqual([255, 0, 0]);
  await pad.dispatchEvent('pointerup', {
    pointerId: 9,
    pointerType: 'mouse',
    button: 0,
    clientX: x,
    clientY: y + 10,
  });
  await expect.poll(pixel).toEqual([255, 0, 0]);
  await expect.poll(async () => (await objects(page)).length).toBe(1);
});

test('handles storage failure and invalid media without inserting broken objects', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'assets') throw new DOMException('Full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  const chooser = page.waitForEvent('filechooser');
  await chooseObject(page, 'image');
  await (await chooser).setFiles(await imageFile(page));
  await expect(page.locator('#status')).toContainText('Could not save this file');
  expect(await objects(page)).toEqual([]);
  const invalid = page.waitForEvent('filechooser');
  await chooseObject(page, 'image');
  await (
    await invalid
  ).setFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await expect(page.locator('#status')).toContainText('could not be opened');
  expect(await objects(page)).toEqual([]);
});

test('drops images in world coordinates, pastes into the board, and leaves editor paste to the editor', async ({
  page,
}) => {
  const file = await imageFile(page);
  const dropped = await page.locator('#pad').evaluate((canvas, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }));
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        clientX: rect.left + 100,
        clientY: rect.top + 80,
        dataTransfer: transfer,
      })
    );
    return { x: 100, y: 80 };
  }, Array.from(file.buffer));
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  const actual = (await objects(page))[0];
  const expected = await page.evaluate(async (point) => {
    const { screenToWorld } = await import('/src/board/viewport.ts');
    return screenToWorld(
      point,
      (await (await import('/test/helpers/board-browser.js')).activeBoard()).viewport,
      document.querySelector('#pad').getBoundingClientRect()
    );
  }, dropped);
  expect(actual.position.x + actual.width / 2).toBeCloseTo(expected.x);
  expect(actual.position.y + actual.height / 2).toBeCloseTo(expected.y);
  async function paste(target) {
    await target.evaluate((element, bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'paste.png', { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, composed: true, clipboardData: data })
      );
    }, Array.from(file.buffer));
  }
  await page.locator('#pad').focus();
  await paste(page.locator('#pad'));
  await expect.poll(async () => (await objects(page)).length).toBe(2);
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 20, y: 20 } });
  const input = page.locator('notectl-editor').getByRole('textbox');
  await expect(input).toBeVisible();
  await paste(input);
  await input.pressSequentially('Keep typing');
  await expect(input).toHaveText('Keep typing');
  expect((await objects(page)).length).toBe(2);
});

test('keeps a missing asset selectable and exports a placeholder after reload', async ({
  page,
}) => {
  const image = await uploadImage(page);
  await page.evaluate(async (id) => {
    const { discardAsset } = await import('/src/board/assets.ts');
    await discardAsset(id);
  }, image.assetId);
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  await expect.poll(async () => (await objects(page))[0]?.assetId).toBe(image.assetId);
  await page.locator('#select').click();
  const rect = await page.locator('#pad').boundingBox();
  await page.locator('#pad').click({ position: { x: rect.width / 2, y: rect.height / 2 } });
  await expect(page.locator('.image-selection-actions')).toBeVisible();
  expect(await pngHasRed(page)).toBe(false);
});

test('cancels an editor that is still loading without adding a stale table', async ({ page }) => {
  let release;
  const paused = new Promise((resolve) => (release = resolve));
  let requested;
  const request = new Promise((resolve) => (requested = resolve));
  await page.route('**/src/board/table-editor.ts*', async (route) => {
    requested();
    await paused;
    await route.continue();
  });
  await chooseObject(page, 'table');
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Insert', exact: true })
    .click();
  await request;
  await expect(
    page.locator('.content-panel-actions').getByRole('button', { name: 'Done', exact: true })
  ).toBeDisabled();
  await page.locator('#pen').click();
  const response = page.waitForResponse('**/src/board/table-editor.ts*');
  release();
  await response;
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  expect(await objects(page)).toEqual([]);
});

test('edits formatted table cells, changes row/column sizes, and saves one board operation', async ({
  page,
}) => {
  const root = await openTable(page),
    input = root.getByRole('textbox');
  await input.pressSequentially('Cell');
  await input.press('Home');
  await input.press('Shift+End');
  await expect
    .poll(() =>
      root.evaluate((e) => ({
        anchor: e.getState().selection.anchor.offset,
        head: e.getState().selection.head.offset,
      }))
    )
    .toEqual({ anchor: 0, head: 4 });
  await root.getByRole('button', { name: 'Bold', exact: true }).click();
  await root.getByRole('button', { name: 'Highlight', exact: true }).click();
  await root.getByRole('gridcell').first().click();
  const column = root.getByRole('separator', { name: 'Resize column 1', exact: true });
  await column.focus();
  await column.press('ArrowRight');
  const row = root.getByRole('separator', { name: 'Resize row 1', exact: true });
  await row.focus();
  await row.press('ArrowDown');
  await doneTable(page);
  await expect
    .poll(async () => (await objects(page))[0]?.rows[0].cells[0][0].runs[0])
    .toMatchObject({ text: 'Cell', fontSize: 24, bold: true, highlightRaw: '#fff176' });
  const table = (await objects(page))[0];
  expect(table.columnWidths[0]).toBeGreaterThan(table.columnWidths[1]);
  expect(table.rows[0].minHeight).toBe(56);
  await page.locator('#undo').click();
  await expect.poll(() => objects(page)).toEqual([]);
  await page.locator('#redo').click();
  await expect.poll(async () => (await objects(page))[0]).toEqual(table);
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  await page.locator('#select').click();
  await page.locator('#pad').click({ position: { x: 30, y: 30 } });
  // Reopen using actual hit testing at a cell center.
  const point = await page.evaluate(async () => {
    const { worldToScreen } = await import('/src/board/viewport.ts');
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const { resolveContent } = await import('/src/board/content.ts');
    const o = resolveContent((await activeBoard()).commands)[0];
    const r = document.querySelector('#pad').getBoundingClientRect();
    return worldToScreen(
      { x: o.position.x + 20, y: o.position.y + 20 },
      (await (await import('/test/helpers/board-browser.js')).activeBoard()).viewport,
      r
    );
  });
  await page.locator('#pad').click({ position: point });
  await page
    .locator('.table-selection-actions')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(page.locator('notectl-editor').getByRole('textbox')).toContainText('Cell');
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
});

test('adds and deletes table rows and columns using the table controls', async ({ page }) => {
  const root = await openTable(page);
  await root.getByRole('textbox').locator('td').first().click();
  await root
    .getByRole('button', { name: 'Table actions (Right-click or Shift+F10)', exact: true })
    .click();
  await root.getByRole('menuitem', { name: 'Insert Row Below', exact: true }).click();
  await expect(root.locator('tbody > tr')).toHaveCount(4);
  await root
    .getByRole('button', { name: 'Table actions (Right-click or Shift+F10)', exact: true })
    .click();
  await root.getByRole('menuitem', { name: 'Insert Column Right', exact: true }).click();
  await expect(root.locator('tbody > tr').first().locator('td')).toHaveCount(4);
  await root
    .getByRole('button', { name: 'Table actions (Right-click or Shift+F10)', exact: true })
    .click();
  await root.getByRole('menuitem', { name: 'Delete Row', exact: true }).click();
  await expect(root.locator('tbody > tr')).toHaveCount(3);
  await root
    .getByRole('button', { name: 'Table actions (Right-click or Shift+F10)', exact: true })
    .click();
  await root.getByRole('menuitem', { name: 'Delete Column', exact: true }).click();
  await expect(root.locator('tbody > tr').first().locator('td')).toHaveCount(3);
  await doneTable(page);
  await expect
    .poll(async () => ({
      rows: (await objects(page))[0]?.rows.length,
      columns: (await objects(page))[0]?.columnWidths.length,
    }))
    .toEqual({ rows: 3, columns: 3 });
});

for (const [url, provider] of [
  ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
  ['https://vimeo.com/123456', 'vimeo'],
]) {
  test(`loads ${provider} only when Play is requested and closes the focused player`, async ({
    page,
  }) => {
    const requests = [];
    await page.route(/https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\/.*/, (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: 'text/html', body: '<p>Provider player</p>' });
    });
    await chooseObject(page, 'video');
    await page.getByRole('textbox', { name: 'YouTube or Vimeo URL' }).fill(url);
    await page
      .locator('.content-panel-actions')
      .getByRole('button', { name: 'Insert', exact: true })
      .click();
    await expect.poll(async () => (await objects(page))[0]?.source.kind).toBe(provider);
    expect(requests).toEqual([]);
    await page
      .locator('.video-selection-actions')
      .getByRole('button', { name: 'Play video', exact: true })
      .click();
    await expect(page.locator('.board-video-player iframe')).toBeVisible();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await page
      .locator('.board-video-player')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('#pad')).toBeFocused();
  });
}

test('plays supported local video offline and reports runtimes without video codecs', async ({
  page,
  context,
}) => {
  await chooseObject(page, 'video');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose video file', exact: true }).click();
  await (await chooser).setFiles('test/fixtures/sample.mp4');
  const supported = await page.evaluate(async () =>
    Boolean(document.createElement('video').canPlayType('video/mp4'))
  );
  if (!supported) {
    await expect(page.locator('#status')).toContainText('could not be opened');
    expect(await objects(page)).toEqual([]);
    return;
  }
  await expect
    .poll(async () => (await objects(page))[0]?.source.kind, { timeout: 15000 })
    .toBe('local');
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  await context.setOffline(true);
  const point = await page.locator('#pad').boundingBox();
  await page.locator('#select').click();
  await page.locator('#pad').click({ position: { x: point.width / 2, y: point.height / 2 } });
  await page
    .locator('.video-selection-actions')
    .getByRole('button', { name: 'Play video', exact: true })
    .click();
  const video = page.locator('.board-video-player video');
  await expect(video).toHaveAttribute('controls', '');
  await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(1);
  expect(await video.getAttribute('src')).toMatch(/^blob:/);
  await page
    .locator('.board-video-player')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(video).toHaveCount(0);
});

test('keeps navigation visible and page scrolling disabled in short viewports', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 200 });
  const root = await openTable(page);
  await expect(root).toBeAttached();
  const geometry = await page.evaluate(async () => {
    const panel = document.querySelector('.board-content-panel').getBoundingClientRect(),
      nav = document.querySelector('.board-navigation').getBoundingClientRect();
    return {
      panelBottom: panel.bottom,
      navTop: nav.top,
      pageHeight: document.documentElement.scrollHeight,
      screen: innerHeight,
    };
  });
  expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.navTop);
  expect(geometry.pageHeight).toBeLessThanOrEqual(geometry.screen);
  await expect(page.locator('#zoomReset')).toBeInViewport();
  await page
    .locator('.content-panel-actions')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
});
