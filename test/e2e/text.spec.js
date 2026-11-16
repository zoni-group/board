import { test, expect } from '@playwright/test';

async function editor(page) {
  return page.locator('notectl-editor').getByRole('textbox');
}
async function startText(page, text = 'Hello world') {
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('#pad').click({ position: { x: 100, y: 150 } });
  const input = await editor(page);
  await expect(input).toBeVisible();
  await input.pressSequentially(text);
  return input;
}
async function objects(page) {
  return page.evaluate(async () => {
    const { loadBoardDrawing } = await import('/src/board/storage.ts');
    const { resolveTextObjects } = await import('/src/board/text-scene.ts');
    return resolveTextObjects((await loadBoardDrawing()).commands);
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeEnabled();
});

test('formats selected words, commits one board edit, and exports both canvas layers', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const input = await startText(page);
  await input.press('Home');
  await input.press('ControlOrMeta+ArrowRight');
  await input.press('ControlOrMeta+Shift+ArrowRight');
  await page.locator('notectl-editor').getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  const saved = (await objects(page))[0];
  expect(saved.paragraphs[0].runs.some((run) => run.bold)).toBe(true);
  expect(saved.paragraphs[0].runs.some((run) => !run.bold)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save PNG', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('drawing.png');
  expect(
    await page.locator('#textLayer').evaluate((canvas) =>
      canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, index) => index % 4 === 3 && value > 0)
    )
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('recovers unfinished text, edits it, moves it, and erases the whole block', async ({
  page,
}) => {
  await startText(page, 'Draft');
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('vatio_board_text_draft_v1'))
          ?.object.paragraphs[0].runs.map((run) => run.text)
          .join('')
      )
    )
    .toBe('Draft');
  await page.reload();
  await expect(await editor(page)).toBeVisible();
  await expect(await editor(page)).toContainText('Draft');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const input = await editor(page);
  await input.press('ControlOrMeta+End');
  await input.pressSequentially(' edited');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => (await objects(page))[0]?.paragraphs[0].runs.map((run) => run.text).join(''))
    .toBe('Draft edited');
  const selection = page.locator('#textSelection');
  await selection.focus();
  await selection.press('Shift+ArrowRight');
  await expect.poll(async () => (await objects(page))[0]?.position.x).toBe(110);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.locator('#pad').click({ position: { x: 115, y: 160 } });
  await expect.poll(async () => (await objects(page)).length).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
});

test('keeps editing undo separate and cancels edits without changing the board', async ({
  page,
}) => {
  await startText(page, 'Original');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const input = await editor(page);
  await input.press('ControlOrMeta+End');
  await input.pressSequentially(' change');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await objects(page))[0].paragraphs[0].runs.map((run) => run.text).join(''))
    .toBe('Original');
  await input.press('Escape');
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('vatio_board_text_draft_v1')))
    .toBe(null);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(0);
});

test('supports multiline plain-text paste, Unicode, and preserves coordinates on resize', async ({
  page,
}) => {
  const external = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5178')) external.push(request.url());
  });
  const input = await startText(page, '');
  await input.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'Hola café 😀\n\nSecond line');
    data.setData('text/html', '<img src="https://example.com/remote.png"><b>ignored</b>');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clipboardData: data,
      })
    );
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page))[0]?.paragraphs.length).toBe(3);
  const before = (await objects(page))[0];
  expect(before.paragraphs[0].runs.map((run) => run.text).join('')).toBe('Hola café 😀');
  expect(before.paragraphs[1].runs).toEqual([]);
  await page.setViewportSize({ width: 700, height: 600 });
  await page.reload();
  await expect.poll(async () => (await objects(page))[0]).toEqual(before);
  expect(external).toEqual([]);
});

test('moves with the handle, cancels pointer drags, and deletes selected text', async ({
  page,
}) => {
  await startText(page, 'Move me');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  const handle = page.getByRole('button', { name: 'Move', exact: true });
  const rect = await handle.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 50, rect.y + rect.height / 2 + 20);
  await page.mouse.up();
  await expect.poll(async () => (await objects(page))[0]?.position).toEqual({ x: 150, y: 170 });
  await handle.dispatchEvent('pointerdown', {
    pointerId: 77,
    clientX: 150,
    clientY: 170,
    button: 0,
  });
  await handle.dispatchEvent('pointermove', { pointerId: 77, clientX: 180, clientY: 200 });
  await handle.dispatchEvent('pointercancel', { pointerId: 77 });
  expect((await objects(page))[0]?.position).toEqual({ x: 150, y: 170 });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await objects(page))[0]?.position).toEqual({ x: 150, y: 170 });
});

