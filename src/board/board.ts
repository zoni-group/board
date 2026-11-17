import '../styles/board.less';

import { loadBoardDrawing, saveBoardDrawing } from './storage.ts';
import { cloneCommand, clonePoint } from './model.ts';
import { createTextTool } from './text-tool.ts';
import { createShapeTool } from './shape-tool.ts';
import { createSelection } from './selection.ts';
import { createContentTool } from './content-tool.ts';
import { createAssetCache } from './assets.ts';
import { drawContent, contentBounds } from './content.ts';
import { renderInk } from './ink.ts';
import { createBoardNavigation } from './navigation.ts';
import { observeScreenLayout } from './screen-layout.ts';
import {
  applyStrokeStyle,
  createBoardScene,
  createDrawingCanvas,
  drawStroke,
} from './scene-renderer.ts';
import type { BoardScene } from './scene-renderer.ts';
import {
  applyViewport,
  fitViewport,
  initialViewport,
  loadViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  saveViewport,
  screenToWorld,
  boundsIntersect,
  visibleBounds,
  zoomAt,
} from './viewport.ts';
import type { BoardViewport } from './viewport.ts';
import type { BoardCommand, BoardSnapshot, Point, StrokeCommand, BoardTool } from './model.ts';
import type { Language } from '../i18n.ts';

import { applyButtonIcon } from '../shared/tools-menu.ts';
import { loadText, saveText } from '../shared/storage.ts';
import iro from '@jaames/iro';
import { t, applyTranslations, toggleLang, getLang } from '../i18n.ts';
import {
  IconDownload,
  IconEraser,
  IconPen,
  IconRedo,
  IconTrash,
  IconUndo,
  IconText,
  IconHand,
  IconSelect,
  IconFit,
  ShapeIcons,
} from '../icons.ts';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface ToolOptions {
  announce?: boolean;
}

function requireElement<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K
): HTMLElementTagNameMap[K] {
  const element = document.querySelector<HTMLElementTagNameMap[K]>(`${tag}#${id}`);
  if (!element) throw new Error(`Missing board element: ${tag}#${id}`);
  return element;
}

function requireCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Board canvas context is unavailable.');
  return context;
}
// Apply translations immediately
applyTranslations();

const langToggleButtons = Array.from(document.querySelectorAll('[data-lang-toggle], #langToggle'));

function syncLangToggleButtons(langCode: Language = getLang()) {
  const nextLabel = String(langCode || getLang()).toUpperCase();
  langToggleButtons.forEach((button) => {
    button.textContent = nextLabel;
  });
}

syncLangToggleButtons(getLang());
langToggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const newLang = toggleLang();
    syncLangToggleButtons(newLang);
  });
});

// Toolbar buttons
applyButtonIcon(requireElement('text', 'button'), IconText);
applyButtonIcon(requireElement('shapes', 'button'), ShapeIcons.rectangle);
applyButtonIcon(requireElement('pen', 'button'), IconPen);
applyButtonIcon(requireElement('erase', 'button'), IconEraser);
applyButtonIcon(requireElement('undo', 'button'), IconUndo);
applyButtonIcon(requireElement('redo', 'button'), IconRedo);
applyButtonIcon(requireElement('clear', 'button'), IconTrash);
applyButtonIcon(requireElement('save', 'button'), IconDownload);
applyButtonIcon(requireElement('hand', 'button'), IconHand);
applyButtonIcon(requireElement('select', 'button'), IconSelect);
applyButtonIcon(requireElement('fitDrawing', 'button'), IconFit);

