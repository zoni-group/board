import { chooseObject } from '../helpers/object-picker.js';
import { test, expect } from '@playwright/test';

async function expectScreenLayout(page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const screen = window.visualViewport;
        const top = screen?.offsetTop ?? 0,
          left = screen?.offsetLeft ?? 0;
        const width = screen?.width ?? innerWidth,
          height = screen?.height ?? innerHeight;
        const nav = document.querySelector('.board-navigation').getBoundingClientRect();
        const canvas = document.querySelector('#pad');
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, devicePixelRatio || 1);
        return {
          noPageScroll:
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth &&
            scrollY === 0 &&
            scrollX === 0,
          navigationVisible:
            nav.top >= top &&
            nav.bottom <= top + height &&
            nav.left >= left &&
            nav.right <= left + width,
          canvasFits: rect.top >= top && rect.bottom <= top + height && rect.height > 0,
          buffersMatch:
            canvas.width === Math.max(1, Math.floor(rect.width * dpr)) &&
            canvas.height === Math.max(1, Math.floor(rect.height * dpr)),
        };
      })
    )
    .toEqual({ noPageScroll: true, navigationVisible: true, canvasFits: true, buffersMatch: true });
  expect(
    await page.locator('.board-navigation button').evaluateAll((buttons) =>
      buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return button.contains(target) && rect.height >= 44;
      })
    )
  ).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#text')).toBeEnabled();
});

for (const [width, height] of [
  [1440, 900],
  [1280, 320],
  [800, 300],
  [667, 240],
  [390, 240],
  [320, 160],
]) {
  test(`keeps navigation and canvas inside ${width}x${height} without page scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await expectScreenLayout(page);
    await page.evaluate(async () => window.scrollTo(0, 1000));
    await expectScreenLayout(page);
    await page.locator('#pad').focus();
    await page.keyboard.press('PageDown');
    await expectScreenLayout(page);
  });
}

test('clamps saved views and every interactive zoom path to 50%', async ({ page }) => {
  const center = { x: -1200, y: 700 };
  await page.evaluate(async (center) => {
    await (
      await import('/test/helpers/board-browser.js')
    ).seedBoard({ viewport: { center, zoom: 0.01 } });
  }, center);
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  await expect(page.locator('#zoomReset')).toHaveText('50%');
  expect(
    await page.evaluate(
      async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).viewport
    )
  ).toEqual({ center, zoom: 0.5 });
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
  await page
    .locator('#pad')
    .dispatchEvent('wheel', { ctrlKey: true, deltaY: 10000, clientX: 100, clientY: 150 });
  await page.locator('#pad').focus();
  await page.keyboard.press('-');
  const rect = await page.locator('#pad').boundingBox();
  for (const [type, id, x] of [
    ['pointerdown', 71, 100],
    ['pointerdown', 72, 200],
    ['pointermove', 72, 110],
    ['pointerup', 72, 110],
    ['pointerup', 71, 100],
  ]) {
    await page.locator('#pad').dispatchEvent(type, {
      pointerId: id,
      pointerType: 'touch',
      clientX: rect.x + x,
      clientY: rect.y + 100,
      button: 0,
    });
  }
  await expect(page.locator('#zoomReset')).toHaveText('50%');
  await page.evaluate(async () => {
    await (
      await import('/test/helpers/board-browser.js')
    ).seedBoard({
      commands: [
        {
          type: 'stroke',
          id: 'wide-line',
          tool: 'pen',
          size: 2,
          inkRaw: '#111827',
          points: [
            { x: -2000, y: 0 },
            { x: 2000, y: 0 },
          ],
        },
      ],
      redoCommands: [],
    });
  });
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  await page.getByRole('button', { name: 'Fit drawing', exact: true }).click();
  await expect(page.locator('#zoomReset')).toHaveText('50%');
  await expect(page.locator('#status')).toContainText('Pan to see the rest');
});

test('keeps the smallest brush visible at the minimum zoom', async ({ page }) => {
  await page.locator('#size').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#size')).toHaveValue('2');
  for (let i = 0; i < 4; i++)
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(page.locator('#zoomReset')).toHaveText('50%');
  const rect = await page.locator('#pad').boundingBox();
  await page.mouse.move(rect.x + 40, rect.y + 50);
  await page.mouse.down();
  await page.mouse.move(rect.x + 140, rect.y + 50, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.locator('#pad').evaluate((canvas) => {
        const dpr = devicePixelRatio || 1;
        const { data } = canvas
          .getContext('2d')
          .getImageData(
            Math.floor(45 * dpr),
            Math.floor(46 * dpr),
            Math.floor(90 * dpr),
            Math.ceil(8 * dpr)
          );
        let dark = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] < 210 && data[i + 1] < 210 && data[i + 2] < 210) dark++;
        return dark / dpr;
      })
    )
    .toBeGreaterThan(50);
});

for (const [width, height] of [
  [390, 240],
  [320, 160],
]) {
  test(`keeps editor actions and popovers above navigation at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await chooseObject(page, 'text');
    await page.locator('#pad').click({ position: { x: 8, y: 20 } });
    const root = page.locator('notectl-editor');
    const input = root.getByRole('textbox');
    await input.evaluate((element) => {
      const data = new DataTransfer();
      data.setData('text/plain', Array(20).fill('Long text').join('\n'));
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          composed: true,
          cancelable: true,
          clipboardData: data,
        })
      );
    });
    const navigation = await page.locator('.board-navigation').boundingBox();
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
    const actions = await page.locator('.text-editor-actions').boundingBox();
    expect(actions.y + actions.height).toBeLessThan(navigation.y);
    expect(
      await page
        .locator('.board-text-editor-body')
        .evaluate(
          (body) =>
            body.scrollHeight > body.clientHeight ||
            body.querySelector('notectl-editor').shadowRoot.querySelector('[contenteditable]')
              .scrollHeight >
              body.querySelector('notectl-editor').shadowRoot.querySelector('[contenteditable]')
                .clientHeight
        )
    ).toBe(true);
    await input.press('ControlOrMeta+a');
    await root.getByRole('button', { name: 'Highlight', exact: true }).click();
    await expect
      .poll(() =>
        root.locator('.notectl-popup').evaluate((popup) => popup.getBoundingClientRect().bottom)
      )
      .toBeLessThan(navigation.y);
    await root.getByRole('gridcell').first().click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    await expect(edit).toBeInViewport();
    const selectedTools = await page.locator('.text-selection-actions').boundingBox();
    expect(selectedTools.y + selectedTools.height).toBeLessThan(navigation.y);
    await edit.click();
    await expect(root.getByRole('textbox')).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    await expectScreenLayout(page);
    await page.locator('#sizePreview').click();
    const card = await page.locator('.color-popup-card').boundingBox();
    expect(card.y + card.height).toBeLessThan(navigation.y);
    await expect(page.locator('#colorPopupClose')).toBeInViewport();
    await expectScreenLayout(page);
    await page.locator('#colorPopupClose').click();
  });
}

