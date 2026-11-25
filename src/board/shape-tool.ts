import { t } from '../i18n.ts';
import { ShapeIcons } from '../icons.ts';
import { applyButtonIcon } from '../shared/tools-menu.ts';
import { normalizeShapeFill, normalizeShapeObject } from './model.ts';
import type { BoardCommand, Point, ShapeFill, ShapeKind, ShapeObject } from './model.ts';
import { loadText, saveText } from '../shared/storage.ts';
import { fillName, renderFillChip } from './fill-palette.ts';
import type { FillPalette } from './fill-palette.ts';
import { applyViewport, screenToWorld } from './viewport.ts';
import type { BoardViewport } from './viewport.ts';
import type { SelectionController } from './selection.ts';
import { constrainPopup } from './screen-layout.ts';
import {
  alignToGrid,
  boxBounds,
  constrainedEnd,
  drawShape,
  hitShape,
  intersectsShape,
  isBox,
  isFillable,
  hitShapeHandle,
} from './shapes.ts';

interface ShapeToolOptions {
  canvas: HTMLCanvasElement;
  layer: HTMLCanvasElement;
  button: HTMLButtonElement;
  getObjects(): ShapeObject[];
  getViewport(): BoardViewport;
  style(): { size: number; inkRaw: string };
  selection: SelectionController;
  ink(raw: string): string;
  commit(command: BoardCommand): Promise<boolean>;
  status(message: string): void;
  fillPalette: FillPalette;
  /** Grid or dot spacing of the paper, or null on blank and lined paper. */
  gridStep(): number | null;
  /** Repaints the board, which draws shapes with everything else in stack order. */
  redraw(): void;
}
const LS_SHAPE_FILL = 'zoni_board_shape_fill';
function storedFill(): ShapeFill | null {
  try {
    return normalizeShapeFill(JSON.parse(loadText(LS_SHAPE_FILL) || 'null'));
  } catch {
    return null;
  }
}
type Drag = {
  id: number;
  start: Point;
  latest: Point;
  selectOnTap?: string;
  object: ShapeObject;
};