(function () {
  const canvas = requireElement('pad', 'canvas');
  const ctx = requireCanvasContext(canvas);
  const historyCanvas = document.createElement('canvas');
  const historyCtx = requireCanvasContext(historyCanvas);
  const statusEl = requireElement('status', 'span');

  const textLayer = requireElement('textLayer', 'canvas');
  const shapeLayer = requireElement('shapeLayer', 'canvas');
  const shapesBtn = requireElement('shapes', 'button');
  const textContext = requireCanvasContext(textLayer);
  const textBtn = requireElement('text', 'button');
  const penBtn = requireElement('pen', 'button');
  const eraseBtn = requireElement('erase', 'button');
  const undoBtn = requireElement('undo', 'button');
  const redoBtn = requireElement('redo', 'button');
  const sizeEl = requireElement('size', 'input');
  const sizePreview = requireElement('sizePreview', 'button');
  const clearBtn = requireElement('clear', 'button');
  const saveBtn = requireElement('save', 'button');
  const handBtn = requireElement('hand', 'button');
  const selectBtn = requireElement('select', 'button');
  const zoomInBtn = requireElement('zoomIn', 'button');
  const zoomOutBtn = requireElement('zoomOut', 'button');
  const zoomResetBtn = requireElement('zoomReset', 'button');
  const fitBtn = requireElement('fitDrawing', 'button');
  const app = document.querySelector<HTMLElement>('.app');
  if (!app) throw new Error('Missing board app');

  // NEW: color UI
  const swatchesEl = requireElement('swatches', 'div');

  const LS_INK_RAW = 'vatio_board_ink_raw';
  let saveBusy = false;

  function isDarkMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  let inkRaw = normalizeHex(loadText(LS_INK_RAW)) || (isDarkMode() ? '#e5e7eb' : '#111827');

  // Popup UI
  const colorTriggerBtn = requireElement('sizePreview', 'button');
  const colorPopup = document.getElementById('colorPopup');
  const colorPopupClose = document.getElementById('colorPopupClose');

  const hexInput = requireElement('hexInput', 'input');
  const rRange = document.querySelector<HTMLInputElement>('input#rRange');
  const gRange = document.querySelector<HTMLInputElement>('input#gRange');
  const bRange = document.querySelector<HTMLInputElement>('input#bRange');
  const rVal = document.getElementById('rVal');
  const gVal = document.getElementById('gVal');
  const bVal = document.getElementById('bVal');

  const iroPickerEl = document.getElementById('iroPicker');

  let iroPicker: iro.ColorPicker | null = null;
  let syncingFromIro = false;

  function setPopupFromInkRaw() {
    const rgb = hexToRgb(inkRaw) || { r: 17, g: 24, b: 39 };
    if (rRange) rRange.value = String(rgb.r);
    if (gRange) gRange.value = String(rgb.g);
    if (bRange) bRange.value = String(rgb.b);
    if (rVal) rVal.textContent = String(rgb.r);
    if (gVal) gVal.textContent = String(rgb.g);
    if (bVal) bVal.textContent = String(rgb.b);
    if (hexInput) hexInput.value = inkRaw;
  }

  function setInkFromSliders() {
    const r = parseInt(rRange?.value || '0', 10);
    const g = parseInt(gRange?.value || '0', 10);
    const b = parseInt(bRange?.value || '0', 10);

    if (rVal) rVal.textContent = String(r);
    if (gVal) gVal.textContent = String(g);
    if (bVal) bVal.textContent = String(b);

    const hex = rgbToHex({ r, g, b });
    if (hexInput) hexInput.value = hex;
    setInkRaw(hex);
  }

  function openColorPopup() {
    setPopupFromInkRaw();
    ensureIroPicker();
    syncIroFromInk();
    if (colorPopup) colorPopup.hidden = false;
  }

  function closeColorPopup() {
    if (colorPopup) colorPopup.hidden = true;
    shapeTool.flushStyle();
  }

  colorTriggerBtn?.addEventListener('click', openColorPopup);
  colorPopupClose?.addEventListener('click', closeColorPopup);
  colorPopup?.addEventListener('click', (e) => {
    if (e.target === colorPopup) closeColorPopup();
  });
  swatchesEl?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.swatch')) return;
    event.preventDefault();
    event.stopPropagation();
  });

  [rRange, gRange, bRange].forEach((el) => el?.addEventListener('input', setInkFromSliders));

  hexInput?.addEventListener('change', () => {
    const h = normalizeHex(hexInput.value);
    if (h) {
      setInkRaw(h);
      syncIroFromInk();
    } else {
      setPopupFromInkRaw();
    }
  });

  let tool: BoardTool = 'pen';
  let drawing = false;
  let activePointerId: number | null = null;
  let last: Point | null = null;
  let currentStroke: StrokeCommand | null = null;
  let boardStateRevision = 0;
  let boardReady = false;
  let canvasCssWidth = 0;
  let canvasCssHeight = 0;
  let canvasDpr = 1;
  let viewport: BoardViewport | null = loadViewport();
  let viewportTimer: number | undefined;
  let viewportDirty = false;
  let redrawFrame: number | null = null;
  let scene: BoardScene | null = null;
  let sceneLength = -1;
  let sceneLast: BoardCommand | undefined;
  const commandHistory: BoardCommand[] = [];
  const redoHistory: BoardCommand[] = [];
  const assets = createAssetCache(redrawCanvas);
  const selection = createSelection({
    canvas,
    textContext,
    scene: getScene,
    view: () => viewport ?? initialViewport(boardSize()),
    tool: () => tool,
    editing: () => textTool.isEditing() || contentTool.isEditing(),
    hidden: () => shapeTool.isBusy() || shapeTool.isPickerOpen() || contentTool.isPickerOpen(),
    redraw: redrawCanvas,
    commit(command) {
      pushHistoryCommand(command);
      redrawCanvas();
      setStatus(t('draftUpdated'));
      return queueBoardPersistence();
    },
    editObject: (ref) => (ref.kind === 'text' ? textTool.edit(ref.id) : contentTool.edit(ref)),
    beginGrip: (event, ref) => navigation.beginDrag(event, () => selection.begin(event, ref)),
    changed(ref, style) {
      const disabled =
        selection.isDragging() ||
        (tool === 'select' && ref !== null && ref.kind !== 'stroke' && ref.kind !== 'shape');
      for (const control of [
        sizeEl,
        sizePreview,
        ...swatchesEl.querySelectorAll<HTMLButtonElement>('button'),
      ])
        control.disabled = disabled;
      if (!style) return;
      sizeEl.value = String(style.size);
      sizePreview.style.setProperty('--board-size-preview', `${sizeEl.value}px`);
      sizeEl.setAttribute('aria-valuetext', sizeEl.value);
      inkRaw = style.inkRaw;
      saveText(LS_INK_RAW, inkRaw);
      applyInk();
      setPopupFromInkRaw();
      syncIroFromInk();
    },
    status: setStatus,
  });
  const shapeTool = createShapeTool({
    canvas,
    layer: shapeLayer,
    button: shapesBtn,
    selection,
    getObjects: () => getScene().shapes,
    getViewport: () => viewport ?? initialViewport(boardSize()),
    style: () => ({ size: Number(sizeEl.value) || 6, inkRaw }),
    ink: renderedInk,
    commit(command) {
      pushHistoryCommand(command);
      redrawCanvas();
      setStatus(t('draftUpdated'));
      return queueBoardPersistence();
    },
    status: setStatus,
  });
  const textTool = createTextTool({
    canvas,
    selection,
    selecting: () => tool === 'select',
    layer: textLayer,
    context: textContext,
    getObjects: () => getScene().text,
    getViewport: () => viewport ?? initialViewport(boardSize()),
    reveal(center) {
      changeViewport({ center, zoom: viewport?.zoom ?? 1 });
    },
    getHistory: () => [...commandHistory, ...redoHistory],
    persist: queueBoardPersistence,
    commit(command) {
      pushHistoryCommand(command);
      redrawCanvas();
      setStatus(t('draftUpdated'));
      return queueBoardPersistence();
    },
    historyChanged: syncHistoryButtons,
    ink: appliedInkFromRaw,
    status: setStatus,
  });
  const contentTool = createContentTool({
    canvas,
    button: textBtn,
    selection,
    ready: () => boardReady,
    objects: () => getScene().content,
    view: () => viewport ?? initialViewport(boardSize()),
    prepare: () => selectTool('select'),
    text: () => {
      selectTool('text');
    },
    commit(command) {
      pushHistoryCommand(command);
      redrawCanvas();
      setStatus(t('draftUpdated'));
      return queueBoardPersistence();
    },
    redraw: redrawCanvas,
    historyChanged: syncHistoryButtons,
    ink: appliedInkFromRaw,
    status: setStatus,
  });

  function boardSize() {
    return { width: canvasCssWidth, height: canvasCssHeight };
  }
  function getScene(): BoardScene {
    const lastCommand = commandHistory.at(-1);
    if (!scene || sceneLength !== commandHistory.length || sceneLast !== lastCommand) {
      scene = createBoardScene(commandHistory, textContext);
      sceneLength = commandHistory.length;
      sceneLast = lastCommand;
    }
    return scene;
  }
  function syncViewportControls() {
    if (!viewport) return;
    const percent = Math.round(viewport.zoom * 100);
    zoomResetBtn.textContent = `${percent}%`;
    zoomResetBtn.setAttribute('aria-label', `${percent}% · ${t('resetZoom')}`);
    zoomOutBtn.disabled = viewport.zoom <= MIN_ZOOM;
    zoomInBtn.disabled = viewport.zoom >= MAX_ZOOM;
  }
  function persistViewport() {
    window.clearTimeout(viewportTimer);
    if (viewport && viewportDirty) viewportDirty = !saveViewport(viewport);
  }
  function queueViewportPersistence() {
    viewportDirty = true;
    window.clearTimeout(viewportTimer);
    viewportTimer = window.setTimeout(persistViewport, 250);
  }
  function changeViewport(next: BoardViewport) {
    viewport = next;
    syncViewportControls();
    queueViewportPersistence();
    if (redrawFrame === null)
      redrawFrame = window.requestAnimationFrame(() => {
        redrawFrame = null;
        redrawCanvas();
      });
  }
  function fitDrawing() {
    shapeTool.flushStyle();
    const bounds = getScene().bounds;
    const fitted = fitViewport(bounds, boardSize());
    changeViewport(fitted);
    if (
      bounds &&
      (bounds.width * fitted.zoom > Math.max(1, canvasCssWidth - 64) ||
        bounds.height * fitted.zoom > Math.max(1, canvasCssHeight - 64))
    )
      setStatus(t('minimumZoomReached'));
  }

  // Theme-aware colors from CSS variables
  function cssVar(name: string) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function currentCanvasBg() {
    return cssVar('--canvas-bg') || '#ffffff';
  }

  function setStatus(s: string) {
    statusEl.textContent = s;
  }

  function syncSaveButton() {
    if (!saveBtn) return;
    saveBtn.disabled = saveBusy;
  }

  function setActive(options: ToolOptions = {}) {
    const shouldAnnounce = options.announce !== false;
    textBtn.setAttribute('aria-pressed', tool === 'text' ? 'true' : 'false');
    penBtn.setAttribute('aria-pressed', tool === 'pen' ? 'true' : 'false');
    eraseBtn.setAttribute('aria-pressed', tool === 'eraser' ? 'true' : 'false');
    handBtn.setAttribute('aria-pressed', tool === 'hand' ? 'true' : 'false');
    shapesBtn.setAttribute('aria-pressed', String(tool === 'shapes'));
    selectBtn.setAttribute('aria-pressed', String(tool === 'select'));
    canvas.classList.toggle('select-tool-active', tool === 'select');
    selection.paint();
    navigation.syncCursor();
    if (shouldAnnounce) {
      setStatus(
        tool === 'select'
          ? t('selectHint')
          : tool === 'text'
            ? t('text')
            : tool === 'shapes'
              ? t('shapeHint')
              : tool === 'pen'
                ? t('pen')
                : tool === 'hand'
                  ? t('navigationHint')
                  : t('eraser')
      );
    }
  }

  function activatePenTool(options: ToolOptions = {}) {
    if (tool === 'shapes' || tool === 'select') return;
    if (tool === 'pen') {
      if (options.announce) setActive(options);
      return;
    }
    if (!textTool.activate(false)) return;
    selection.clear();
    tool = 'pen';
    setActive(options);
  }

  function syncSizePreview() {
    if (!sizeEl || !sizePreview) return;
    const sizeValue = Math.max(2, Math.min(22, Number(sizeEl.value) || 6));
    sizePreview.style.setProperty('--board-size-preview', `${sizeValue}px`);
    sizeEl.setAttribute('aria-valuetext', `${sizeValue}`);
    selection.updateStyle({ size: sizeValue });
    activatePenTool({ announce: true });
  }

  function setDrawingSelectionLock(isLocked: boolean) {
    document.documentElement.classList.toggle('board-is-drawing', isLocked);
    document.body.classList.toggle('board-is-drawing', isLocked);
  }

  function clearNativeSelection() {
    try {
      window.getSelection?.()?.removeAllRanges?.();
    } catch {
      // Ignore browser-specific selection cleanup failures.
    }
  }

  function syncHistoryButtons() {
    undoBtn.disabled = contentTool.isEditing()
      ? !contentTool.canUndo()
      : textTool.isEditing()
        ? !textTool.canUndo()
        : commandHistory.length === 0;
    redoBtn.disabled = contentTool.isEditing()
      ? !contentTool.canRedo()
      : textTool.isEditing()
        ? !textTool.canRedo()
        : redoHistory.length === 0;
  }

  function createBoardDrawingSnapshot(): BoardSnapshot {
    return {
      commands: commandHistory.map(cloneCommand),
      redoCommands: redoHistory.map(cloneCommand),
    };
  }

  function queueBoardPersistence() {
    boardStateRevision += 1;
    return saveBoardDrawing(createBoardDrawingSnapshot());
  }

  async function hydrateBoardDrawing() {
    const restoreRevision = boardStateRevision;
    const storedDrawing = await loadBoardDrawing();

    if (
      boardStateRevision !== restoreRevision ||
      drawing ||
      commandHistory.length > 0 ||
      redoHistory.length > 0
    ) {
      return;
    }

    const restoredCommands = storedDrawing.commands.map(cloneCommand);
    const restoredRedoCommands = storedDrawing.redoCommands.map(cloneCommand);

    if (restoredCommands.length === 0 && restoredRedoCommands.length === 0) {
      return;
    }

    commandHistory.push(...restoredCommands);
    redoHistory.push(...restoredRedoCommands);
    syncHistoryButtons();
    redrawCanvas();
  }

  function pushHistoryCommand(command: BoardCommand, { clearRedo = true } = {}) {
    const nextCommand = cloneCommand(command);
    commandHistory.push(nextCommand);
    if (clearRedo) {
      redoHistory.length = 0;
    }
    syncHistoryButtons();
  }

  // ---- Color utilities (contrast-safe ink) ----
  function clamp01(x: number) {
    return Math.max(0, Math.min(1, x));
  }

  function normalizeHex(hex: unknown): string | null {
    if (!hex) return null;
    let h = String(hex).trim();
    if (h[0] !== '#') h = '#' + h;
    // #rgb -> #rrggbb
    if (/^#([0-9a-fA-F]{3})$/.test(h)) {
      const m = h.slice(1);
      h =
        '#' +
        m
          .split('')
          .map((ch) => ch + ch)
          .join('');
    }
    if (!/^#([0-9a-fA-F]{6})$/.test(h)) return null;
    return h.toLowerCase();
  }

  function hexToRgb(hex: string): Rgb | null {
    const h = normalizeHex(hex);
    if (!h) return null;
    const n = parseInt(h.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex({ r, g, b }: Rgb): string {
    const to = (v: number) => v.toString(16).padStart(2, '0');
    return '#' + to(r) + to(g) + to(b);
  }

  function srgbToLin(c: number) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function relLuminance(rgb: Rgb) {
    const R = srgbToLin(rgb.r),
      G = srgbToLin(rgb.g),
      B = srgbToLin(rgb.b);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  function contrastRatio(hexA: string, hexB: string) {
    const a = hexToRgb(hexA),
      b = hexToRgb(hexB);
    if (!a || !b) return 1;
    const L1 = relLuminance(a);
    const L2 = relLuminance(b);
    const hi = Math.max(L1, L2);
    const lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  }

  function mixHex(hexA: string, hexB: string, t: number) {
    const a = hexToRgb(hexA),
      b = hexToRgb(hexB);
    if (!a || !b) return hexA;
    const tt = clamp01(t);
    const r = Math.round(a.r + (b.r - a.r) * tt);
    const g = Math.round(a.g + (b.g - a.g) * tt);
    const bb = Math.round(a.b + (b.b - a.b) * tt);
    return rgbToHex({ r, g, b: bb });
  }

  // Make sure ink stays readable on current canvas background.
  // Keeps the user's chosen hue as much as possible, nudging toward white/black only if needed.
  function ensureInkContrast(rawInkHex: string, background = currentCanvasBg()) {
    const bg = normalizeHex(background) || '#ffffff';
    const raw = normalizeHex(rawInkHex) || '#111827';

    const TARGET = 4.0; // practical readability for lines
    const cr = contrastRatio(raw, bg);
    if (cr >= TARGET) return raw;

    // Decide which direction improves contrast faster (toward white or toward black)
    const toWhite = mixHex(raw, '#ffffff', 0.65);
    const toBlack = mixHex(raw, '#000000', 0.65);
    const crW = contrastRatio(toWhite, bg);
    const crB = contrastRatio(toBlack, bg);
    const toward = crW >= crB ? '#ffffff' : '#000000';

    // Binary search a mix amount that hits target (or gets close)
    let lo = 0,
      hi = 1,
      best = raw;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const cand = mixHex(raw, toward, mid);
      const c = contrastRatio(cand, bg);
      if (c >= TARGET) {
        best = cand;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return best;
  }

  function setCssInk(hex: string) {
    document.documentElement.style.setProperty('--ink', hex);
  }

  let renderBackground = '';
  const inkCache = new Map<string, string>();
  function renderedInk(raw: string): string {
    let ink = inkCache.get(raw);
    if (!ink) {
      ink = ensureInkContrast(raw, renderBackground);
      inkCache.set(raw, ink);
    }
    return ink;
  }
  function applyCommandStyle(target: CanvasRenderingContext2D, command: StrokeCommand) {
    applyStrokeStyle(target, command, renderedInk);
  }
  function prepareHistorySurface() {
    historyCanvas.width = canvas.width;
    historyCanvas.height = canvas.height;
  }
  function copyHistorySurfaceToVisible() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = renderBackground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (viewport) applyViewport(ctx, viewport, boardSize(), canvasDpr);
    if (viewport)
      for (const object of getScene().content) {
        const shown = selection.displayContent(object);
        if (
          boundsIntersect(contentBounds(textContext, shown), visibleBounds(viewport, boardSize()))
        )
          drawContent(ctx, shown, {
            image: assets.image,
            background: renderBackground,
            ink: renderedInk,
          });
      }
    ctx.restore();
    ctx.drawImage(historyCanvas, 0, 0);
    ctx.restore();
  }
  function redrawCanvas() {
    if (redrawFrame !== null) {
      window.cancelAnimationFrame(redrawFrame);
      redrawFrame = null;
    }
    if (!viewport) return;
    assets.sync(
      getScene().content.filter((object) =>
        boundsIntersect(
          contentBounds(textContext, selection.displayContent(object)),
          visibleBounds(viewport!, boardSize())
        )
      )
    );
    const background = currentCanvasBg();
    if (background !== renderBackground) {
      renderBackground = background;
      inkCache.clear();
    }
    applyViewport(ctx, viewport, boardSize(), canvasDpr);
    renderInk(
      historyCtx,
      getScene().strokes.map(selection.displayStroke),
      viewport,
      boardSize(),
      canvasDpr,
      renderedInk
    );
    if (currentStroke?.tool === 'eraser') drawStroke(historyCtx, currentStroke, renderedInk);
    copyHistorySurfaceToVisible();
    if (currentStroke?.tool === 'pen') drawStroke(ctx, currentStroke, renderedInk);
    shapeTool.paint();
    textTool.paint();
    selection.paint();
  }

  function ensureIroPicker() {
    if (!iroPickerEl || iroPicker) return;

    try {
      iroPicker = iro.ColorPicker(iroPickerEl, {
        width: 260,
        color: inkRaw,
        layout: [
          { component: iro.ui.Box },
          { component: iro.ui.Slider, options: { sliderType: 'hue' } },
        ],
      });

      document.documentElement.classList.add('has-iro');

      // When user drags the picker: update inkRaw via your pipeline
      iroPicker.on('color:change', (c: iro.Color) => {
        const hex = normalizeHex(c?.hexString);
        if (!hex) return;

        syncingFromIro = true;
        try {
          setInkRaw(hex); // preserves your contrast enforcement + persistence
          // Keep hex input in sync while dragging
          if (hexInput) hexInput.value = hex;
        } finally {
          syncingFromIro = false;
        }
      });
    } catch {
      // If anything goes wrong, keep your fallback UI
      iroPicker = null;
      document.documentElement.classList.remove('has-iro');
    }
  }

  function syncIroFromInk() {
    if (!iroPicker || syncingFromIro) return;
    try {
      iroPicker.color.hexString = inkRaw;
    } catch {
      // Ignore invalid intermediate picker states while syncing.
    }
  }

  function syncColorTrigger() {
    if (!colorTriggerBtn) return;

    const raw = normalizeHex(inkRaw) || '#111827';
    colorTriggerBtn.title = `${t('moreColors')} (${raw})`;
    colorTriggerBtn.setAttribute('aria-label', `${t('moreColors')}. Current: ${raw}`);
  }

  function syncPenButtonColor() {
    if (!penBtn) return;
    const raw = normalizeHex(inkRaw) || '#111827';
    penBtn.style.setProperty('--board-pen-tip', raw);
  }

  // Presets tuned for a minimal look (different per theme)
  const PRESETS = [
    { id: 'graphite', light: '#111827', dark: '#e5e7eb' },
    { id: 'slate', light: '#334155', dark: '#cbd5e1' },
    { id: 'blue', light: '#2563eb', dark: '#60a5fa' },
    { id: 'green', light: '#10b981', dark: '#34d399' },
    { id: 'amber', light: '#f59e0b', dark: '#fbbf24' },
    { id: 'rose', light: '#e11d48', dark: '#fb7185' },
  ];

  function appliedInkFromRaw() {
    return ensureInkContrast(inkRaw);
  }

  function renderSwatches() {
    swatchesEl.innerHTML = '';
    const dark = isDarkMode();

    for (const p of PRESETS) {
      const hex = dark ? p.dark : p.light;

      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.setAttribute('aria-label', t(p.id));
      b.setAttribute('title', t(p.id));
      b.dataset.hex = hex;

      b.style.background = hex;

      b.addEventListener('click', () => {
        setInkRaw(hex);
        shapeTool.flushStyle();
      });

      swatchesEl.appendChild(b);
    }

    syncColorUI();
    syncColorTrigger();
  }

  function syncColorUI() {
    const raw = normalizeHex(inkRaw);

    [...swatchesEl.querySelectorAll<HTMLButtonElement>('button.swatch')].forEach((btn) => {
      const hx = normalizeHex(btn.dataset.hex);
      btn.classList.toggle('is-active', !!raw && hx === raw);
    });
  }

  function applyInk() {
    const applied = appliedInkFromRaw();
    setCssInk(applied);
    syncPenButtonColor();
    syncColorUI();
    syncColorTrigger();
  }

  function setInkRaw(hex: string) {
    const h = normalizeHex(hex);
    if (!h) return;
    inkRaw = h;
    saveText(LS_INK_RAW, inkRaw);
    selection.updateStyle({ inkRaw });
    activatePenTool({ announce: false });
    applyInk();

    // NEW: keep popup controls aligned
    setPopupFromInkRaw();
    syncIroFromInk();

    setStatus(t('colorUpdated'));
  }

  // Replay board coordinates at the current device pixel ratio.
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const changed =
      rect.width !== canvasCssWidth || rect.height !== canvasCssHeight || dpr !== canvasDpr;
    if (!changed) {
      textTool.reflow();
      shapeTool.paint();
      return;
    }
    navigation.cancel();
    canvasCssWidth = rect.width;
    canvasCssHeight = rect.height;
    canvasDpr = dpr;
    if (!viewport) {
      viewport = initialViewport(boardSize());
      queueViewportPersistence();
    }

    if (changed) {
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      textLayer.width = canvas.width;
      textLayer.height = canvas.height;
      shapeLayer.width = canvas.width;
      shapeLayer.height = canvas.height;
      prepareHistorySurface();
    }

    // Work in CSS pixels
    redrawCanvas();
    textTool.reflow();
    syncViewportControls();
  }

  function pos(ev: PointerEvent): Point {
    const r = canvas.getBoundingClientRect();
    return screenToWorld({ x: ev.clientX - r.left, y: ev.clientY - r.top }, viewport!, boardSize());
  }

  function start(ev: PointerEvent) {
    if (!boardReady) return;
    if (tool === 'select') {
      if (textTool.finish()) selection.start(ev);
      return;
    }
    if (tool === 'shapes') {
      shapeTool.start(ev);
      return;
    }
    if (tool !== 'pen' && tool !== 'eraser') return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (activePointerId !== null && ev.pointerId !== activePointerId) return;
    clearNativeSelection();
    if (redrawFrame !== null) redrawCanvas();
    drawing = true;
    activePointerId = ev.pointerId;
    setDrawingSelectionLock(true);
    last = pos(ev);
    currentStroke = {
      type: 'stroke',
      tool: 'eraser',
      size: parseInt(sizeEl.value || '6', 10),
      inkRaw,
      points: [clonePoint(last)],
    };
    if (tool === 'pen')
      currentStroke = {
        type: 'stroke',
        tool: 'pen',
        id: crypto.randomUUID(),
        size: currentStroke.size,
        inkRaw,
        points: currentStroke.points,
      };
    if (currentStroke.tool === 'eraser') {
      currentStroke.erasedTextIds = textTool.erase(last, last, currentStroke.size / 2);
      currentStroke.erasedShapeIds = shapeTool.erase(last, last, currentStroke.size / 2);
      drawStroke(historyCtx, currentStroke, renderedInk);
      copyHistorySurfaceToVisible();
      return;
    }
    applyCommandStyle(ctx, currentStroke);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
  }

  function move(ev: PointerEvent) {
    if (selection.isDragging()) {
      selection.move(ev);
      return;
    }
    if (tool === 'shapes') {
      shapeTool.move(ev);
      return;
    }
    if (activePointerId !== null && ev.pointerId !== activePointerId) return;
    if (!drawing || !currentStroke || !last) return;
    const p = pos(ev);
    currentStroke.points.push(clonePoint(p));
    if (currentStroke.tool === 'eraser') {
      currentStroke.erasedTextIds = [
        ...new Set([
          ...(currentStroke.erasedTextIds ?? []),
          ...textTool.erase(last, p, currentStroke.size / 2),
        ]),
      ];
      currentStroke.erasedShapeIds = [
        ...new Set([
          ...(currentStroke.erasedShapeIds ?? []),
          ...shapeTool.erase(last, p, currentStroke.size / 2),
        ]),
      ];
      drawStroke(historyCtx, currentStroke, renderedInk);
      copyHistorySurfaceToVisible();
      last = p;
      return;
    }
    applyCommandStyle(ctx, currentStroke);

    const mx = (last.x + p.x) / 2;
    const my = (last.y + p.y) / 2;
    ctx.quadraticCurveTo(last.x, last.y, mx, my);
    ctx.stroke();
    last = p;
  }

  function finishStroke({
    commit = true,
    ev = null,
  }: { commit?: boolean; ev?: PointerEvent | null } = {}) {
    if (!drawing) return false;
    if (activePointerId !== null && ev?.pointerId !== undefined && ev.pointerId !== activePointerId)
      return false;
    drawing = false;
    activePointerId = null;
    setDrawingSelectionLock(false);
    last = null;

    if (currentStroke) {
      if (commit) {
        pushHistoryCommand(currentStroke);
        queueBoardPersistence();
      }
      currentStroke = null;
      textTool.clearErasePreview();
      shapeTool.clearErasePreview();
      redrawCanvas();
    }
    return true;
  }

  function end(ev: PointerEvent) {
    if (selection.isDragging()) {
      selection.end(ev);
      return;
    }
    if (tool === 'shapes') {
      shapeTool.end(ev);
      return;
    }
    if (!drawing) return;
    if (!finishStroke({ commit: true, ev })) return;
    setStatus(t('draftUpdated'));
  }

  function clear() {
    if (!contentTool.finish() || !textTool.finish()) return;
    contentTool.closePicker();
    shapeTool.flushStyle();
    navigation.cancel();
    finishStroke({ commit: false });

    if (commandHistory.length === 0) {
      redoHistory.length = 0;
      redrawCanvas();
      syncHistoryButtons();
      queueBoardPersistence();
      setStatus(t('cleared'));
      return;
    }

    pushHistoryCommand({ type: 'clear' });
    redrawCanvas();
    queueBoardPersistence();
    setStatus(t('cleared'));
  }

  function undo() {
    shapeTool.flushStyle();
    if (contentTool.isEditing()) {
      contentTool.undo();
      return;
    }
    if (textTool.isEditing()) {
      textTool.undo();
      return;
    }
    navigation.cancel();
    if (!commandHistory.length) return;
    finishStroke({ commit: false });
    const command = commandHistory.pop();
    if (!command) return;
    redoHistory.push(command);
    redrawCanvas();
    syncHistoryButtons();
    queueBoardPersistence();
    setStatus(t('undo'));
  }

  function redo() {
    shapeTool.flushStyle();
    if (contentTool.isEditing()) {
      contentTool.redo();
      return;
    }
    if (textTool.isEditing()) {
      textTool.redo();
      return;
    }
    navigation.cancel();
    if (!redoHistory.length) return;
    finishStroke({ commit: false });
    const command = redoHistory.pop();
    if (!command) return;
    pushHistoryCommand(command, { clearRedo: false });
    redrawCanvas();
    queueBoardPersistence();
    setStatus(t('redo'));
  }

  function isEditableElement(element: EventTarget | null) {
    return (
      element instanceof Element &&
      Boolean(element.closest("input, textarea, [contenteditable='true']"))
    );
  }

  function preventSelectionWhileDrawing(event: Event) {
    if (!drawing || isEditableElement(event.target)) return;
    event.preventDefault();
    clearNativeSelection();
  }

  function dataUrlToBlob(dataUrl: string): Blob {
    const value = String(dataUrl || '');
    const parts = value.split(',', 2);
    if (parts.length !== 2) {
      throw new Error('Canvas export data URL is invalid.');
    }

    const mimeMatch = parts[0].match(/^data:([^;]+);base64$/i);
    const mimeType = mimeMatch?.[1] || 'application/octet-stream';
    const binary = window.atob(parts[1]);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  }

  function canvasToPngBlob(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      if (typeof sourceCanvas?.toBlob === 'function') {
        sourceCanvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(new Error('Could not prepare the drawing.'));
        }, 'image/png');
        return;
      }

      try {
        resolve(dataUrlToBlob(sourceCanvas.toDataURL('image/png')));
      } catch (error) {
        reject(error);
      }
    });
  }

  async function exportCanvasAsPng() {
    const scene = getScene();
    const exportAssets = createAssetCache(() => {});
    try {
      await exportAssets.prepare(scene.content);
      const exported = createDrawingCanvas(
        scene,
        boardSize(),
        currentCanvasBg(),
        renderedInk,
        exportAssets
      );
      return {
        fileBlob: await canvasToPngBlob(exported.canvas),
        fileName: 'drawing.png',
        reduced: exported.reduced,
      };
    } finally {
      exportAssets.clear();
    }
  }

  async function downloadDrawingAsPng() {
    if (!contentTool.finish() || !textTool.finish()) return;
    shapeTool.flushStyle();
    if (saveBusy) return;
    finishStroke({ commit: true });
    navigation.cancel();

    saveBusy = true;
    syncSaveButton();
    setStatus(t('preparingPng'));

    try {
      const exportedDrawing = await exportCanvasAsPng();
      const objectUrl = URL.createObjectURL(exportedDrawing.fileBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = objectUrl;
      downloadLink.download = t('drawingFilename') || exportedDrawing.fileName;
      downloadLink.rel = 'noopener';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus(t(exportedDrawing.reduced ? 'downloadedPngReduced' : 'downloadedPng'));
    } catch {
      setStatus(t('savePngFailed'));
    } finally {
      saveBusy = false;
      syncSaveButton();
    }
  }

  const navigation = createBoardNavigation({
    canvas,
    ready: () => boardReady,
    tool: () => tool,
    view: () => viewport ?? initialViewport(boardSize()),
    size: boardSize,
    change: changeViewport,
    locked: () => drawing || textTool.isDragging() || shapeTool.isBusy() || contentTool.isBusy(),
    beforeNavigate: () => {
      shapeTool.flushStyle();
      return textTool.finish();
    },
    start,
    move,
    end,
    cancelStroke: () => {
      finishStroke({ commit: false });
      shapeTool.cancel();
      selection.cancel();
    },
    textTap: (event) => {
      textTool.pointerDown(event);
    },
    fit: fitDrawing,
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('selectstart', (e) => e.preventDefault());
  canvas.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', preventSelectionWhileDrawing);

  function selectTool(next: BoardTool): boolean {
    if (!contentTool.finish() || !textTool.activate(next === 'text')) return false;
    contentTool.closePicker();
    finishStroke({ commit: true });
    navigation.cancel();
    shapeTool.activate(next === 'shapes');
    if (
      next !== 'select' &&
      !(next === 'shapes' && selection.current()?.kind === 'shape') &&
      !(next === 'text' && selection.current()?.kind === 'text')
    )
      selection.clear();
    tool = next;
    setActive();
    canvas.focus({ preventScroll: true });
    return true;
  }
  textBtn.addEventListener('click', () => {
    if (contentTool.isPickerOpen()) {
      contentTool.closePicker(true);
      return;
    }
    if (selectTool('select')) {
      shapeTool.activate(false);
      contentTool.togglePicker();
    }
  });
  shapesBtn.addEventListener('click', () => {
    selectTool('shapes');
    if (tool === 'shapes') shapeTool.togglePicker();
  });
  penBtn.addEventListener('click', () => selectTool('pen'));
  eraseBtn.addEventListener('click', () => selectTool('eraser'));
  handBtn.addEventListener('click', () => selectTool('hand'));
  selectBtn.addEventListener('click', () => selectTool('select'));
  function zoomFromControl(zoom: number) {
    if (
      !boardReady ||
      navigation.isBusy() ||
      drawing ||
      textTool.isDragging() ||
      shapeTool.isBusy() ||
      contentTool.isBusy() ||
      !textTool.finish() ||
      !viewport
    )
      return;
    shapeTool.flushStyle();
    changeViewport(
      zoomAt(viewport, zoom, { x: canvasCssWidth / 2, y: canvasCssHeight / 2 }, boardSize())
    );
  }
  zoomInBtn.addEventListener('click', () => zoomFromControl((viewport?.zoom ?? 1) * 1.25));
  zoomOutBtn.addEventListener('click', () => zoomFromControl((viewport?.zoom ?? 1) / 1.25));
  zoomResetBtn.addEventListener('click', () => zoomFromControl(1));
  fitBtn.addEventListener('click', () => {
    if (
      boardReady &&
      !navigation.isBusy() &&
      !drawing &&
      !textTool.isDragging() &&
      !shapeTool.isBusy() &&
      !contentTool.isBusy() &&
      textTool.finish()
    )
      fitDrawing();
  });
  undoBtn?.addEventListener('click', undo);
  redoBtn?.addEventListener('click', redo);

  sizeEl.addEventListener('input', syncSizePreview);
  sizeEl.addEventListener('change', () => shapeTool.flushStyle());
  hexInput.addEventListener('change', () => shapeTool.flushStyle());
  document.addEventListener('pointerup', () => shapeTool.flushStyle());
  colorPopup?.addEventListener('keyup', () => shapeTool.flushStyle());

  clearBtn.addEventListener('click', clear);
  saveBtn.addEventListener('click', () => {
    void downloadDrawingAsPng();
  });

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', () => {
      // recompute presets + apply ink contrast for new background
      renderSwatches();
      applyInk();
      redrawCanvas();
      textTool.reflow();
      setStatus(t('themeUpdated'));
    });
  }

  const screenLayout = observeScreenLayout(app, resize);
  window.addEventListener('pagehide', persistViewport);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persistViewport();
  });
  document.addEventListener('i18n:change', syncViewportControls);
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (contentTool.handleKey(event)) return;
    if (shapeTool.handleKey(event)) return;
    if (selection.handleKey(event)) return;
    if (navigation.handleKey(event)) return;
    if (textTool.handleKey(event)) return;
    if (isEditableElement(document.activeElement)) return;
    if (
      event.key.toLowerCase() === 'v' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.target === canvas ||
        (event.target instanceof Element &&
          Boolean(
            event.target.closest('.board-navigation, .object-selection-actions, .object-selection')
          )))
    ) {
      event.preventDefault();
      selectTool('select');
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;

    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }

    if (key === 'y') {
      event.preventDefault();
      redo();
    }
  });

  // Init
  syncSizePreview();
  syncHistoryButtons();
  syncSaveButton();
  setActive();

  renderSwatches();
  applyInk();

  screenLayout.update();
  setStatus(t('navigationHint'));
  void hydrateBoardDrawing().finally(() => {
    boardReady = true;
    textBtn.disabled = false;
    shapesBtn.disabled = false;
    selectBtn.disabled = false;
    if (textTool.recover()) {
      tool = 'text';
      setActive({ announce: false });
    }
  });
})();
