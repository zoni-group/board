import { boardAction } from '../helpers/board-menu.js';
import { chooseObject } from '../helpers/object-picker.js';
import { test, expect } from '@playwright/test';

async function editor(page) {
  return page.locator('notectl-editor').getByRole('textbox');
}
async function startText(page, text = 'Hello world') {
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 100, y: 150 } });
  const input = await editor(page);
  await expect(input).toBeVisible();
  await input.pressSequentially(text);
  return input;
}
async function objects(page) {
  return page.evaluate(async () => {
    const { activeBoard } = await import('/test/helpers/board-browser.js');
    const { resolveTextObjects } = await import('/src/board/text-scene.ts');
    return resolveTextObjects((await activeBoard()).commands);
  });
}
async function expectEditorSelection(input, anchor, head = anchor) {
  // Native arrow keys update the editor model through asynchronous selectionchange events.
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const selection = element.getRootNode().host.getState().selection;
        return { anchor: selection.anchor?.offset, head: selection.head?.offset };
      })
    )
    .toEqual({ anchor, head });
}
async function highlight(page, colorIndex) {
  const root = page.locator('notectl-editor');
  await root.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(root.getByRole('gridcell')).toHaveCount(5);
  await root.getByRole('gridcell').nth(colorIndex).click();
}

