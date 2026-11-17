import { t } from '../i18n.ts';
import { ShapeIcons } from '../icons.ts';
import { applyButtonIcon } from '../shared/tools-menu.ts';
import { cloneShapeObject, normalizeShapeObject } from './model.ts';
import type { BoardCommand, Point, ShapeKind, ShapeObject } from './model.ts';
import {
  applyViewport,
  boundsIntersect,
  screenToWorld,
  visibleBounds,
  worldToScreen,
} from './viewport.ts';
import type { BoardViewport } from './viewport.ts';
import { constrainPopup, panelArea } from './screen-layout.ts';
import {
  boxBounds,
  constrainedEnd,
  drawShape,
  hitShape,
  intersectsShape,
  isBox,
  shapeBounds,
  shapeHandles,
  hitShapeHandle,
} from './shapes.ts';

interface ShapeToolOptions {
  canvas: HTMLCanvasElement;
  layer: HTMLCanvasElement;
  button: HTMLButtonElement;
  getObjects(): ShapeObject[];
  getViewport(): BoardViewport;
  style(): { size: number; inkRaw: string };
  selectionStyle(object: ShapeObject): void;
  ink(raw: string): string;
  commit(command: BoardCommand): Promise<boolean>;
  status(message: string): void;
}
type Drag = {
  id: number;
  mode: 'create' | 'move' | 'resize';
  start: Point;
  latest: Point;
  handle: number;
  selectOnTap?: string;
  original: ShapeObject;
  object: ShapeObject;
};

