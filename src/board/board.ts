import '../styles/board.less';

import {
  initializeLibrary,
  createBoardSession,
  emptyBoard,
  MAX_PAGES,
  boardAssetIds,
  compactBoardHistory,
  compactStoredBoard,
  listBoards,
  pruneBoardAssets,
  updateBoardBackground,
} from './storage.ts';
import type { BoardDocument, BoardPage, BoardSession } from './storage.ts';
import { createPageNav } from './page-nav.ts';
import { createBoardMenu, boardFileName } from './board-menu.ts';
import type { Transfer } from './board-menu.ts';
import { writePdf } from './pdf-writer.ts';
import { createBoardLock } from './board-lock.ts';
import { createFullScreenButton } from './full-screen.ts';
import type { PdfPageImage } from './pdf-writer.ts';
import { cloneCommand, clonePoint, expandCommands } from './model.ts';
import { createTextTool } from './text-tool.ts';
import { createShapeTool } from './shape-tool.ts';
import { COLOR_PRESETS } from './presets.ts';
import { createFillPalette } from './fill-palette.ts';
import { createSelection } from './selection.ts';
import { createContentTool } from './content-tool.ts';
import { createAssetCache, discardAsset, readAsset, saveAsset } from './assets.ts';
import type { BoardAsset } from './assets.ts';
import {
  centerDelta,
  cloneItems,
  copyOffset,
  itemAssetIds,
  pasteDelta,
  placeCopies,
  withAssetIds,
} from './clipboard.ts';
import type { ClipItem } from './clipboard.ts';
import { IMAGE_TYPES } from './model.ts';
import { drawContent, contentBounds } from './content.ts';
import { renderInk } from './ink.ts';
import { createBoardNavigation } from './navigation.ts';
import { observeScreenLayout } from './screen-layout.ts';
import { createTypePicker, isKind } from './type-picker.ts';
import { createLaser } from './laser.ts';
import { registerOfflineSupport } from './offline.ts';
import {
  applyStrokeStyle,
  createBoardScene,
  createDrawingCanvas,
  drawStroke,
  drawStrokeSegment,
} from './scene-renderer.ts';
import type { BoardScene } from './scene-renderer.ts';
import {
  applyViewport,
  fitViewport,
  initialViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  boundsIntersect,
  visibleBounds,
  zoomAt,
} from './viewport.ts';
import type { BoardBounds, BoardViewport } from './viewport.ts';
import type {
  BoardCommand,
  BoardSnapshot,
  ImageObject,
  Point,
  StrokeCommand,
  BoardTool,
  PenKind,
  SelectMode,
} from './model.ts';
import type { Language } from '../i18n.ts';

import { applyButtonIcon } from '../shared/tools-menu.ts';
import { loadText, saveText } from '../shared/storage.ts';
import { contrastRatio, hexToRgb, mixHex, normalizeHex, rgbToHex } from './color.ts';
import {
  DEFAULT_BACKGROUND,
  isDarkColor,
  paintBackgroundPattern,
  resolveCanvasColor,
  SPACING,
} from './background.ts';
import type { BoardBackground } from './background.ts';
import { applyTheme, onThemeChange, storedTheme } from './theme.ts';
import type { ThemeChoice } from './theme.ts';
import iro from '@jaames/iro';
import { t, applyTranslations, toggleLang, getLang } from '../i18n.ts';
import {
  IconEraser,
  IconPen,
  IconRedo,
  IconUndo,
  IconText,
  IconHand,
  IconSelect,
  IconFit,
  ShapeIcons,
  IconBoard,
  PenIcons,
  SelectIcons,
  IconPlus,
  IconFolder,
  IconExport,
  IconExportAll,
  IconImport,
  IconImage,
  IconSettings,
  IconTrash,
  IconAddPage,
  IconInsertPdf,
  IconPdf,
  IconLock,
} from '../icons.ts';

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
// Apply translations and the chosen theme immediately
applyTranslations();
applyTheme(storedTheme());

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
applyButtonIcon(requireElement('boards', 'button'), IconBoard);
applyButtonIcon(requireElement('hand', 'button'), IconHand);
applyButtonIcon(requireElement('select', 'button'), IconSelect);
applyButtonIcon(requireElement('fitDrawing', 'button'), IconFit);
for (const [id, icon] of [
  ['newBoard', IconPlus],
  ['openBoards', IconFolder],
  ['addPage', IconAddPage],
  ['exportBoard', IconExport],
  ['exportAllBoards', IconExportAll],
  ['importBoards', IconImport],
  ['insertPdf', IconInsertPdf],
  ['save', IconImage],
  ['savePdf', IconPdf],
  ['boardSettings', IconSettings],
  ['lockBoard', IconLock],
  ['unlockBoard', IconLock],
  ['clear', IconTrash],
] as const)
  applyButtonIcon(document.getElementById(id), icon);