async function removeHighlight(page) {
  const root = page.locator('notectl-editor');
  await root.getByRole('button', { name: 'Highlight', exact: true }).click();
  await root.getByRole('button', { name: 'None', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#text')).toBeEnabled();
});

for (const [language, placeholder] of [
  ['en', 'Type here…'],
  ['es', 'Escribe aquí…'],
]) {
  test(`shows the complete empty-text placeholder in ${language}, including after deleting text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.evaluate(
      async (language) => localStorage.setItem('vatio_board_lang', language),
      language
    );
    await page.reload();
    await expect(page.locator('#text')).toBeEnabled();
    await chooseObject(page, 'text');
    await page.locator('#pad').click({ position: { x: 80, y: 150 } });
    const input = await editor(page);
    await expect(input).toBeVisible();
    async function expectPlaceholderFits() {
      await expect(input).toHaveAttribute('data-placeholder', placeholder);
      await expect
        .poll(() =>
          input.evaluate((element) => {
            const hint = getComputedStyle(element, '::before');
            const width = Number.parseFloat(hint.width);
            const body = element.getRootNode().host.parentElement;
            return (
              element.classList.contains('notectl-content--empty') &&
              Number.isFinite(width) &&
              width > 0 &&
              element.clientWidth >= width + Number.parseFloat(hint.left) &&
              body.scrollWidth <= body.clientWidth
            );
          })
        )
        .toBe(true);
    }
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      await expectPlaceholderFits();
    }
    await input.pressSequentially('T');
    await expect(input).not.toHaveClass(/notectl-content--empty/);
    await expect(input).toHaveText('T');
    await input.press('Backspace');
    await expectPlaceholderFits();
    await input.pressSequentially('Hello');
    await page.locator('.text-editor-actions button').first().click();
    await expect
      .poll(async () => (await objects(page))[0]?.paragraphs[0].runs[0].text)
      .toBe('Hello');
  });
}

test('highlights selected words, changes and removes colors, and highlights subsequent typing', async ({
  page,
}) => {
  let input = await startText(page);
  const root = page.locator('notectl-editor');
  await input.press('Home');
  for (let index = 0; index < 6; index++) await input.press('ArrowRight');
  await expectEditorSelection(input, 6);
  await input.press('Shift+End');
  await expectEditorSelection(input, 6, 11);
  await root.getByRole('button', { name: 'Bold', exact: true }).click();
  await root.getByRole('button', { name: 'Italic', exact: true }).click();
  await highlight(page, 0);
  const background = input.locator('[style*="background-color"]');
  await expect(background).toHaveJSProperty('textContent', 'world');
  await expect(background).toHaveCSS('background-color', 'rgb(255, 241, 118)');
  await highlight(page, 2);
  await expect(background).toHaveCSS('background-color', 'rgb(100, 181, 246)');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(background).toHaveCSS('background-color', 'rgb(255, 241, 118)');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(background).toHaveCSS('background-color', 'rgb(100, 181, 246)');
  await root.getByRole('button', { name: 'Highlight', exact: true }).click();
  await root.getByRole('gridcell').first().press('Escape');
  await expect(root.getByRole('gridcell')).toHaveCount(0);
  await expect(input).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => (await objects(page))[0]?.paragraphs[0].runs)
    .toMatchObject([
      { text: 'Hello ' },
      { text: 'world', fontSize: 32, bold: true, italic: true, highlightRaw: '#64b5f6' },
    ]);
  const saved = (await objects(page))[0];
  expect(saved.paragraphs[0].runs[0]).not.toHaveProperty('highlightRaw');
  expect(saved.paragraphs[0].runs[1].inkRaw).toBe(saved.paragraphs[0].runs[0].inkRaw);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await objects(page))[0]).toEqual(saved);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  input = await editor(page);
  await input.press('End');
  await expectEditorSelection(input, 11);
  for (let index = 0; index < 5; index++) await input.press('Shift+ArrowLeft');
  await expectEditorSelection(input, 11, 6);
  await removeHighlight(page);
  await expect(input.locator('[style*="background-color"]')).toHaveCount(0);
  await input.press('End');
  await highlight(page, 3);
  await input.pressSequentially(' bright');
  await removeHighlight(page);
  await input.pressSequentially(' plain');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => (await objects(page))[0]?.paragraphs[0].runs.map((r) => r.text).join(''))
    .toBe('Hello world bright plain');
  const runs = (await objects(page))[0].paragraphs[0].runs;
  expect(runs.filter((run) => run.highlightRaw)).toEqual([
    { ...saved.paragraphs[0].runs[1], text: ' bright', highlightRaw: '#f48fb1' },
  ]);
  expect(runs.find((run) => run.text === 'world')).toMatchObject({
    bold: true,
    italic: true,
    fontSize: 32,
  });
  expect(runs.at(-1)).not.toHaveProperty('highlightRaw');
});

test('renders multiline highlights in PNG exports and preserves them after reload and re-editing', async ({
  page,
}) => {
  const input = await startText(page, 'Yellow');
  await input.press('ControlOrMeta+a');
  await highlight(page, 0);
  await input.press('End');
  await input.press('Enter');
  await highlight(page, 2);
  await input.pressSequentially('Blue');
  await input.press('Home');
  await input.press('Shift+End');
  const root = page.locator('notectl-editor');
  await root.getByRole('combobox', { name: 'Font Size', exact: true }).click();
  await root.getByRole('option', { name: '64', exact: true }).click();
  const preview = await input.locator('[style*="background-color"]').evaluateAll((elements) =>
    elements.map((element) => ({
      text: element.textContent,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }))
  );
  const downloaded = page.waitForEvent('download');
  await boardAction(page, 'save');
  const download = await downloaded;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const counts = await page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const counts = { yellow: 0, blue: 0 };
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] !== 255) continue;
      if (data[index] === 255 && data[index + 1] === 241 && data[index + 2] === 118)
        counts.yellow++;
      if (data[index] === 100 && data[index + 1] === 181 && data[index + 2] === 246) counts.blue++;
    }
    return counts;
  }, Buffer.concat(chunks).toString('base64'));
  expect(counts.yellow).toBeGreaterThan(100);
  expect(counts.blue).toBeGreaterThan(100);
  await expect
    .poll(async () => (await objects(page))[0]?.paragraphs[1].runs[0].highlightRaw)
    .toBe('#64b5f6');
  const saved = (await objects(page))[0];
  expect(saved.paragraphs[0].runs[0].highlightRaw).toBe('#fff176');
  const committed = await page.evaluate(async (object) => {
    const { layoutText } = await import('/src/board/text-layout.ts');
    return layoutText(document.createElement('canvas').getContext('2d'), object).runs.map(
      ({ run, width, ascent, descent }) => ({ text: run.text, width, height: ascent + descent })
    );
  }, saved);
  expect(preview.map((run) => run.text)).toEqual(committed.map((run) => run.text));
  for (let index = 0; index < preview.length; index++) {
    expect(Math.abs(preview[index].width - committed[index].width)).toBeLessThan(2);
    expect(Math.abs(preview[index].height - committed[index].height)).toBeLessThan(2);
  }
  await page.reload();
  await expect.poll(async () => (await objects(page))[0]).toEqual(saved);
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 110, y: 155 } });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const restored = (await editor(page)).locator('[style*="background-color"]');
  await expect(restored.nth(0)).toHaveCSS('background-color', 'rgb(255, 241, 118)');
  await expect(restored.nth(1)).toHaveCSS('background-color', 'rgb(100, 181, 246)');
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
  await boardAction(page, 'save');
  // WebKit may replace filename spaces with underscores when starting the download.
  expect((await downloaded).suggestedFilename()).toMatch(/^Board[ _]1\.png$/);
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
  const draftInput = await startText(page, 'Draft');
  await draftInput.press('ControlOrMeta+a');
  await highlight(page, 1);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (
          await (await import('/test/helpers/board-browser.js')).activeBoard()
        ).draft?.object.paragraphs[0].runs
          .map((run) => run.text)
          .join('')
      )
    )
    .toBe('Draft');
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await (await import('/test/helpers/board-browser.js')).activeBoard()).draft?.object
            .paragraphs[0].runs[0].highlightRaw
      )
    )
    .toBe('#aed581');
  await page.reload();
  await expect(await editor(page)).toBeVisible();
  await expect(await editor(page)).toContainText('Draft');
  await expect((await editor(page)).locator('[style*="background-color"]')).toHaveCSS(
    'background-color',
    'rgb(174, 213, 129)'
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  expect((await objects(page))[0].paragraphs[0].runs[0].highlightRaw).toBe('#aed581');
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
  expect((await objects(page))[0].paragraphs[0].runs[0].highlightRaw).toBe('#aed581');
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
    .poll(() =>
      page.evaluate(
        async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).draft
      )
    )
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
  // The shared pointer router captures movement on the board after grabbing Move.
  await page
    .locator('#pad')
    .dispatchEvent('pointermove', { pointerId: 77, clientX: 180, clientY: 200 });
  await page.locator('#pad').dispatchEvent('pointercancel', { pointerId: 77 });
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

test('creates, highlights, and selects text with touch taps', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch profile only');
  await chooseObject(page, 'text', true);
  const board = await page.locator('#pad').boundingBox();
  await page.touchscreen.tap(board.x + 40, board.y + 100);
  const input = await editor(page);
  await input.pressSequentially('Touch');
  await input.press('ControlOrMeta+a');
  const root = page.locator('notectl-editor');
  await root.getByRole('button', { name: 'Highlight', exact: true }).tap();
  await root.getByRole('gridcell').nth(4).tap();
  await page.getByRole('button', { name: 'Done', exact: true }).tap();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  expect((await objects(page))[0].paragraphs[0].runs[0].highlightRaw).toBe('#ffab91');
  await page.touchscreen.tap(board.x + 50, board.y + 110);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('finishes pending text for export, and clear can restore text with undo', async ({ page }) => {
  await startText(page, 'Export pending');
  const downloaded = page.waitForEvent('download');
  await boardAction(page, 'save');
  await downloaded;
  await expect(page.locator('notectl-editor')).toHaveCount(0);
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  await boardAction(page, 'clear');
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
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'boards' && !window.allowBoardSave)
        throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.reload();
  await startText(page, 'Keep recovery');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Could not save text');
  expect(
    (
      await page.evaluate(async () =>
        (await import('/test/helpers/board-browser.js')).activeBoard()
      )
    ).commands
  ).toEqual([]);
  await page.evaluate(async () => {
    window.allowBoardSave = true;
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(await editor(page)).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).draft
      )
    )
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
  await chooseObject(page, 'text');
  await page.locator('#pad').click({ position: { x: 100, y: 150 } });
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  release();
  await page.evaluate(async () => import('/src/board/text-editor.ts').then(() => {}));
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
  await highlight(page, 0);
  await expect(input.locator('[style*="background-color"]')).toHaveCSS(
    'background-color',
    'rgb(255, 241, 118)'
  );
  await expect
    .poll(() => input.locator('p').evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThan(25);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(input.locator('[style*="background-color"]')).toHaveCSS(
    'background-color',
    'rgb(255, 241, 118)'
  );
  await expect
    .poll(() => input.locator('p').evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThan(25);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  expect((await objects(page))[0].paragraphs[0].runs[0].inkRaw).not.toBe('#111827');
  if (isMobile) {
    await page.evaluate(async () => localStorage.setItem('vatio_board_lang', 'es'));
    await page.reload();
    await chooseObject(page, 'text');
    await page.locator('#pad').click({ position: { x: 110, y: 155 } });
  } else await page.locator('#langToggle').click();
  await expect(page.locator('#text')).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(await editor(page)).toBeVisible();
  await expect(
    page.locator('notectl-editor').getByRole('button', { name: 'Negrita', exact: true })
  ).toBeVisible();
  await page
    .locator('notectl-editor')
    .getByRole('button', { name: 'Resaltado', exact: true })
    .click();
  await expect(
    page.locator('notectl-editor').getByRole('button', { name: 'Ninguno', exact: true })
  ).toBeVisible();
  await expect(page.locator('notectl-editor').getByRole('gridcell')).toHaveCount(5);
  await page.locator('notectl-editor').getByRole('gridcell').first().press('Escape');
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
  await page.getByRole('button', { name: 'Fit drawing', exact: true }).click();
  const selected = page.locator('#textSelection');
  await selected.focus();
  await selected.press('Home');
  for (let index = 0; index < 15; index++) await selected.press('Shift+ArrowUp');
  await expect(page.getByRole('button', { name: 'Move', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeInViewport();
});
