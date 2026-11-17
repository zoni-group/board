import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_DRAWING_KEY } from '../../src/board/storage.ts';
import { bootHtmlPage, expectPageSeo, flushTasks } from '../helpers/page-smoke.js';

vi.mock('@jaames/iro', () => ({
  default: {
    ColorPicker: vi.fn((_parent, options) => ({
      color: { hexString: options.color },
      on: vi.fn(),
      off: vi.fn(),
    })),
    ui: {
      Box: () => null,
      Slider: () => null,
    },
  },
}));

async function flushBoardTasks(iterations = 8) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

function dispatchBoardStroke(canvas, pointerId, clientX, clientY) {
  const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX, clientY });
  const pointerUp = new MouseEvent('pointerup', { bubbles: true, clientX, clientY });
  Object.defineProperty(pointerDown, 'pointerId', { value: pointerId });
  Object.defineProperty(pointerUp, 'pointerId', { value: pointerId });
  canvas.dispatchEvent(pointerDown);
  canvas.dispatchEvent(pointerUp);
}

describe('index.html smoke', () => {
  beforeEach(async () => {
    vi.resetModules();
    await bootHtmlPage('index.html');
  });

  it('boots the board page as a local-only drawing app', async () => {
    await import('../../src/board/board.ts');
    await flushBoardTasks();

    expectPageSeo({
      title: 'ZONI® Board – Local Drawing Board',
      canonical: 'https://board.zoni.edu/',
    });
    expect(document.documentElement.lang).toBe('en');
    expect(document.getElementById('langToggle').textContent).toBe('EN');
    expect(document.getElementById('pen').getAttribute('aria-label')).toBe('Pen');
    expect(document.querySelector('#pen .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('erase').getAttribute('aria-label')).toBe('Eraser');
    expect(document.querySelector('#erase .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('undo').getAttribute('aria-label')).toBe('Undo');
    expect(document.querySelector('#undo .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('redo').getAttribute('aria-label')).toBe('Redo');
    expect(document.querySelector('#redo .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('clear').getAttribute('aria-label')).toBe('Clear');
    expect(document.querySelector('#clear .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('save').getAttribute('aria-label')).toBe('Save PNG');
    expect(document.querySelector('#save .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('undo').disabled).toBe(true);
    expect(document.getElementById('redo').disabled).toBe(true);
    expect(document.getElementById('sizePreview')).toBeTruthy();
    expect(
      document.getElementById('sizePreview').style.getPropertyValue('--board-size-preview')
    ).toBe('6px');
    expect(document.querySelector('.size-label #swatches')).toBeTruthy();
    expect(document.querySelector('.canvas-frame .board-canvas-meta')).toBeTruthy();
    expect(document.querySelector('[data-i18n="localOnly"]').textContent).toBe(
      'Saved on this device only'
    );
    expect(document.getElementById('toolsMenuBtn')).toBeNull();
    expect(document.getElementById('openCalc')).toBeNull();
    expect(document.getElementById('openSpeed')).toBeNull();
    expect(document.getElementById('openEnergy')).toBeNull();
    expect(document.querySelector('[data-backend-auth]')).toBeNull();
    expect(document.querySelector('.calc-panel')).toBeNull();
    expect(document.querySelector('.energy-panel')).toBeNull();
    expect(document.querySelector('.floating-dock')).toBeNull();
    expect(window.fetch).not.toHaveBeenCalled();

    document.getElementById('size').value = '12';
    document.getElementById('size').dispatchEvent(new Event('input', { bubbles: true }));
    expect(
      document.getElementById('sizePreview').style.getPropertyValue('--board-size-preview')
    ).toBe('12px');

    document.getElementById('erase').click();
    expect(document.getElementById('erase').getAttribute('aria-pressed')).toBe('true');
    document
      .querySelector('#swatches .swatch')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('pen').getAttribute('aria-pressed')).toBe('true');

    document.getElementById('sizePreview').click();
    expect(document.getElementById('colorPopup').hidden).toBe(false);
    expect(document.documentElement.classList.contains('has-iro')).toBe(true);

    const canvas = document.getElementById('pad');
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12 });
    const pointerMove = new MouseEvent('pointermove', { bubbles: true, clientX: 42, clientY: 32 });
    const pointerUp = new MouseEvent('pointerup', { bubbles: true, clientX: 42, clientY: 32 });
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
    Object.defineProperty(pointerMove, 'pointerId', { value: 1 });
    Object.defineProperty(pointerUp, 'pointerId', { value: 1 });

    canvas.dispatchEvent(pointerDown);
    canvas.dispatchEvent(pointerMove);
    canvas.dispatchEvent(pointerUp);
    await flushBoardTasks();

    const storedDrawing = JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY));
    expect(storedDrawing.commandCount).toBe(1);
    expect(document.getElementById('undo').disabled).toBe(false);
    expect(document.getElementById('redo').disabled).toBe(true);

    document.getElementById('undo').click();
    expect(document.getElementById('status').textContent).toBe('Undo');
    expect(document.getElementById('undo').disabled).toBe(true);
    expect(document.getElementById('redo').disabled).toBe(false);

    document.getElementById('redo').click();
    expect(document.getElementById('status').textContent).toBe('Redo');
    expect(document.getElementById('undo').disabled).toBe(false);
    expect(document.getElementById('redo').disabled).toBe(true);

    document.getElementById('langToggle').click();
    expect(document.documentElement.lang).toBe('es');
    expect(document.getElementById('langToggle').textContent).toBe('ES');
    expect(document.querySelector('[data-i18n="localOnly"]').textContent).toBe(
      'Guardado solo en este dispositivo'
    );
  });

  it('initializes the color picker and uses its color changes in saved strokes', async () => {
    const { default: iro } = await import('@jaames/iro');
    await import('../../src/board/board.ts');
    await flushBoardTasks();
    document.getElementById('sizePreview').click();

    expect(iro.ColorPicker).toHaveBeenCalledWith(
      document.getElementById('iroPicker'),
      expect.objectContaining({ width: 260 })
    );
    const picker = iro.ColorPicker.mock.results[0].value;
    const [, onColorChange] = picker.on.mock.calls.find(([event]) => event === 'color:change');
    picker.color.hexString = '#2563eb';
    onColorChange(picker.color);

    expect(document.getElementById('hexInput').value).toBe('#2563eb');
    expect(localStorage.getItem('vatio_board_ink_raw')).toBe('#2563eb');
    dispatchBoardStroke(document.getElementById('pad'), 1, 24, 24);
    await flushBoardTasks();
    expect(JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY)).commands[0].inkRaw).toBe('#2563eb');
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('keeps the hex color control usable when the picker fails', async () => {
    const { default: iro } = await import('@jaames/iro');
    iro.ColorPicker.mockImplementationOnce(() => {
      throw new Error('Picker unavailable');
    });
    await import('../../src/board/board.ts');
    await flushBoardTasks();
    document.getElementById('sizePreview').click();

    expect(document.getElementById('colorPopup').hidden).toBe(false);
    expect(document.documentElement.classList.contains('has-iro')).toBe(false);
    const input = document.getElementById('hexInput');
    input.value = '#123abc';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('vatio_board_ink_raw')).toBe('#123abc');
  });

  it('keeps drawing locked to one pointer and suppresses native selection', async () => {
    await import('../../src/board/board.ts');
    await flushBoardTasks();

    const canvas = document.getElementById('pad');
    const ctx = canvas.getContext('2d');
    ctx.quadraticCurveTo.mockClear();

    const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });
    expect(canvas.dispatchEvent(selectStart)).toBe(false);

    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12 });
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
    canvas.dispatchEvent(pointerDown);

    expect(document.body.classList.contains('board-is-drawing')).toBe(true);

    const foreignMove = new MouseEvent('pointermove', { bubbles: true, clientX: 60, clientY: 60 });
    Object.defineProperty(foreignMove, 'pointerId', { value: 2 });
    canvas.dispatchEvent(foreignMove);
    expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();

    const activeMove = new MouseEvent('pointermove', { bubbles: true, clientX: 42, clientY: 32 });
    Object.defineProperty(activeMove, 'pointerId', { value: 1 });
    canvas.dispatchEvent(activeMove);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(1);

    const selectWhileDrawing = new Event('selectstart', { bubbles: true, cancelable: true });
    expect(document.dispatchEvent(selectWhileDrawing)).toBe(false);

    const lostCapture = new Event('lostpointercapture', { bubbles: true });
    Object.defineProperty(lostCapture, 'pointerId', { value: 1 });
    canvas.dispatchEvent(lostCapture);

    expect(document.body.classList.contains('board-is-drawing')).toBe(false);
    expect(document.getElementById('undo').disabled).toBe(true);
    expect(localStorage.getItem(BOARD_DRAWING_KEY)).toBeNull();
  });

  it('cancels an active stroke before redoing history', async () => {
    await import('../../src/board/board.ts');
    await flushBoardTasks();

    const canvas = document.getElementById('pad');
    dispatchBoardStroke(canvas, 1, 24, 24);

    document.getElementById('undo').click();
    await flushBoardTasks();
    expect(document.getElementById('redo').disabled).toBe(false);

    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: 48, clientY: 48 });
    Object.defineProperty(pointerDown, 'pointerId', { value: 2 });
    canvas.dispatchEvent(pointerDown);
    expect(document.body.classList.contains('board-is-drawing')).toBe(true);

    document.getElementById('redo').click();
    expect(document.body.classList.contains('board-is-drawing')).toBe(false);
    expect(document.getElementById('redo').disabled).toBe(true);

    const pointerUp = new MouseEvent('pointerup', { bubbles: true, clientX: 48, clientY: 48 });
    Object.defineProperty(pointerUp, 'pointerId', { value: 2 });
    canvas.dispatchEvent(pointerUp);

    document.getElementById('undo').click();
    expect(document.getElementById('undo').disabled).toBe(true);
    expect(document.getElementById('redo').disabled).toBe(false);
  });

  it('keeps an active stroke when a resize event does not change the drawing surface', async () => {
    await import('../../src/board/board.ts');
    await flushBoardTasks();
    const canvas = document.getElementById('pad');
    const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 24, clientY: 24 });
    Object.defineProperty(down, 'pointerId', { value: 80 });
    canvas.dispatchEvent(down);
    const clearCount = canvas.getContext('2d').clearRect.mock.calls.length;
    window.dispatchEvent(new Event('resize'));
    expect(canvas.getContext('2d').clearRect).toHaveBeenCalledTimes(clearCount);
    expect(document.body.classList.contains('board-is-drawing')).toBe(true);
    const up = new MouseEvent('pointerup', { bubbles: true, clientX: 24, clientY: 24 });
    Object.defineProperty(up, 'pointerId', { value: 80 });
    canvas.dispatchEvent(up);
    await flushBoardTasks();
    expect(JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY)).commands).toHaveLength(1);
  });

  it('restores large saved drafts after reload without dropping older strokes', async () => {
    await import('../../src/board/board.ts');
    await flushBoardTasks();

    const canvas = document.getElementById('pad');
    const ctx = canvas.getContext('2d');
    ctx.fillRect.mockClear();
    ctx.drawImage.mockClear();

    for (let index = 0; index < 125; index += 1) {
      dispatchBoardStroke(canvas, index + 1, 12 + (index % 40), 18 + (index % 50));
    }

    await flushBoardTasks();

    expect(ctx.drawImage).toHaveBeenCalledTimes(125);

    const storedBeforeReload = JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY));
    expect(storedBeforeReload.commandCount).toBe(125);
    expect(storedBeforeReload.commands).toHaveLength(125);

    vi.resetModules();
    await bootHtmlPage('index.html');
    await import('../../src/board/board.ts');
    await flushBoardTasks();

    expect(document.getElementById('undo').disabled).toBe(false);

    document.getElementById('undo').click();
    await flushBoardTasks();

    const storedAfterUndo = JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY));
    expect(storedAfterUndo.commandCount).toBe(124);
    expect(storedAfterUndo.redoCount).toBe(1);
  });

  it('replays pen, eraser, and clear commands through undo and redo', async () => {
    await import('../../src/board/board.ts');
    await flushBoardTasks();
    const canvas = document.getElementById('pad');
    dispatchBoardStroke(canvas, 1, 12, 12);
    document.getElementById('erase').click();
    dispatchBoardStroke(canvas, 2, 24, 24);
    document.getElementById('clear').click();
    await flushBoardTasks();
    expect(
      JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY)).commands.map(({ type, tool }) => [
        type,
        tool,
      ])
    ).toEqual([
      ['stroke', 'pen'],
      ['stroke', 'eraser'],
      ['clear', undefined],
    ]);

    document.getElementById('undo').click();
    await flushBoardTasks();
    let saved = JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY));
    expect(saved.commands).toHaveLength(2);
    expect(saved.redoCommands).toEqual([{ type: 'clear' }]);
    document.getElementById('redo').click();
    await flushBoardTasks();
    saved = JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY));
    expect(saved.commands.at(-1)).toEqual({ type: 'clear' });
    expect(saved.redoCommands).toEqual([]);
  });

  it('keeps saved board coordinates stable across resize and device pixel ratio changes', async () => {
    await import('../../src/board/board.ts');
    await flushBoardTasks();
    const canvas = document.getElementById('pad');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 400,
      height: 300,
    });
    dispatchBoardStroke(canvas, 1, 24, 48);
    await flushBoardTasks();
    const beforeResize = JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY));
    expect(beforeResize.commands[0].points).toEqual([{ x: 14, y: 28 }]);

    vi.stubGlobal('devicePixelRatio', 2);
    try {
      window.dispatchEvent(new Event('resize'));
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
      // Keep the same world center when the viewport size changes.
      expect(canvas.getContext('2d').setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 80, -20);
      expect(JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY))).toEqual(beforeResize);
      document.getElementById('undo').click();
      document.getElementById('redo').click();
      await flushBoardTasks();
      expect(JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY)).commands).toEqual(
        beforeResize.commands
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('downloads a PNG locally when save is clicked', async () => {
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    await import('../../src/board/board.ts');
    await flushBoardTasks();

    document.getElementById('save').click();
    await flushBoardTasks();

    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    expect(document.getElementById('status').textContent).toBe('Downloaded PNG');
    expect(window.fetch).not.toHaveBeenCalled();
  });
});