export function createShapeTool(options: ShapeToolOptions) {
  const { canvas, layer, button } = options;
  const context = layer.getContext('2d');
  if (!context) throw new Error('Shapes canvas context is unavailable.');
  const ctx = context;
  let active = false,
    kind: ShapeKind = 'rectangle';
  let drag: Drag | null = null;
  const erased = new Set<string>();
  const picker = document.createElement('div');
  picker.id = 'shapePicker';
  picker.className = 'shape-picker';
  picker.setAttribute('role', 'dialog');
  picker.hidden = true;
  button.setAttribute('aria-controls', picker.id);
  const choices = (Object.keys(ShapeIcons) as ShapeKind[]).map((value) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.dataset.shape = value;
    choice.innerHTML = `<span class="btn-icon" aria-hidden="true">${ShapeIcons[value]}</span><span></span>`;
    choice.addEventListener('click', () => {
      flushStyle();
      cancel();
      kind = value;
      options.selection.clear();
      closePicker();
      labels();
      paint();
      options.status(t('shapeHint'));
    });
    picker.append(choice);
    return choice;
  });
  // Fill for the next closed shapes; remembered on this device.
  let nextFill = storedFill();
  const fillRow = document.createElement('button');
  fillRow.type = 'button';
  fillRow.className = 'shape-fill-row';
  fillRow.setAttribute('aria-haspopup', 'dialog');
  fillRow.setAttribute('aria-expanded', 'false');
  fillRow.innerHTML = '<span aria-hidden="true"></span><span></span>';
  fillRow.addEventListener('click', () =>
    options.fillPalette.toggle(fillRow, nextFill, options.style().inkRaw, (fill) => {
      nextFill = fill;
      saveText(LS_SHAPE_FILL, fill ? JSON.stringify(fill) : '');
      labels();
    })
  );
  picker.append(fillRow);
  document.body.append(picker);
  function labels() {
    renderFillChip(fillRow.firstElementChild as HTMLElement, nextFill, options.style().inkRaw);
    fillRow.lastElementChild!.textContent = t('fill');
    fillRow.setAttribute('aria-label', t('fillWith', { color: fillName(nextFill) }));
    fillRow.title = fillRow.getAttribute('aria-label')!;
    picker.setAttribute('aria-label', t('shapes'));
    applyButtonIcon(button, ShapeIcons[kind]);
    button.title = `${t('shapes')} · ${t(kind)}`;
    choices.forEach((choice) => {
      const value = choice.dataset.shape as ShapeKind;
      choice.lastElementChild!.textContent = t(value);
      choice.setAttribute('aria-pressed', String(kind === value));
    });
  }
  labels();
  function selected() {
    const ref = options.selection.current();
    return ref?.kind === 'shape'
      ? options.getObjects().find((object) => object.id === ref.id)
      : undefined;
  }
  function point(event: { clientX: number; clientY: number }): Point {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      options.getViewport(),
      rect
    );
  }
  function commit(object: ShapeObject) {
    const normalized = normalizeShapeObject(object);
    if (!normalized) return;
    void options.commit({ type: 'shape-set', object: normalized }).then((ok) => {
      if (!ok) options.status(t('shapeSaveFailed'));
    });
  }
  function closePicker(focus = true) {
    options.fillPalette.close();
    picker.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    paint();
    if (focus) canvas.focus({ preventScroll: true });
  }
  function positionPicker() {
    if (picker.hidden) return;
    const anchor = button.getBoundingClientRect();
    picker.style.left = `${anchor.left}px`;
    picker.style.top = `${anchor.bottom + 4}px`;
    constrainPopup(picker);
  }
  /** Shapes are drawn by the board in stack order. */
  function paint() {
    options.redraw();
  }
  /** This layer shows only the shape being drawn, above everything (new shapes go on top). */
  function paintLayer() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, layer.width, layer.height);
    const view = options.getViewport(),
      rect = canvas.getBoundingClientRect();
    applyViewport(ctx, view, rect, Math.max(1, window.devicePixelRatio || 1));
    if (drag) drawShape(ctx, drag.object, options.ink);
    positionPicker();
  }
  function flushStyle() {
    options.selection.flushStyle();
  }
  function cancel() {
    drag = null;
    paint();
  }
  function update(event: { clientX: number; clientY: number; shiftKey: boolean }) {
    if (!drag) return;
    const current = point(event);
    drag.latest = current;
    drag.object.end = constrainedEnd(drag.object.kind, drag.start, current, event.shiftKey);
    drag.object = alignToGrid({ ...drag.object, start: drag.start });
    paint();
  }
  function start(event: PointerEvent) {
    if (!active || drag) return;
    flushStyle();
    closePicker(false);
    canvas.focus({ preventScroll: true });
    const current = point(event),
      view = options.getViewport();
    const existing = selected();
    const handle = existing
      ? hitShapeHandle(existing, current, (event.pointerType === 'touch' ? 22 : 10) / view.zoom)
      : -1;
    if (existing && (handle >= 0 || hitShape(existing, current, 6 / view.zoom))) {
      options.selection.begin(event, { kind: 'shape', id: existing.id }, handle);
      return;
    }
    const tapped = [...options.getObjects()]
      .reverse()
      .find((shape) => hitShape(shape, current, 6 / view.zoom));
    options.selection.clear();
    const shape: ShapeObject = {
      id: crypto.randomUUID(),
      kind,
      start: current,
      end: { ...current },
      ...options.style(),
      ...(nextFill && isFillable(kind) ? { fill: { ...nextFill } } : {}),
    };
    const step = options.gridStep();
    if (step && (kind === 'numberLine' || kind === 'axes')) shape.step = step;
    drag = {
      id: event.pointerId,
      selectOnTap: tapped?.id,
      start: current,
      latest: current,
      object: shape,
    };
    paint();
  }
  function end(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    update(event);
    const current = drag;
    drag = null;
    const distance =
      Math.hypot(current.latest.x - current.start.x, current.latest.y - current.start.y) *
      options.getViewport().zoom;
    const bounds = boxBounds(current.object);
    if (distance < 3 && current.selectOnTap) {
      options.selection.select({ kind: 'shape', id: current.selectOnTap });
      options.status(t('selectedShape'));
    }
    if (
      distance >= 3 &&
      (!isBox(current.object.kind) || (bounds.width >= 1 && bounds.height >= 1)) &&
      normalizeShapeObject(current.object)
    ) {
      commit(current.object);
      options.selection.select({ kind: 'shape', id: current.object.id });
      options.status(t('selectedShape'));
    }
    paint();
  }
  document.addEventListener('pointerdown', (event) => {
    if (
      !picker.hidden &&
      !event.composedPath().includes(picker) &&
      !event.composedPath().includes(button) &&
      !event.composedPath().some((node) => node instanceof Element && node.id === 'fillPalette')
    )
      closePicker(false);
  });
  document.addEventListener('board:layout', paintLayer);
  document.addEventListener('i18n:change', () => {
    labels();
    paint();
    positionPicker();
  });
  window.addEventListener('pagehide', flushStyle);
  document.addEventListener('keyup', (event) => {
    if (drag && event.key === 'Shift') {
      drag.object = alignToGrid({ ...drag.object, start: drag.start, end: { ...drag.latest } });
      paint();
    }
  });
  return {
    paint,
    start,
    end,
    cancel,
    flushStyle,
    move(event: PointerEvent) {
      if (drag?.id === event.pointerId) update(event);
    },
    isBusy: () => Boolean(drag),
    activate(value: boolean) {
      flushStyle();
      active = value;
      if (!active) {
        drag = null;
        closePicker(false);
      }
      canvas.classList.toggle('shapes-tool-active', active);
      paint();
    },
    togglePicker() {
      if (!picker.hidden) {
        closePicker();
        return;
      }
      picker.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      labels();
      paint();
      positionPicker();
      choices.find((choice) => choice.dataset.shape === kind)?.focus({ preventScroll: true });
    },
    erase(from: Point, to: Point, radius: number): string[] {
      const ids = options
        .getObjects()
        .filter((object) => intersectsShape(object, from, to, radius))
        .map((object) => object.id);
      // The board repaints the eraser preview.
      ids.forEach((id) => erased.add(id));
      return ids;
    },
    clearErasePreview() {
      erased.clear();
    },
    paintLayer,
    /** Shapes the board should leave out while the eraser is over them. */
    hides: (id: string) => erased.has(id),
    handleKey(event: KeyboardEvent): boolean {
      if (
        !active ||
        event.isComposing ||
        event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element && node.matches('input, textarea, [contenteditable="true"]')
          )
      )
        return false;
      if (!picker.hidden && event.key === 'Escape') {
        event.preventDefault();
        closePicker();
        return true;
      }
      if (drag && event.key === 'Escape') {
        event.preventDefault();
        cancel();
        return true;
      }
      if (drag && event.key === 'Shift') {
        drag.object = alignToGrid({
          ...drag.object,
          start: drag.start,
          end: constrainedEnd(drag.object.kind, drag.start, drag.latest, true),
        });
        paint();
        return true;
      }
      return false;
    },
    isPickerOpen: () => !picker.hidden,
  };
}