(function () {
  const canvas = requireElement('pad', 'canvas');
  const ctx = requireCanvasContext(canvas);
  const historyCanvas = document.createElement('canvas');
  const historyCtx = requireCanvasContext(historyCanvas);
  const statusEl = requireElement('status', 'span');

  const textLayer = requireElement('textLayer', 'canvas');
  const shapeLayer = requireElement('shapeLayer', 'canvas');
  const laserLayer = requireElement('laserLayer', 'canvas');
  const shapesBtn = requireElement('shapes', 'button');
  const textContext = requireCanvasContext(textLayer);
  const textBtn = requireElement('text', 'button');
  const penBtn = requireElement('pen', 'button');
  const eraseBtn = requireElement('erase', 'button');
  const undoBtn = requireElement('undo', 'button');
  const redoBtn = requireElement('redo', 'button');
  const sizeEl = requireElement('size', 'input');
  const sizePreview = requireElement('sizePreview', 'button');
  const boardsBtn = requireElement('boards', 'button');
  const clearBtn = requireElement('clear', 'button');
  const saveBtn = requireElement('save', 'button');
  const savePdfBtn = requireElement('savePdf', 'button');
  const handBtn = requireElement('hand', 'button');
  const selectBtn = requireElement('select', 'button');
  const zoomInBtn = requireElement('zoomIn', 'button');
  const zoomOutBtn = requireElement('zoomOut', 'button');
  const zoomResetBtn = requireElement('zoomReset', 'button');
  const fitBtn = requireElement('fitDrawing', 'button');
  const lockBtn = requireElement('lockBoard', 'button');
  createFullScreenButton(requireElement('fullScreen', 'button'));
  const lock = createBoardLock({
    root: document.documentElement,
    pill: requireElement('unlockBoard', 'button'),
    changed(locked) {
      pageNav.sync();
      if (locked) return;
      selectTool('pen');
      setStatus(t('boardUnlocked'));
    },
    hint: () => setStatus(t('holdToUnlock')),
  });
  /** False while the board is locked: only moving around and changing pages work. */
  const editable = () => !lock.isLocked();
  const app = document.querySelector<HTMLElement>('.app');
  if (!app) throw new Error('Missing board app');

  // NEW: color UI
  const swatchesEl = requireElement('swatches', 'div');

  const LS_INK_RAW = 'vatio_board_ink_raw';
  let saveBusy = false;

  // Page background of the open board; ink defaults and presets follow how dark the paper is.
  let boardBackground: BoardBackground = { ...DEFAULT_BACKGROUND };
  const canvasFrame = canvas.closest<HTMLElement>('.canvas-frame');
  function isDarkMode() {
    return isDarkColor(currentCanvasBg());
  }

  let inkRaw = normalizeHex(loadText(LS_INK_RAW)) || (isDarkMode() ? '#e5e7eb' : '#111827');

  // Pen types share the Pen button. Pen and Highlighter each remember their own color and
  // size; the laser has a fixed look and leaves the controls on the pen's values.
  type InkSlot = 'pen' | 'highlighter';
  const LS_PEN_KIND = 'zoni_board_pen_kind';
  const LS_SLOT_INK: Record<InkSlot, string> = {
    pen: LS_INK_RAW,
    highlighter: 'zoni_board_highlighter_ink_raw',
  };
  const LS_SLOT_SIZE: Record<InkSlot, string> = {
    pen: 'zoni_board_pen_size',
    highlighter: 'zoni_board_highlighter_size',
  };
  // The eraser shares the size slider but has its own, larger range and remembered size.
  type SizeRange = { min: number; max: number };
  const PEN_RANGE: SizeRange = { min: 2, max: 22 };
  const ERASER_RANGE: SizeRange = { min: 4, max: 80 };
  const LS_ERASER_SIZE = 'zoni_board_eraser_size';
  function storedSize(key: string, fallback: number, range = PEN_RANGE) {
    const value = Number(loadText(key));
    return Number.isFinite(value) && value >= range.min && value <= range.max ? value : fallback;
  }
  const inkSlots: Record<InkSlot, { inkRaw: string; size: number }> = {
    pen: { inkRaw, size: storedSize(LS_SLOT_SIZE.pen, Number(sizeEl.value) || 6) },
    highlighter: {
      inkRaw:
        normalizeHex(loadText(LS_SLOT_INK.highlighter)) || (isDarkMode() ? '#fbbf24' : '#f59e0b'),
      size: storedSize(LS_SLOT_SIZE.highlighter, 18),
    },
  };
  let eraserSize = storedSize(LS_ERASER_SIZE, 24, ERASER_RANGE);
  const storedPenKind = loadText(LS_PEN_KIND);
  const PEN_KINDS: PenKind[] = ['pen', 'highlighter', 'laser'];
  let penKind: PenKind = isKind(PEN_KINDS, storedPenKind) ? storedPenKind : 'pen';
  const LS_SELECT_MODE = 'zoni_board_select_mode';
  const storedSelectMode = loadText(LS_SELECT_MODE);
  let selectMode: SelectMode = isKind(['one', 'box', 'lasso'], storedSelectMode)
    ? storedSelectMode
    : 'one';
  const inkSlot = (): InkSlot => (penKind === 'highlighter' ? 'highlighter' : 'pen');
  inkRaw = inkSlots[inkSlot()].inkRaw;
  sizeEl.value = String(inkSlots[inkSlot()].size);
  function rememberInk() {
    inkSlots[inkSlot()].inkRaw = inkRaw;
    saveText(LS_SLOT_INK[inkSlot()], inkRaw);
  }
  /** The slider's value, kept inside its current range. */
  function sliderSize() {
    const min = Number(sizeEl.min) || PEN_RANGE.min,
      max = Number(sizeEl.max) || PEN_RANGE.max;
    return Math.max(min, Math.min(max, Number(sizeEl.value) || 6));
  }
  function showSize(size: number) {
    sizeEl.value = String(size);
    sizePreview.style.setProperty('--board-size-preview', `${size}px`);
    sizeEl.setAttribute('aria-valuetext', String(size));
  }
  /** Point the slider at the eraser's size while erasing, otherwise at the pen's. */
  let sliderOnEraser = false;
  function syncSizeControl() {
    const erasing = tool === 'eraser';
    sliderOnEraser = erasing;
    const range = erasing ? ERASER_RANGE : PEN_RANGE;
    sizeEl.min = String(range.min);
    sizeEl.max = String(range.max);
    showSize(erasing ? eraserSize : inkSlots[inkSlot()].size);
  }
  function rememberSize() {
    const size = sliderSize();
    if (tool === 'eraser') {
      eraserSize = size;
      saveText(LS_ERASER_SIZE, String(size));
      return;
    }
    inkSlots[inkSlot()].size = size;
    saveText(LS_SLOT_SIZE[inkSlot()], String(size));
  }

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
  const bootstrapBoard = emptyBoard(`${t('boardDefaultName')} 1`);
  let boardSession: BoardSession | null = null;
  let boardReady = false;
  let canvasCssWidth = 0;
  let canvasCssHeight = 0;
  let canvasDpr = 1;
  let viewport: BoardViewport | null = null;
  let viewportTimer: number | undefined;
  let viewportDirty = false;
  let redrawFrame: number | null = null;
  let scene: BoardScene | null = null;
  let sceneLength = -1;
  let sceneLast: BoardCommand | undefined;
  const commandHistory: BoardCommand[] = [];
  const redoHistory: BoardCommand[] = [];
  // The open page lives in commandHistory, redoHistory and viewport; its entry here is stale.
  let pages: BoardPage[] = [];
  let pageIndex = 0;
  const assets = createAssetCache(redrawCanvas);
  const fillPalette = createFillPalette({ dark: isDarkMode });
  const selection = createSelection({
    fillPalette,
    canvas,
    textContext,
    scene: getScene,
    view: () => viewport ?? initialViewport(boardSize()),
    tool: () => tool,
    mode: () => selectMode,
    editing: () => textTool.isEditing() || contentTool.isEditing() || Boolean(boardMenu?.isOpen()),
    hidden: () =>
      shapeTool.isBusy() ||
      shapeTool.isPickerOpen() ||
      contentTool.isPickerOpen() ||
      penPicker.isOpen() ||
      selectPicker.isOpen(),
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
      rememberInk();
      rememberSize();
      applyInk();
      setPopupFromInkRaw();
      syncIroFromInk();
    },
    status: setStatus,
    duplicate: duplicateSelection,
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
    fillPalette,
    gridStep: () =>
      boardBackground.pattern === 'grid' || boardBackground.pattern === 'dotted'
        ? SPACING[boardBackground.spacing]
        : null,
  });
  const laser = createLaser({
    layer: laserLayer,
    view: () => viewport ?? initialViewport(boardSize()),
    size: boardSize,
    dpr: () => canvasDpr,
  });
  let laserDrawing = false;
  const penPicker = createTypePicker({
    id: 'penPicker',
    button: penBtn,
    icons: PenIcons,
    kind: penKind,
    menuLabel: 'penTypes',
    label: (kind) => t(kind),
    buttonLabel: (kind) => t(kind),
    focusTarget: canvas,
    placement: 'below',
    choose: choosePenKind,
  });
  const SELECT_LABELS: Record<SelectMode, string> = {
    one: 'selectOne',
    box: 'boxSelect',
    lasso: 'lassoSelect',
  };
  const selectPicker = createTypePicker({
    id: 'selectPicker',
    button: selectBtn,
    icons: SelectIcons,
    kind: selectMode,
    menuLabel: 'selectModes',
    label: (mode) => t(SELECT_LABELS[mode]),
    // "Select" keeps its name in the default mode; other modes are named after themselves.
    buttonLabel: (mode) => t(mode === 'one' ? 'select' : SELECT_LABELS[mode]),
    focusTarget: canvas,
    placement: 'above',
    choose: chooseSelectMode,
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
    drafts() {
      const origin = boardSession!;
      return {
        load: () => origin.record.draft,
        save(draft) {
          origin.update({ draft: structuredClone(draft) });
          void origin.save();
        },
        clear(token) {
          if (origin.record.draft?.token === token) {
            origin.update({ draft: null });
            void origin.save();
          }
        },
      };
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
    ready: () => boardReady && !boardMenu?.isBusy() && editable(),
    boardId: () => boardSession!.record.id,
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
    insertPdf: (file) => void boardMenu.insertPdf(file),
    pasteObjects,
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
    if (viewport && viewportDirty && boardSession) {
      viewportDirty = false;
      boardSession.update({ viewport });
      void boardSession.save();
    }
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
    return resolveCanvasColor(boardBackground, cssVar('--canvas-bg'));
  }

  function setStatus(s: string) {
    statusEl.textContent = s;
  }

  function syncSaveButton() {
    if (!saveBtn) return;
    saveBtn.disabled = saveBusy;
    savePdfBtn.disabled = saveBusy;
  }

  function setActive(options: ToolOptions = {}) {
    const shouldAnnounce = options.announce !== false;
    // Only on the way into or out of the eraser, so Select keeps showing the selection's size.
    if ((tool === 'eraser') !== sliderOnEraser) syncSizeControl();
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
          ? t(
              selectMode === 'box'
                ? 'boxSelectHint'
                : selectMode === 'lasso'
                  ? 'lassoSelectHint'
                  : 'selectHint'
            )
          : tool === 'text'
            ? t('text')
            : tool === 'shapes'
              ? t('shapeHint')
              : tool === 'pen'
                ? penKind === 'laser'
                  ? t('laserHint')
                  : t(penKind)
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
    const sizeValue = sliderSize();
    sizePreview.style.setProperty('--board-size-preview', `${sizeValue}px`);
    sizeEl.setAttribute('aria-valuetext', `${sizeValue}`);
    if (tool === 'eraser') {
      // Resizing the eraser keeps the eraser.
      eraserSize = sizeValue;
      return;
    }
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

  /** The page list to save: a new array, so stored pages never change under the session. */
  function pagesState(): Pick<BoardDocument, 'pages' | 'pageIndex'> {
    return { pages: pages.slice(), pageIndex };
  }
  function currentDocument(): BoardDocument {
    return {
      ...(boardSession?.snapshot() ?? structuredClone(bootstrapBoard)),
      ...createBoardDrawingSnapshot(),
      viewport: viewport ? structuredClone(viewport) : null,
      ...(boardSession ? structuredClone(pagesState()) : {}),
    };
  }
  function storageFailure(error: unknown) {
    const code = error instanceof Error ? error.message : '';
    setStatus(t(code === 'boardConflict' || code === 'boardDeleted' ? code : 'boardSaveFailed'));
  }
  function queueBoardPersistence() {
    if (!boardSession) return Promise.resolve(false);
    boardSession.update({ ...createBoardDrawingSnapshot(), viewport, ...pagesState() });
    return boardSession.save();
  }
  function resetScene() {
    scene = null;
    sceneLength = -1;
    sceneLast = undefined;
  }
  function loadPage(page: Pick<BoardPage, 'commands' | 'redoCommands' | 'viewport'>) {
    commandHistory.splice(0, commandHistory.length, ...page.commands.map(cloneCommand));
    redoHistory.splice(0, redoHistory.length, ...page.redoCommands.map(cloneCommand));
    viewport = page.viewport ? structuredClone(page.viewport) : initialViewport(boardSize());
    resetScene();
  }
  /** Leaves the open page: finishes the active tool and keeps its drawing, history and view. */
  /** Finishes the active tool on the open page. False when a tool can't finish yet. */
  function finishPageTools() {
    if (!contentTool.finish() || !textTool.finish()) return false;
    contentTool.closePicker();
    shapeTool.flushStyle();
    shapeTool.cancel();
    selection.flushStyle();
    selection.cancel();
    selection.clear();
    navigation.cancel();
    finishStroke({ commit: false });
    window.clearTimeout(viewportTimer);
    viewportDirty = false;
    return true;
  }
  /** Stores the open page's drawing, history and view back into the page list. */
  function leavePage() {
    if (!finishPageTools()) return false;
    pages[pageIndex] = {
      id: pages[pageIndex].id,
      ...createBoardDrawingSnapshot(),
      viewport: viewport ? structuredClone(viewport) : null,
    };
    return true;
  }
  function enterPage(index: number, status = 'pageOf') {
    pageIndex = index;
    loadPage(pages[index]);
    syncHistoryButtons();
    syncViewportControls();
    redrawCanvas();
    pageNav.sync(pageIndex, pages.length);
    setStatus(t(status, { page: pageIndex + 1, count: pages.length }));
    void queueBoardPersistence();
  }
  function showPage(index: number) {
    if (!boardReady || index < 0 || index >= pages.length || index === pageIndex) return false;
    if (!leavePage()) return false;
    enterPage(index);
    return true;
  }
  /** Inserts pages after the open one and opens the first of them. False if they don't fit. */
  function insertPages(added: Omit<BoardPage, 'id'>[], status: string) {
    if (!boardReady || !added.length || pages.length + added.length > MAX_PAGES || !leavePage())
      return false;
    pages.splice(pageIndex + 1, 0, ...added.map((page) => ({ ...page, id: crypto.randomUUID() })));
    enterPage(pageIndex + 1, status);
    canvas.focus({ preventScroll: true });
    return true;
  }
  function insertPage(page: Omit<BoardPage, 'id'>, status: string) {
    insertPages([page], status);
  }
  let pdfModule: Promise<typeof import('./pdf-import.ts')> | undefined;
  const pdfImport = () =>
    (pdfModule ??= import('./pdf-import.ts').catch((error) => {
      pdfModule = undefined;
      throw error;
    }));
  /**
   * Board menu → Insert PDF, or a PDF dropped on the board: each PDF page becomes a board page
   * after the open one, holding the page as an image to write on. The menu keeps its progress
   * panel open meanwhile, which also holds off the media clean-up.
   */
  async function insertPdf(file: File, transfer: Transfer) {
    if (!boardReady || !boardSession) return;
    const room = MAX_PAGES - pages.length;
    if (room <= 0) {
      setStatus(t('boardFull', { max: MAX_PAGES }));
      return;
    }
    const boardId = boardSession.record.id;
    const { readPdfPages } = await pdfImport();
    const read = await readPdfPages(file, {
      signal: transfer.signal,
      maxPages: room,
      progress(done, count) {
        transfer.progress(done, count);
        if (done < count) setStatus(t('importingPdfPage', { page: done + 1, count }));
      },
    });
    if (!read.pages.length) throw new Error('pdfUnreadable');
    const saved: string[] = [];
    try {
      for (const image of read.pages) {
        if (transfer.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        saved.push(await saveAsset(boardId, image));
      }
      if (transfer.signal.aborted || boardSession?.record.id !== boardId)
        throw new DOMException('Cancelled', 'AbortError');
      const title = file.name.slice(0, 480);
      const added = read.pages.map((image, index): Omit<BoardPage, 'id'> => {
        // Two pixels per board unit keep the page sharp when zoomed in.
        const width = image.width / 2,
          height = image.height / 2;
        const object: ImageObject = {
          id: crypto.randomUUID(),
          kind: 'image',
          assetId: saved[index],
          position: { x: 0, y: 0 },
          width,
          height,
          title: read.pages.length > 1 ? `${title} · ${index + 1}` : title,
        };
        return {
          commands: [{ type: 'content-set', object }],
          redoCommands: [],
          viewport: fitViewport({ x: 0, y: 0, width, height }, boardSize()),
        };
      });
      if (!insertPages(added, 'pageOf')) throw new Error('boardOperationFailed');
    } catch (error) {
      await Promise.all(saved.map((id) => discardAsset(id).catch(() => {})));
      throw error;
    }
    const count = read.pages.length;
    setStatus(
      count < read.total
        ? t('pdfInsertedPartly', { count, total: read.total, max: MAX_PAGES })
        : t(count === 1 ? 'pdfInsertedOne' : 'pdfInserted', { count })
    );
  }
  function addPage() {
    insertPage({ commands: [], redoCommands: [], viewport: null }, 'pageOf');
  }
  /** The copy keeps the drawing, undo history and view; object ids only need to be unique per page. */
  function duplicatePage() {
    if (!boardReady || !leavePage()) return;
    // insertPage gives the copy a new id.
    insertPage(structuredClone(pages[pageIndex]), 'pageDuplicated');
  }
  /**
   * Copied objects stay in this tab, so they paste on any page or board. `pastes` counts the
   * copies placed so far, for the cascade; Cut starts one lower so its first paste lands in place.
   */
  let clip: {
    items: ClipItem[];
    bounds: BoardBounds;
    boardId: string;
    pageId: string;
    pastes: number;
    /** When it was copied, so the copy event right after can mark the system clipboard. */
    at: number;
    /** Media read when cutting, in case the original is gone by the time it is pasted. */
    assets: Map<string, Promise<BoardAsset | null>>;
    /** Media already stored on other boards, by board id. */
    copied: Map<string, Map<string, string>>;
  } | null = null;
  let pasting = false,
    pasteFallback: number | undefined;
  const canCopy = () => boardReady && editable() && !boardMenu?.isWorking();
  /** Adds the copies in one undo step and selects them. */
  function placeItems(items: ClipItem[], delta: Point) {
    const { commands, refs } = placeCopies(items, delta);
    if (!commands.length) return 0;
    pushHistoryCommand(commands.length > 1 ? { type: 'batch', commands } : commands[0]);
    redrawCanvas();
    void queueBoardPersistence();
    // The Shapes tool selects its own shapes; anything else shows with Select.
    if (tool !== 'select' && !(tool === 'shapes' && refs.length === 1 && refs[0].kind === 'shape'))
      selectTool('select');
    selection.selectAll(refs);
    return refs.length;
  }
  function duplicateSelection() {
    if (!canCopy()) return;
    const snapshot = selection.snapshot();
    if (!snapshot) return;
    const offset = copyOffset(snapshot.items);
    const count = placeItems(snapshot.items, { x: offset, y: offset });
    setStatus(count === 1 ? t('objectDuplicated') : t('objectsDuplicated', { count }));
  }
  function copySelection(cut: boolean) {
    if (!canCopy() || !boardSession) return false;
    const snapshot = selection.snapshot();
    if (!snapshot) return false;
    const items = cloneItems(snapshot.items);
    clip = {
      items,
      bounds: snapshot.bounds,
      boardId: boardSession.record.id,
      pageId: pages[pageIndex].id,
      pastes: cut ? -1 : 0,
      at: performance.now(),
      assets: new Map(cut ? itemAssetIds(items).map((id) => [id, readAsset(id)]) : []),
      copied: new Map(),
    };
    if (cut) selection.removeSelected();
    const count = items.length;
    setStatus(
      count === 1
        ? t(cut ? 'objectCut' : 'objectCopied')
        : t(cut ? 'objectsCut' : 'objectsCopied', { count })
    );
    return true;
  }
  /** Media lives with its board: pasting into another board stores its own copy first. */
  async function assetsFor(current: NonNullable<typeof clip>, boardId: string) {
    const ids = itemAssetIds(current.items);
    if (current.boardId === boardId || !ids.length) return current.items;
    const stored = current.copied.get(boardId) ?? new Map<string, string>();
    for (const id of ids) {
      if (stored.has(id)) continue;
      const asset = await (current.assets.get(id) ?? readAsset(id));
      if (!asset) throw new Error('missing');
      stored.set(id, await saveAsset(boardId, asset));
    }
    current.copied.set(boardId, stored);
    return withAssetIds(current.items, stored);
  }
  async function pasteClip() {
    window.clearTimeout(pasteFallback);
    pasteFallback = undefined;
    const current = clip;
    if (!current || pasting || !canCopy() || !boardSession) return;
    const session = boardSession,
      boardId = session.record.id,
      pageId = pages[pageIndex].id;
    pasting = true;
    try {
      let items: ClipItem[];
      try {
        items = await assetsFor(current, boardId);
      } catch {
        setStatus(t('pasteFailed'));
        return;
      }
      if (session !== boardSession || pageId !== pages[pageIndex].id || !canCopy()) return;
      const size = boardSize();
      const visible = visibleBounds(viewport ?? initialViewport(size), size);
      // Same page: next to the last copy while it is in view; elsewhere, centred in the view.
      const delta =
        current.boardId === boardId && current.pageId === pageId
          ? pasteDelta(items, current.bounds, visible, current.pastes + 1)
          : centerDelta(items, current.bounds, visible);
      current.pastes++;
      const count = placeItems(items, delta);
      setStatus(count === 1 ? t('objectPasted') : t('objectsPasted', { count }));
    } finally {
      pasting = false;
    }
  }
  /** The board's paste event: board objects, unless the clipboard holds a newer image. */
  function pasteObjects(data: DataTransfer | null) {
    window.clearTimeout(pasteFallback);
    pasteFallback = undefined;
    if (!clip) return false;
    if (Array.from(data?.files ?? []).some((file) => IMAGE_TYPES.includes(file.type))) return false;
    void pasteClip();
    return true;
  }
  function movePage(delta: -1 | 1) {
    const target = pageIndex + delta;
    if (!boardReady || target < 0 || target >= pages.length || !leavePage()) return;
    [pages[pageIndex], pages[target]] = [pages[target], pages[pageIndex]];
    pageIndex = target;
    pageNav.sync(pageIndex, pages.length);
    setStatus(t('pageMoved', { page: pageIndex + 1 }));
    void queueBoardPersistence();
  }
  function removeOpenPage() {
    if (!boardReady || pages.length <= 1 || !finishPageTools()) return;
    pages.splice(pageIndex, 1);
    enterPage(Math.min(pageIndex, pages.length - 1), 'pageDeleted');
    canvas.focus({ preventScroll: true });
    scheduleAssetCleanup();
  }
  let cleanupTimer: number | undefined;
  /**
   * Deletes the open board's media that no page's history refers to anymore. It runs a moment
   * after the change and never during a media insert. It never saves the board itself, so it
   * can't cause a save, or a save error, of its own.
   */
  function scheduleAssetCleanup(delay = 2000) {
    window.clearTimeout(cleanupTimer);
    cleanupTimer = window.setTimeout(() => void cleanUpAssets(), delay);
  }
  async function cleanUpAssets() {
    if (
      !boardReady ||
      !boardSession ||
      pasting ||
      contentTool.isEditing() ||
      boardMenu.isWorking()
    ) {
      if (boardSession) scheduleAssetCleanup();
      return;
    }
    const session = boardSession;
    // Wait for a save in progress, but don't start one.
    await session.flush();
    if (session !== boardSession || contentTool.isEditing() || boardMenu.isWorking()) return;
    // Media the saved board or this tab's unsaved state still uses are both kept.
    await pruneBoardAssets(session.record.id, boardAssetIds(currentDocument())).catch(() => 0);
  }
  /**
   * Settings → Storage → Free up space: drops the history before each page's last Clear and the
   * redo stacks on every board, then deletes the media nothing uses. Returns the bytes freed,
   * or null when the browser can't estimate storage.
   */
  async function freeUpSpace(): Promise<number | null> {
    if (!boardReady || !boardSession || !(await prepareBoard(true))) throw new Error('busy');
    const estimate = async () =>
      navigator.storage?.estimate
        ? ((await navigator.storage.estimate().catch(() => null))?.usage ?? null)
        : null;
    const before = await estimate();
    const open = compactBoardHistory({ commands: commandHistory, redoCommands: redoHistory });
    if (open) {
      commandHistory.splice(0, commandHistory.length, ...open.commands);
      redoHistory.length = 0;
    }
    pages = pages.map((page, index) =>
      index === pageIndex ? page : (compactBoardHistory(page) ?? page)
    );
    resetScene();
    syncHistoryButtons();
    redrawCanvas();
    const session = boardSession;
    if (!(await queueBoardPersistence()) || !(await session.flush())) throw new Error('save');
    await pruneBoardAssets(session.record.id);
    for (const board of await listBoards())
      if (board.id !== session.record.id) await compactStoredBoard(board.id);
    const after = await estimate();
    return before === null || after === null ? null : Math.max(0, before - after);
  }
  /** Deletes the open page; asks first when it has drawing or undo history. */
  function deletePage() {
    if (!boardReady || pages.length <= 1) return;
    if (!commandHistory.length && !redoHistory.length) {
      removeOpenPage();
      return;
    }
    boardMenu.confirm({
      title: 'deletePage',
      question: t('deletePageQuestion', { page: pageIndex + 1 }),
      action: 'deletePage',
      returnFocus: canvas,
      run() {
        boardMenu.dismissPanel();
        removeOpenPage();
      },
    });
  }
  async function activateBoard(board: BoardDocument) {
    boardReady = false;
    window.clearTimeout(viewportTimer);
    viewportDirty = false;
    navigation.cancel();
    contentTool.cancel();
    contentTool.closePicker();
    textTool.reset();
    shapeTool.activate(false);
    selection.clear();
    boardSession = createBoardSession(board, (error) => {
      if (boardSession?.record.id === board.id) storageFailure(error);
    });
    pages = structuredClone(board.pages);
    pageIndex = board.pageIndex;
    loadPage(board);
    boardBackground = { ...board.background };
    canvasFrame?.style.setProperty('--board-canvas-bg', currentCanvasBg());
    renderSwatches();
    applyInk();
    assets.clear();
    tool = editable() ? 'pen' : 'hand';
    if (!board.viewport) await queueBoardPersistence();
    boardReady = true;
    textBtn.disabled = shapesBtn.disabled = selectBtn.disabled = boardsBtn.disabled = false;
    syncHistoryButtons();
    syncViewportControls();
    setActive({ announce: false });
    redrawCanvas();
    pageNav.sync(pageIndex, pages.length);
    boardMenu?.labels();
    setStatus(t('ready'));
    if (textTool.recover()) {
      tool = 'text';
      setActive({ announce: false });
    }
    canvas.focus({ preventScroll: true });
    // Media left behind by earlier versions or by an interrupted session.
    scheduleAssetCleanup();
  }
  async function prepareBoard(requireSave: boolean): Promise<boolean> {
    if (!contentTool.finish() || !textTool.finish()) return false;
    shapeTool.flushStyle();
    navigation.cancel();
    finishStroke({ commit: false });
    persistViewport();
    const saved = await queueBoardPersistence();
    const flushed = await boardSession!.flush();
    return !requireSave || (saved && flushed);
  }
  const boardMenu = createBoardMenu({
    button: boardsBtn,
    menu: requireElement('boardMenu', 'div'),
    current: currentDocument,
    prepare: prepareBoard,
    activate: activateBoard,
    renamed(name) {
      if (boardSession) boardSession.record.name = name;
    },
    beforeMenu() {
      if (!contentTool.finish() || !textTool.finish()) return false;
      contentTool.closePicker();
      shapeTool.activate(false);
      navigation.cancel();
      tool = 'pen';
      textTool.activate(false);
      setActive({ announce: false });
      return true;
    },
    status: setStatus,
    background: () => ({ ...boardBackground }),
    setBackground(next) {
      void setBackground(next);
    },
    theme: storedTheme,
    setTheme: (choice) => setTheme(choice),
    addPage,
    insertPdf,
    freeUpSpace,
  });
  const pageNav = createPageNav({
    nav: requireElement('pageNav', 'nav'),
    go: (index) => showPage(index),
    add: addPage,
    duplicate: duplicatePage,
    move: movePage,
    remove: deletePage,
    editable,
  });

  function pushHistoryCommand(command: BoardCommand, { clearRedo = true } = {}) {
    if (!editable()) return;
    const nextCommand = cloneCommand(command);
    commandHistory.push(nextCommand);
    if (clearRedo) dropRedo();
    syncHistoryButtons();
  }
  /** New drawing replaces the redo stack; media only it used can then be deleted. */
  function dropRedo() {
    if (!redoHistory.length) return;
    const hadMedia = [...expandCommands(redoHistory)].some((c) => c.type === 'content-set');
    redoHistory.length = 0;
    if (hadMedia) scheduleAssetCleanup();
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
    if (viewport) {
      applyViewport(ctx, viewport, boardSize(), canvasDpr);
      paintBackgroundPattern(ctx, boardBackground, viewport, boardSize(), renderBackground);
    }
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
    laser.paint();
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
  const PRESETS = COLOR_PRESETS;

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
    const applied = penKind === 'highlighter' ? inkRaw : appliedInkFromRaw();
    setCssInk(applied);
    syncPenButtonColor();
    syncColorUI();
    syncColorTrigger();
  }

  function setInkRaw(hex: string) {
    const h = normalizeHex(hex);
    if (!h) return;
    inkRaw = h;
    rememberInk();
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
      laserLayer.width = canvas.width;
      laserLayer.height = canvas.height;
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

  /**
   * A stylus's pressure (0–1), smoothed against the previous value so the width doesn't
   * jitter. Null for mouse and touch, and for a stylus that reports no pressure.
   */
  function stylusPressure(ev: PointerEvent, previous: number | null): number | null {
    if (ev.pointerType !== 'pen' || !(ev.pressure > 0)) return null;
    const value = previous === null ? ev.pressure : previous * 0.6 + ev.pressure * 0.4;
    return Math.round(Math.min(1, value) * 100) / 100;
  }

  function start(ev: PointerEvent) {
    if (!boardReady || !editable()) return;
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
    if (tool === 'pen' && penKind === 'laser') {
      laserDrawing = true;
      laser.start(last);
      return;
    }
    currentStroke = {
      type: 'stroke',
      tool: 'eraser',
      size: eraserSize,
      inkRaw,
      points: [clonePoint(last)],
    };
    const pressure = stylusPressure(ev, null);
    if (tool === 'pen')
      currentStroke = {
        type: 'stroke',
        tool: 'pen',
        id: crypto.randomUUID(),
        size: parseInt(sizeEl.value || '6', 10),
        inkRaw,
        points: currentStroke.points,
        ...(penKind === 'highlighter'
          ? { pen: 'highlighter' as const }
          : pressure !== null
            ? { pressure: [pressure] }
            : {}),
      };
    if (currentStroke.tool === 'eraser') {
      currentStroke.erasedTextIds = textTool.erase(last, last, currentStroke.size / 2);
      currentStroke.erasedShapeIds = shapeTool.erase(last, last, currentStroke.size / 2);
      drawStroke(historyCtx, currentStroke, renderedInk);
      copyHistorySurfaceToVisible();
      return;
    }
    if (currentStroke.pen === 'highlighter') {
      drawStroke(ctx, currentStroke, renderedInk);
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
    if (drawing && laserDrawing) {
      laser.move(pos(ev));
      return;
    }
    if (!drawing || !currentStroke || !last) return;
    const p = pos(ev);
    currentStroke.points.push(clonePoint(p));
    if (currentStroke.tool === 'pen' && currentStroke.pressure) {
      const pressure = currentStroke.pressure;
      pressure.push(
        stylusPressure(ev, pressure[pressure.length - 1]) ?? pressure[pressure.length - 1]
      );
      drawStrokeSegment(
        ctx,
        currentStroke as typeof currentStroke & { pressure: number[] },
        currentStroke.points.length - 1,
        renderedInk
      );
      last = p;
      return;
    }
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
    if (currentStroke.pen === 'highlighter') {
      // Repaint the whole stroke: re-stroking a growing path would darken a see-through line.
      copyHistorySurfaceToVisible();
      drawStroke(ctx, currentStroke, renderedInk);
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
    if (laserDrawing) {
      laserDrawing = false;
      if (commit) laser.end();
      else laser.cancel();
      return true;
    }

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
    const wasLaser = laserDrawing;
    if (!finishStroke({ commit: true, ev })) return;
    if (!wasLaser) setStatus(t('draftUpdated'));
  }

  function clear() {
    if (!editable() || !contentTool.finish() || !textTool.finish()) return;
    contentTool.closePicker();
    shapeTool.flushStyle();
    navigation.cancel();
    finishStroke({ commit: false });

    if (commandHistory.length === 0) {
      dropRedo();
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
    if (!editable()) return;
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
    if (!editable()) return;
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

  function canvasToBlob(
    sourceCanvas: HTMLCanvasElement,
    type = 'image/png',
    quality?: number
  ): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      if (typeof sourceCanvas?.toBlob === 'function') {
        sourceCanvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
              return;
            }

            reject(new Error('Could not prepare the drawing.'));
          },
          type,
          quality
        );
        return;
      }

      try {
        resolve(dataUrlToBlob(sourceCanvas.toDataURL(type, quality)));
      } catch (error) {
        reject(error);
      }
    });
  }

  async function exportCanvasAsPng() {
    const scene = getScene();
    const name = boardSession?.record.name ?? t('boardDefaultName');
    const fileName = boardFileName(
      pages.length > 1 ? `${name} - ${t('pageFile', { page: pageIndex + 1 })}` : name,
      'png'
    );
    const exportAssets = createAssetCache(() => {});
    try {
      await exportAssets.prepare(scene.content);
      const exported = createDrawingCanvas(
        scene,
        boardSize(),
        currentCanvasBg(),
        renderedInk,
        exportAssets,
        boardBackground
      );
      return {
        fileBlob: await canvasToBlob(exported.canvas),
        fileName,
        reduced: exported.reduced,
      };
    } finally {
      exportAssets.clear();
    }
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = fileName;
    downloadLink.rel = 'noopener';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
  }

  /** Board menu → Save PDF: one PDF page per board page, each drawn like Save PNG. */
  async function downloadBoardAsPdf() {
    if (!contentTool.finish() || !textTool.finish()) return;
    shapeTool.flushStyle();
    if (saveBusy) return;
    finishStroke({ commit: true });
    navigation.cancel();

    saveBusy = true;
    syncSaveButton();
    const count = pages.length;
    try {
      const images: PdfPageImage[] = [];
      let reduced = false;
      for (let index = 0; index < count; index++) {
        setStatus(t('preparingPdf', { page: index + 1, count }));
        const scene =
          index === pageIndex ? getScene() : createBoardScene(pages[index].commands, textContext);
        const media = createAssetCache(() => {});
        try {
          await media.prepare(scene.content);
          const out = createDrawingCanvas(
            scene,
            boardSize(),
            currentCanvasBg(),
            renderedInk,
            media,
            boardBackground,
            { pixelRatio: 2 }
          );
          reduced ||= out.reduced;
          const jpeg = await canvasToBlob(out.canvas, 'image/jpeg', 0.9);
          images.push({
            jpeg: new Uint8Array(await jpeg.arrayBuffer()),
            width: out.canvas.width,
            height: out.canvas.height,
            // 96 board units per inch, so a page prints at the size it is drawn.
            pageWidth: out.area.width * 0.75,
            pageHeight: out.area.height * 0.75,
          });
          out.canvas.width = out.canvas.height = 0;
        } finally {
          media.clear();
        }
      }
      const name = boardSession?.record.name ?? t('boardDefaultName');
      downloadBlob(writePdf(images), boardFileName(name, 'pdf'));
      setStatus(t(reduced ? 'downloadedPdfReduced' : 'downloadedPdf'));
    } catch {
      setStatus(t('savePdfFailed'));
    } finally {
      saveBusy = false;
      syncSaveButton();
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
      downloadBlob(exportedDrawing.fileBlob, exportedDrawing.fileName);
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
    ready: () => boardReady && !boardMenu?.isBusy(),
    tool: () => tool,
    view: () => viewport ?? initialViewport(boardSize()),
    size: boardSize,
    change: changeViewport,
    locked: () =>
      drawing ||
      textTool.isDragging() ||
      shapeTool.isBusy() ||
      contentTool.isBusy() ||
      boardMenu.isBusy(),
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
    if (next !== 'hand' && !editable()) return false;
    if (boardMenu?.isWorking() || !contentTool.finish() || !textTool.activate(next === 'text'))
      return false;
    boardMenu?.dismiss();
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
  penBtn.addEventListener('click', () => {
    if (penPicker.isOpen()) {
      penPicker.close();
      return;
    }
    // First tap selects the pen; tapping the active pen opens its types, like Shapes.
    const wasPen = tool === 'pen';
    if (selectTool('pen') && wasPen) penPicker.toggle();
  });
  function choosePenKind(next: PenKind) {
    if (!selectTool('pen')) return;
    penKind = next;
    saveText(LS_PEN_KIND, penKind);
    penPicker.setKind(penKind);
    const slot = inkSlots[inkSlot()];
    syncSizeControl();
    inkRaw = slot.inkRaw;
    applyInk();
    setPopupFromInkRaw();
    syncIroFromInk();
    setActive();
  }
  eraseBtn.addEventListener('click', () => selectTool('eraser'));
  handBtn.addEventListener('click', () => selectTool('hand'));
  selectBtn.addEventListener('click', () => {
    if (selectPicker.isOpen()) {
      selectPicker.close();
      return;
    }
    // First tap selects; tapping the active Select opens its modes, like Pen.
    const wasSelect = tool === 'select';
    if (selectTool('select') && wasSelect) selectPicker.toggle();
  });
  function chooseSelectMode(next: SelectMode) {
    if (!selectTool('select')) return;
    selectMode = next;
    saveText(LS_SELECT_MODE, selectMode);
    selectPicker.setKind(selectMode);
    setActive();
  }
  function zoomFromControl(zoom: number) {
    if (
      !boardReady ||
      navigation.isBusy() ||
      drawing ||
      textTool.isDragging() ||
      shapeTool.isBusy() ||
      contentTool.isBusy() ||
      boardMenu.isBusy() ||
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
      !boardMenu.isBusy() &&
      textTool.finish()
    )
      fitDrawing();
  });
  undoBtn?.addEventListener('click', undo);
  redoBtn?.addEventListener('click', redo);

  sizeEl.addEventListener('input', syncSizePreview);
  sizeEl.addEventListener('change', () => {
    rememberSize();
    shapeTool.flushStyle();
  });
  hexInput.addEventListener('change', () => shapeTool.flushStyle());
  document.addEventListener('pointerup', () => shapeTool.flushStyle());
  colorPopup?.addEventListener('keyup', () => shapeTool.flushStyle());

  clearBtn.addEventListener('click', clear);
  /**
   * Board menu → Lock board: only moving around, zoom, page arrows and full screen keep working
   * until the Locked pill is held.
   */
  function lockBoard() {
    if (!boardReady || !editable() || !selectTool('hand')) return;
    lock.lock();
    pageNav.close(false);
    setStatus(t('boardLocked'));
  }
  lockBtn.addEventListener('click', lockBoard);
  saveBtn.addEventListener('click', () => {
    void downloadDrawingAsPng();
  });
  savePdfBtn.addEventListener('click', () => {
    void downloadBoardAsPdf();
  });

  // Theme or paper changes: recompute presets, ink contrast and the canvas.
  function refreshAppearance() {
    canvasFrame?.style.setProperty('--board-canvas-bg', currentCanvasBg());
    renderSwatches();
    applyInk();
    redrawCanvas();
    textTool.reflow();
  }
  onThemeChange(() => {
    refreshAppearance();
    setStatus(t('themeUpdated'));
  });
  async function setBackground(next: BoardBackground) {
    const board = boardSession?.record;
    boardBackground = { ...next };
    if (board) board.background = { ...next };
    refreshAppearance();
    if (!board || !boardReady) return;
    try {
      await updateBoardBackground(board.id, next);
    } catch (error) {
      storageFailure(error);
    }
  }
  function setTheme(choice: ThemeChoice) {
    applyTheme(choice, { persist: true });
  }

  const screenLayout = observeScreenLayout(app, resize);
  window.addEventListener('pagehide', persistViewport);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persistViewport();
  });
  document.addEventListener('i18n:change', syncViewportControls);
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (boardMenu.handleKey(event)) return;
    if (pageNav.handleKey(event)) return;
    if (penPicker.handleKey(event)) return;
    if (selectPicker.handleKey(event)) return;
    if (contentTool.handleKey(event)) return;
    if (shapeTool.handleKey(event)) return;
    if (editable() && selection.handleKey(event)) return;
    if (navigation.handleKey(event)) return;
    if (textTool.handleKey(event)) return;
    if (isEditableElement(document.activeElement)) return;
    if (
      (event.key === 'PageUp' || event.key === 'PageDown') &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      pages.length > 1
    ) {
      event.preventDefault();
      showPage(pageIndex + (event.key === 'PageDown' ? 1 : -1));
      return;
    }
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
      return;
    }
    if (event.altKey || event.shiftKey) return;
    if (key === 'd' && selection.count()) {
      // Also keeps the browser's bookmark dialog away.
      event.preventDefault();
      duplicateSelection();
    } else if ((key === 'c' || key === 'x') && selection.count()) {
      // Not prevented: the copy event that follows marks the system clipboard as ours.
      copySelection(key === 'x');
    } else if (key === 'v' && clip && canCopy()) {
      // The paste event normally handles it (and images from other apps); some browsers send
      // none without a text field, so paste anyway if it hasn't come.
      window.clearTimeout(pasteFallback);
      pasteFallback = window.setTimeout(() => void pasteClip(), 150);
    }
  });
  // A copy made here replaces what the system clipboard held, so an older image doesn't win.
  for (const type of ['copy', 'cut'] as const)
    document.addEventListener(type, (event) => {
      if (!clip || performance.now() - clip.at > 1000 || !event.clipboardData) return;
      if (isEditableElement(document.activeElement)) return;
      event.clipboardData.setData('application/x-zoni-board', '1');
      event.preventDefault();
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
  registerOfflineSupport();
  void initializeLibrary(t('boardDefaultName'))
    .then(activateBoard)
    .catch(async () => {
      await activateBoard(bootstrapBoard);
      setStatus(t('storageUnavailable'));
    });
})();