export function createShapeTool(options: ShapeToolOptions) {
  const { canvas, layer, button } = options;
  const context = layer.getContext('2d');
  if (!context) throw new Error('Shapes canvas context is unavailable.');
  const ctx = context;
  let active = false,
    kind: ShapeKind = 'rectangle',
    selectedId: string | null = null;
  let drag: Drag | null = null;
  let styleDraft: ShapeObject | null = null;
  let shownStyle = '';
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
      selectedId = null;
      closePicker();
      labels();
      paint();
      options.status(t('shapeHint'));
    });
    picker.append(choice);
    return choice;
  });
  const actions = document.createElement('div');
  actions.className = 'shape-selection-actions';
  actions.setAttribute('role', 'toolbar');
  actions.hidden = true;
  const remove = document.createElement('button'),
    done = document.createElement('button');
  remove.type = done.type = 'button';
  actions.append(remove, done);
  document.body.append(picker, actions);

  function labels() {
    picker.setAttribute('aria-label', t('shapes'));
    applyButtonIcon(button, ShapeIcons[kind]);
    button.title = `${t('shapes')} · ${t(kind)}`;
    actions.setAttribute('aria-label', t('selectedShape'));
    remove.textContent = t('deleteText');
    done.textContent = t('doneText');
    choices.forEach((choice) => {
      const value = choice.dataset.shape as ShapeKind;
      choice.lastElementChild!.textContent = t(value);
      choice.setAttribute('aria-pressed', String(kind === value));
    });
  }
  labels();
  function selected() {
    return options.getObjects().find((object) => object.id === selectedId);
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
  function paint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, layer.width, layer.height);
    const view = options.getViewport(),
      rect = canvas.getBoundingClientRect();
    applyViewport(ctx, view, rect, Math.max(1, window.devicePixelRatio || 1));
    const visible = visibleBounds(view, rect);
    for (const object of options.getObjects()) {
      if (erased.has(object.id)) continue;
      const shown =
        drag?.object.id === object.id
          ? drag.object
          : styleDraft?.id === object.id
            ? styleDraft
            : object;
      if (boundsIntersect(shapeBounds(shown), visible)) drawShape(ctx, shown, options.ink);
    }
    if (drag?.mode === 'create') drawShape(ctx, drag.object, options.ink);
    const object = drag?.object ?? styleDraft ?? selected();
    if (active && object && !styleDraft) {
      const nextStyle = `${object.id}:${object.size}:${object.inkRaw}`;
      if (shownStyle !== nextStyle) {
        shownStyle = nextStyle;
        options.selectionStyle(object);
      }
    }
    actions.hidden =
      !active ||
      !object ||
      !picker.hidden ||
      Boolean(drag) ||
      erased.has(object.id) ||
      !boundsIntersect(shapeBounds(object), visible);
    if (!active || !object || erased.has(object.id)) return;
    ctx.save();
    ctx.strokeStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--btn-fg').trim() || '#2563eb';
    ctx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() ||
      '#ffffff';
    ctx.lineWidth = 1 / view.zoom;
    const bounds = shapeBounds(object);
    ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.setLineDash([]);
    for (const handle of shapeHandles(object)) {
      const width = 10 / view.zoom;
      ctx.fillRect(handle.x - width / 2, handle.y - width / 2, width, width);
      ctx.strokeRect(handle.x - width / 2, handle.y - width / 2, width, width);
    }
    ctx.restore();
    if (!actions.hidden) {
      const anchor = worldToScreen(bounds, view, rect),
        area = panelArea();
      const width = actions.getBoundingClientRect().width,
        height = actions.getBoundingClientRect().height;
      // On very short screens actions may use header space, but never cover navigation.
      const top = Math.min(Math.max(area.top, rect.top + 4), area.bottom - height);
      const desiredY =
        anchor.y >= height + 6
          ? rect.top + anchor.y - height - 6
          : rect.top + anchor.y + bounds.height * view.zoom + 6;
      actions.style.left = `${Math.max(area.left, Math.min(rect.left + anchor.x, area.right - width))}px`;
      actions.style.top = `${Math.max(top, Math.min(desiredY, area.bottom - height))}px`;
    }
    positionPicker();
  }
  function flushStyle() {
    if (!styleDraft) return;
    const object = styleDraft;
    styleDraft = null;
    const original = selected();
    if (original && (original.size !== object.size || original.inkRaw !== object.inkRaw))
      commit(object);
    paint();
  }
  function cancel() {
    drag = null;
    paint();
  }
  function updateAt(current: Point, shiftKey: boolean) {
    if (!drag) return;
    drag.latest = current;
    const original = drag.original;
    if (drag.mode === 'move') {
      const delta = { x: current.x - drag.start.x, y: current.y - drag.start.y };
      drag.object = {
        ...original,
        start: { x: original.start.x + delta.x, y: original.start.y + delta.y },
        end: { x: original.end.x + delta.x, y: original.end.y + delta.y },
      };
    } else if (drag.mode === 'create') {
      drag.object.end = constrainedEnd(original.kind, original.start, current, shiftKey);
    } else if (isBox(original.kind)) {
      const opposite = shapeHandles(original)[(drag.handle + 2) % 4];
      const handle = shapeHandles(original)[drag.handle];
      const corner = {
        x: handle.x + current.x - drag.start.x,
        y: handle.y + current.y - drag.start.y,
      };
      drag.object.start = { ...opposite };
      drag.object.end = constrainedEnd(original.kind, opposite, corner, shiftKey);
    } else {
      const anchor = drag.handle === 0 ? original.end : original.start;
      const handle = drag.handle === 0 ? original.start : original.end;
      const endpoint = {
        x: handle.x + current.x - drag.start.x,
        y: handle.y + current.y - drag.start.y,
      };
      drag.object[drag.handle === 0 ? 'start' : 'end'] = constrainedEnd(
        original.kind,
        anchor,
        endpoint,
        shiftKey
      );
    }
    paint();
  }
  function update(event: PointerEvent) {
    updateAt(point(event), event.shiftKey);
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
    const object =
      existing && (handle >= 0 || hitShape(existing, current, 6 / view.zoom))
        ? existing
        : undefined;
    if (object) {
      selectedId = object.id;
      drag = {
        id: event.pointerId,
        mode: handle >= 0 ? 'resize' : 'move',
        handle,
        start: current,
        latest: current,
        original: cloneShapeObject(object),
        object: cloneShapeObject(object),
      };
      options.status(t('selectedShape'));
    } else {
      const tapped = [...options.getObjects()]
        .reverse()
        .find((shape) => hitShape(shape, current, 6 / view.zoom));
      selectedId = null;
      const shape: ShapeObject = {
        id: crypto.randomUUID(),
        kind,
        start: current,
        end: { ...current },
        ...options.style(),
      };
      drag = {
        id: event.pointerId,
        mode: 'create',
        handle: -1,
        selectOnTap: tapped?.id,
        start: current,
        latest: current,
        original: cloneShapeObject(shape),
        object: shape,
      };
    }
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
      selectedId = current.selectOnTap;
      options.status(t('selectedShape'));
    }
    if (
      distance >= 3 &&
      (!isBox(current.object.kind) || (bounds.width >= 1 && bounds.height >= 1)) &&
      normalizeShapeObject(current.object)
    ) {
      selectedId = current.object.id;
      commit(current.object);
      options.status(t('selectedShape'));
    }
    paint();
  }
  function deselect() {
    flushStyle();
    cancel();
    selectedId = null;
    closePicker();
    paint();
  }
  function deleteSelected() {
    if (!selected()) return;
    const id = selectedId!;
    styleDraft = null;
    drag = null;
    selectedId = null;
    void options.commit({ type: 'shape-delete', ids: [id] }).then((ok) => {
      if (!ok) options.status(t('shapeSaveFailed'));
    });
    paint();
    canvas.focus({ preventScroll: true });
  }
  remove.addEventListener('click', deleteSelected);
  done.addEventListener('click', deselect);
  document.addEventListener('pointerdown', (event) => {
    if (
      !picker.hidden &&
      !event.composedPath().includes(picker) &&
      !event.composedPath().includes(button)
    )
      closePicker(false);
  });
  document.addEventListener('board:layout', () => {
    paint();
    positionPicker();
  });
  document.addEventListener('i18n:change', () => {
    labels();
    paint();
    positionPicker();
  });
  window.addEventListener('pagehide', flushStyle);
  document.addEventListener('keyup', (event) => {
    if (drag && event.key === 'Shift') updateAt(drag.latest, false);
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
        shownStyle = '';
        drag = null;
        selectedId = null;
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
      paint();
      positionPicker();
      choices.find((choice) => choice.dataset.shape === kind)?.focus({ preventScroll: true });
    },
    updateStyle(style: Partial<Pick<ShapeObject, 'size' | 'inkRaw'>>) {
      const object = styleDraft ?? selected();
      if (!active || !object || drag) return;
      styleDraft = { ...cloneShapeObject(object), ...style };
      paint();
    },
    erase(from: Point, to: Point, radius: number): string[] {
      const ids = options
        .getObjects()
        .filter((object) => intersectsShape(object, from, to, radius))
        .map((object) => object.id);
      ids.forEach((id) => erased.add(id));
      paint();
      return ids;
    },
    clearErasePreview() {
      erased.clear();
      paint();
    },
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
      if (event.target !== canvas && !event.composedPath().includes(actions)) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        deselect();
        return true;
      }
      if (event.ctrlKey || event.metaKey) return false;
      if (drag && event.key === 'Shift') {
        updateAt(drag.latest, true);
        return true;
      }
      if (drag) return false;
      const object = selected();
      if (!object) return false;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return true;
      }
      const step = event.shiftKey ? 10 : 1;
      const offsets: Record<string, Point> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      };
      const offset = offsets[event.key];
      if (!offset) return false;
      event.preventDefault();
      flushStyle();
      const next = cloneShapeObject(selected()!);
      next.end.x += offset.x;
      next.end.y += offset.y;
      if (!event.altKey) {
        next.start.x += offset.x;
        next.start.y += offset.y;
      }
      commit(next);
      return true;
    },
  };
}