test('follows visual viewport changes without scrolling or rewriting drawing coordinates', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      width: 390,
      height: 640,
      offsetLeft: 0,
      offsetTop: 0,
    });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  });
  await page.setViewportSize({ width: 390, height: 640 });
  await page.reload();
  await expect(page.locator('#text')).toBeEnabled();
  await page.locator('#pad').click({ position: { x: 30, y: 30 } });
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await (await import('/test/helpers/board-browser.js')).activeBoard()).commands.length
      )
    )
    .toBe(1);
  const before = await page.evaluate(
    async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).commands
  );
  await page.evaluate(async () => {
    Object.assign(visualViewport, { height: 240, offsetTop: 20 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await expectScreenLayout(page);
  await expect(page.locator('html')).toHaveClass(/board-short-viewport/);
  await page.locator('#sizePreview').click();
  await expect(page.locator('#colorPopupClose')).toBeInViewport();
  await expectScreenLayout(page);
  const navigation = await page.locator('.board-navigation').boundingBox();
  const popup = await page.locator('.color-popup-card').boundingBox();
  expect(popup.y + popup.height).toBeLessThan(navigation.y);
  await page.locator('#colorPopupClose').click();
  expect(
    await page.evaluate(
      async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).commands
    )
  ).toEqual(before);
  await page.evaluate(async () => {
    Object.assign(visualViewport, { height: 640, offsetTop: 0 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await expectScreenLayout(page);
  expect(
    await page.evaluate(
      async () => (await (await import('/test/helpers/board-browser.js')).activeBoard()).commands
    )
  ).toEqual(before);
});