test('applies mixed font sizes, italic, color, and paragraph alignment with matching editor line heights', async ({
  page,
}) => {
  let input = await startText(page, 'Small');
  const root = page.locator('notectl-editor');
  await input.press('ControlOrMeta+a');
  await root.getByRole('combobox', { name: 'Font Size', exact: true }).click();
  await root.getByRole('option', { name: '16', exact: true }).click();
  await input.press('End');
  await input.press('Enter');
  await input.pressSequentially('Big');
  await input.press('Home');
  await input.press('Shift+End');
  await root.getByRole('combobox', { name: 'Font Size', exact: true }).click();
  await root.getByRole('option', { name: '64', exact: true }).click();
  await root.getByRole('button', { name: 'Italic', exact: true }).click();
  await root.getByRole('button', { name: 'Text Color', exact: true }).click();
  await root.getByRole('gridcell', { name: 'Text color Red', exact: true }).click();
  await root.getByRole('button', { name: 'Alignment', exact: true }).click();
  await root.getByRole('menuitem', { name: 'Align Center', exact: true }).click();
  const smallHeight = await input
    .locator('p')
    .first()
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(smallHeight).toBeLessThan(25);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page))[0]?.paragraphs.length).toBe(2);
  const object = (await objects(page))[0];
  expect(object.paragraphs[0].runs[0].fontSize).toBe(16);
  expect(object.paragraphs[1].runs[0]).toMatchObject({ text: 'Big', fontSize: 64, italic: true });
  expect(object.paragraphs[1].runs[0].inkRaw).not.toBe('#111827');
  expect(object.paragraphs[1].align).toBe('center');
});

test('closes formatting popups without cancelling text and ignores finish during composition', async ({
  page,
}) => {
  const input = await startText(page, 'Keep editing');
  const root = page.locator('notectl-editor');
  for (const control of [
    root.getByRole('combobox', { name: 'Font Size', exact: true }),
    root.getByRole('button', { name: 'Alignment', exact: true }),
    root.getByRole('button', { name: 'Text Color', exact: true }),
  ]) {
    await control.click();
    await page.keyboard.press('Escape');
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await expect(input).toBeVisible();
  }
  await input.dispatchEvent('compositionstart', { data: '' });
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    ctrlKey: true,
    isComposing: true,
    bubbles: true,
    composed: true,
  });
  await expect(input).toBeVisible();
  expect(await objects(page)).toEqual([]);
  await input.dispatchEvent('compositionend', { data: '' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(root).toHaveCount(0);
});

test('creates and selects text with touch taps', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch profile only');
  await page.getByRole('button', { name: 'Text', exact: true }).tap();
  const board = await page.locator('#pad').boundingBox();
  await page.touchscreen.tap(board.x + 40, board.y + 100);
  const input = await editor(page);
  await input.pressSequentially('Touch');
  await page.getByRole('button', { name: 'Done', exact: true }).tap();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  await page.touchscreen.tap(board.x + 50, board.y + 110);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('finishes pending text for export, and clear can restore text with undo', async ({ page }) => {
  await startText(page, 'Export pending');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save PNG', exact: true }).click();
  await downloaded;
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(0);
  expect(
    await page.locator('#textLayer').evaluate((canvas) =>
      canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.every((value) => value === 0)
    )
  ).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await objects(page))[0]?.paragraphs[0].runs[0].text)
    .toBe('Export pending');
});

test('retains recovery data when a board save fails, and allows retrying an unchanged edit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'vatio_board_drawing_v2' && !window.allowBoardSave)
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.reload();
  await startText(page, 'Keep recovery');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Could not save text');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('vatio_board_text_draft_v1'))?.object.paragraphs[0]
            .runs[0].text
      )
    )
    .toBe('Keep recovery');
  await page.evaluate(() => {
    window.allowBoardSave = true;
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(await editor(page)).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('vatio_board_text_draft_v1')))
    .toBe(null);
  await page.reload();
  await expect
    .poll(async () => (await objects(page))[0]?.paragraphs[0].runs[0].text)
    .toBe('Keep recovery');
  await expect(page.locator('notectl-editor')).toHaveCount(0);
});

test('does not mount a stale editor after switching away while its code loads', async ({
  page,
}) => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/src/board/text-editor.ts*', async (route) => {
    await waiting;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('#pad').click({ position: { x: 100, y: 150 } });
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  release();
  await page.evaluate(() => import('/src/board/text-editor.ts').then(() => {}));
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(await objects(page)).toEqual([]);
});

test('keeps inline layout across theme changes and supports the Spanish editor', async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const input = await startText(page, 'Theme');
  const root = page.locator('notectl-editor');
  await input.press('ControlOrMeta+a');
  await root.getByRole('combobox', { name: 'Font Size', exact: true }).click();
  await root.getByRole('option', { name: '16', exact: true }).click();
  await expect
    .poll(() => input.locator('p').evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThan(25);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect
    .poll(() => input.locator('p').evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThan(25);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  expect((await objects(page))[0].paragraphs[0].runs[0].inkRaw).not.toBe('#111827');
  if (isMobile) {
    await page.evaluate(() => localStorage.setItem('vatio_board_lang', 'es'));
    await page.reload();
    await page.getByRole('button', { name: 'Texto', exact: true }).click();
    await page.locator('#pad').click({ position: { x: 110, y: 155 } });
  } else await page.locator('#langToggle').click();
  await expect(page.getByRole('button', { name: 'Texto', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(await editor(page)).toBeVisible();
  await expect(
    page.locator('notectl-editor').getByRole('button', { name: 'Negrita', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
});

test('keeps editing and selection controls reachable for oversized blocks in a small viewport', async ({
  page,
}) => {
  const input = await startText(page, '');
  await input.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', Array(20).fill('A long text block').join('\n'));
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clipboardData: data,
      })
    );
  });
  await page.setViewportSize({ width: 390, height: 360 });
  const done = page.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeInViewport();
  await done.click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  const selected = page.locator('#textSelection');
  await selected.focus();
  await selected.press('Home');
  for (let index = 0; index < 15; index++) await selected.press('Shift+ArrowUp');
  await expect(page.getByRole('button', { name: 'Move', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeInViewport();
});
