import { t } from '../i18n.ts';
import {
  cloneShapeObject,
  cloneTextObject,
  cloneContentObject,
  normalizeShapeObject,
} from './model.ts';
import type {
  BoardCommand,
  BoardObjectRef,
  BoardTool,
  Point,
  ShapeObject,
  TextObject,
  ContentObject,
} from './model.ts';
import { contentBounds, contentCorners, resizeMedia } from './content.ts';
import { hitInk, inkBounds } from './ink.ts';
import type { InkObject } from './ink.ts';
import type { BoardScene } from './scene-renderer.ts';
import { cachedTextLayout, containsPoint } from './text-layout.ts';
import {
  constrainedEnd,
  hitShape,
  hitShapeHandle,
  isBox,
  shapeBounds,
  shapeHandles,
} from './shapes.ts';
import { boundsIntersect, screenToWorld, visibleBounds, worldToScreen } from './viewport.ts';
import type { BoardBounds, BoardViewport } from './viewport.ts';
import { panelArea } from './screen-layout.ts';

type SelectedObject =
  | { kind: 'stroke'; value: InkObject }
  | { kind: 'shape'; value: ShapeObject }
  | { kind: 'text'; value: TextObject }
  | {
      [K in ContentObject['kind']]: { kind: K; value: Extract<ContentObject, { kind: K }> };
    }[ContentObject['kind']];
interface SelectionOptions {
  canvas: HTMLCanvasElement;
  textContext: CanvasRenderingContext2D;
  scene(): BoardScene;
  view(): BoardViewport;
  tool(): BoardTool;
  editing(): boolean;
  hidden(): boolean;
  redraw(): void;
  commit(command: BoardCommand): Promise<boolean>;
  editObject(ref: BoardObjectRef): void;
  changed(ref: BoardObjectRef | null, style: { size: number; inkRaw: string } | null): void;
  beginGrip(event: PointerEvent, ref: BoardObjectRef): void;
  status(message: string): void;
}
type Drag = { id: number; start: Point; latest: Point; original: SelectedObject; handle: number };
const sameRef = (a: BoardObjectRef | null, b: BoardObjectRef) =>
  a?.kind === b.kind && a.id === b.id;

export function createSelection(options: SelectionOptions) {
  const { canvas } = options;
  let ref: BoardObjectRef | null = null,
    draft: SelectedObject | null = null,
    drag: Drag | null = null;
  let signature = '';
  const outline = document.createElement('div');
  outline.className = 'object-selection';
  outline.hidden = true;
  outline.tabIndex = 0;
  outline.setAttribute('role', 'group');
  const handles = Array.from({ length: 4 }, () => {
    const handle = document.createElement('span');
    handle.className = 'object-selection-handle';
    outline.append(handle);
    return handle;
  });
  canvas.parentElement!.append(outline);
  const actions = document.createElement('div');
  actions.hidden = true;
  actions.setAttribute('role', 'toolbar');
  const move = document.createElement('button'),
    edit = document.createElement('button'),
    remove = document.createElement('button'),
    done = document.createElement('button');
  for (const button of [move, edit, remove, done]) button.type = 'button';
  move.className = 'selection-move';
  actions.append(move, edit, remove, done);
  document.body.append(actions);
  function lookup(target: BoardObjectRef | null = ref): SelectedObject | null {
    if (!target) return null;
    const scene = options.scene();
    switch (target.kind) {
      case 'stroke': {
        const value = scene.strokes.find((o) => o.id === target.id);
        return value ? { kind: 'stroke', value } : null;
      }
      case 'shape': {
        const value = scene.shapes.find((o) => o.id === target.id);
        return value ? { kind: 'shape', value } : null;
      }
      case 'text': {
        const value = scene.text.find((o) => o.id === target.id);
        return value ? { kind: 'text', value } : null;
      }
      case 'image':
      case 'video':
      case 'table': {
        const value = scene.content.find((o) => o.id === target.id && o.kind === target.kind);
        return value ? ({ kind: value.kind, value } as SelectedObject) : null;
      }
    }
  }
  function bounds(object: SelectedObject): BoardBounds {
    switch (object.kind) {
      case 'stroke':
        return inkBounds(object.value);
      case 'shape':
        return shapeBounds(object.value);
      case 'text':
        return cachedTextLayout(options.textContext, object.value).bounds;
      case 'image':
      case 'video':
      case 'table':
        return contentBounds(options.textContext, object.value);
    }
  }
  function point(event: { clientX: number; clientY: number }): Point {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      options.view(),
      rect
    );
  }
  function translate(original: SelectedObject, delta: Point): SelectedObject {
    switch (original.kind) {
      case 'stroke':
        return {
          kind: 'stroke',
          value: {
            ...original.value,
            offset: { x: original.value.offset.x + delta.x, y: original.value.offset.y + delta.y },
          },
        };
      case 'shape': {
        const value = cloneShapeObject(original.value);
        value.start.x += delta.x;
        value.start.y += delta.y;
        value.end.x += delta.x;
        value.end.y += delta.y;
        return { kind: 'shape', value };
      }
      case 'text': {
        const value = cloneTextObject(original.value);
        value.position.x += delta.x;
        value.position.y += delta.y;
        return { kind: 'text', value };
      }
      case 'image':
      case 'video':
      case 'table': {
        const value = cloneContentObject(original.value);
        value.position.x += delta.x;
        value.position.y += delta.y;
        return { kind: value.kind, value } as SelectedObject;
      }
    }
  }
  function command(original: SelectedObject, next: SelectedObject): BoardCommand | null {
    if (original.kind === 'stroke' && next.kind === 'stroke') {
      const a = original.value,
        b = next.value;
      const delta = { x: b.offset.x - a.offset.x, y: b.offset.y - a.offset.y };
      if (
        !delta.x &&
        !delta.y &&
        a.stroke.size === b.stroke.size &&
        a.stroke.inkRaw === b.stroke.inkRaw
      )
        return null;
      return {
        type: 'stroke-edit',
        id: b.id,
        ...(delta.x || delta.y ? { translate: delta } : {}),
        ...(a.stroke.size !== b.stroke.size ? { size: b.stroke.size } : {}),
        ...(a.stroke.inkRaw !== b.stroke.inkRaw ? { inkRaw: b.stroke.inkRaw } : {}),
      };
    }
    if (original.kind === 'shape' && next.kind === 'shape') {
      const object = normalizeShapeObject(next.value);
      return object && JSON.stringify(object) !== JSON.stringify(original.value)
        ? { type: 'shape-set', object }
        : null;
    }
    if (original.kind === 'text' && next.kind === 'text')
      return JSON.stringify(original.value) !== JSON.stringify(next.value)
        ? { type: 'text-set', object: next.value }
        : null;
    if (
      (next.kind === 'image' || next.kind === 'video' || next.kind === 'table') &&
      original.kind === next.kind
    )
      return JSON.stringify(original.value) !== JSON.stringify(next.value)
        ? { type: 'content-set', object: next.value }
        : null;
    return null;
  }
  function commit(value: BoardCommand | null) {
    if (value)
      void options.commit(value).then((ok) => {
        if (!ok) options.status(t('objectSaveFailed'));
      });
  }
  function paint() {
    const actual = lookup();
    if (!actual) {
      draft = null;
      drag = null;
    }
    const object = draft ?? actual;
    const style =
      object?.kind === 'stroke'
        ? object.value.stroke
        : object?.kind === 'shape'
          ? object.value
          : null;
    const nextSignature = JSON.stringify([ref, options.tool(), style?.size, style?.inkRaw]);
    options.changed(actual ? ref : null, null);
    if (!draft && signature !== nextSignature) {
      signature = nextSignature;
      options.changed(actual ? ref : null, style);
    }
    outline.hidden = actions.hidden = !object || options.editing() || options.hidden();
    if (!object || outline.hidden) return;
    const rect = canvas.getBoundingClientRect(),
      view = options.view(),
      area = bounds(object);
    outline.hidden = actions.hidden = !boundsIntersect(area, visibleBounds(view, rect));
    if (outline.hidden) return;
    const anchor = worldToScreen(area, view, rect);
    outline.id = object.kind === 'text' ? 'textSelection' : 'objectSelection';
    outline.className = `object-selection ${object.kind === 'text' ? 'text-selection' : ''}`;
    outline.setAttribute('aria-label', t('selectedObject'));
    actions.className = `object-selection-actions ${object.kind}-selection-actions`;
    actions.setAttribute('aria-label', t('selectedObject'));
    Object.assign(outline.style, {
      left: `${anchor.x}px`,
      top: `${anchor.y}px`,
      width: `${area.width * view.zoom}px`,
      height: `${area.height * view.zoom}px`,
    });
    const corners =
      object.kind === 'shape'
        ? shapeHandles(object.value)
        : object.kind === 'image' || object.kind === 'video'
          ? contentCorners(options.textContext, object.value)
          : [];
    handles.forEach((handle, index) => {
      const corner = corners[index];
      handle.hidden = !corner;
      if (corner) {
        handle.style.left = `${(corner.x - area.x) * view.zoom}px`;
        handle.style.top = `${(corner.y - area.y) * view.zoom}px`;
      }
    });
    move.hidden = !(object.kind === 'text' && options.tool() === 'text');
    edit.hidden = object.kind === 'stroke' || object.kind === 'shape' || object.kind === 'image';
    edit.textContent = t(object.kind === 'video' ? 'playVideo' : 'editText');
    done.hidden = object.kind === 'text' && options.tool() === 'text';
    actions.hidden ||= Boolean(drag);
    if (!actions.hidden) {
      const panel = panelArea(),
        width = actions.getBoundingClientRect().width,
        height = actions.getBoundingClientRect().height;
      const top = Math.min(Math.max(panel.top, rect.top + 4), panel.bottom - height);
      const desiredY =
        anchor.y >= height + 6
          ? rect.top + anchor.y - height - 6
          : rect.top + anchor.y + area.height * view.zoom + 6;
      actions.style.left = `${Math.max(panel.left, Math.min(rect.left + anchor.x, panel.right - width))}px`;
      actions.style.top = `${Math.max(top, Math.min(desiredY, panel.bottom - height))}px`;
    }
  }
  function labels() {
    move.textContent = t('moveText');
    edit.textContent = t('editText');
    remove.textContent = t('deleteText');
    done.textContent = t('doneText');
  }
  labels();
  function flushStyle() {
    if (drag || !draft) return;
    const original = lookup(),
      next = draft;
    draft = null;
    if (original) commit(command(original, next));
    options.redraw();
  }
  function cancel() {
    if (!drag) return;
    drag = null;
    draft = null;
    options.redraw();
  }
  function clear() {
    flushStyle();
    cancel();
    ref = null;
    paint();
  }
  function select(next: BoardObjectRef | null) {
    if (!sameRef(ref, next ?? { kind: 'stroke', id: '' })) flushStyle();
    cancel();
    ref = next;
    draft = null;
    paint();
  }
  function hit(event: MouseEvent & { pointerType?: string }): BoardObjectRef | null {
    const p = point(event),
      zoom = options.view().zoom,
      padding = event.pointerType === 'touch' ? 10 : 6;
    const scene = options.scene();
    for (const value of [...scene.text].reverse())
      if (containsPoint(cachedTextLayout(options.textContext, value).bounds, p, padding / zoom))
        return { kind: 'text', id: value.id };
    for (const value of [...scene.shapes].reverse())
      if (hitShape(value, p, padding / zoom)) return { kind: 'shape', id: value.id };
    for (const value of [...scene.strokes].reverse())
      if (hitInk(value, p, zoom, padding)) return { kind: 'stroke', id: value.id };
    for (const value of [...scene.content].reverse())
      if (containsPoint(contentBounds(options.textContext, value), p, padding / zoom))
        return { kind: value.kind, id: value.id };
    return null;
  }
  function begin(event: PointerEvent, target: BoardObjectRef, handle = -1) {
    flushStyle();
    const original = lookup(target);
    if (!original) return;
    ref = target;
    const p = point(event);
    drag = { id: event.pointerId, start: p, latest: p, original, handle };
    draft = original;
    canvas.focus({ preventScroll: true });
    options.status(t('selectedObject'));
    paint();
  }
  function update(p: Point, shift: boolean) {
    if (!drag) return;
    drag.latest = p;
    const original = drag.original;
    if (drag.handle >= 0 && original.kind === 'shape') {
      const value = cloneShapeObject(original.value),
        handles = shapeHandles(value),
        handle = handles[drag.handle];
      const next = { x: handle.x + p.x - drag.start.x, y: handle.y + p.y - drag.start.y };
      if (isBox(value.kind)) {
        value.start = { ...handles[(drag.handle + 2) % 4] };
        value.end = constrainedEnd(value.kind, value.start, next, shift);
      } else {
        const anchor = drag.handle === 0 ? value.end : value.start;
        value[drag.handle === 0 ? 'start' : 'end'] = constrainedEnd(
          value.kind,
          anchor,
          next,
          shift
        );
      }
      draft = { kind: 'shape', value };
    } else if (drag.handle >= 0 && (original.kind === 'image' || original.kind === 'video')) {
      const value = resizeMedia(original.value, drag.handle, p);
      draft = { kind: value.kind, value } as SelectedObject;
    } else draft = translate(original, { x: p.x - drag.start.x, y: p.y - drag.start.y });
    options.redraw();
  }
  function end(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    update(point(event), event.shiftKey);
    const current = drag,
      next = draft;
    drag = null;
    draft = null;
    const distance =
      Math.hypot(current.latest.x - current.start.x, current.latest.y - current.start.y) *
      options.view().zoom;
    if (distance >= 3 && next) commit(command(current.original, next));
    options.redraw();
  }
  function editSelected() {
    flushStyle();
    if (ref) options.editObject(ref);
  }
  function removeSelected() {
    if (!ref || !lookup()) return;
    draft = null;
    drag = null;
    const type =
      ref.kind === 'stroke'
        ? 'stroke-delete'
        : ref.kind === 'shape'
          ? 'shape-delete'
          : ref.kind === 'text'
            ? 'text-delete'
            : 'content-delete';
    const id = ref.id;
    ref = null;
    commit({ type, ids: [id] });
    options.redraw();
    canvas.focus({ preventScroll: true });
  }
  move.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && ref) options.beginGrip(event, ref);
  });
  edit.addEventListener('click', editSelected);
  remove.addEventListener('click', removeSelected);
  done.addEventListener('click', () => {
    clear();
    canvas.focus({ preventScroll: true });
  });
  document.addEventListener('i18n:change', () => {
    labels();
    paint();
  });
  document.addEventListener('board:layout', paint);
  document.addEventListener('keyup', (event) => {
    if (event.key === 'Shift' && drag) update(drag.latest, false);
  });
  window.addEventListener('pagehide', flushStyle);
  canvas.addEventListener('dblclick', (event) => {
    if (options.tool() !== 'select' || options.editing()) return;
    const target = hit(event);
    if (target) {
      select(target);
      editSelected();
    }
  });
  return {
    current: () => (lookup() ? ref : null),
    select,
    clear,
    paint,
    begin,
    cancel,
    flushStyle,
    isDragging: () => Boolean(drag),
    start(event: PointerEvent) {
      const object = lookup();
      const handle =
        object?.kind === 'shape'
          ? hitShapeHandle(
              object.value,
              point(event),
              (event.pointerType === 'touch' ? 22 : 10) / options.view().zoom
            )
          : object?.kind === 'image' || object?.kind === 'video'
            ? contentCorners(options.textContext, object.value).findIndex(
                (corner) =>
                  Math.hypot(corner.x - point(event).x, corner.y - point(event).y) <=
                  (event.pointerType === 'touch' ? 22 : 10) / options.view().zoom
              )
            : -1;
      const target = handle >= 0 ? ref : hit(event);
      if (target) begin(event, target, handle);
      else clear();
    },
    move(event: PointerEvent) {
      if (drag?.id === event.pointerId) update(point(event), event.shiftKey);
    },
    end,
    displayStroke(object: InkObject): InkObject {
      return draft?.kind === 'stroke' && draft.value.id === object.id ? draft.value : object;
    },
    displayShape(object: ShapeObject): ShapeObject {
      return draft?.kind === 'shape' && draft.value.id === object.id ? draft.value : object;
    },
    displayText(object: TextObject): TextObject {
      return draft?.kind === 'text' && draft.value.id === object.id ? draft.value : object;
    },
    displayContent(object: ContentObject): ContentObject {
      return (draft?.kind === 'image' || draft?.kind === 'video' || draft?.kind === 'table') &&
        draft.value.id === object.id
        ? draft.value
        : object;
    },
    updateStyle(style: Partial<Pick<ShapeObject, 'size' | 'inkRaw'>>) {
      if (drag || options.editing()) return;
      const object = draft ?? lookup();
      if (object?.kind === 'stroke')
        draft = {
          kind: 'stroke',
          value: { ...object.value, stroke: { ...object.value.stroke, ...style } },
        };
      else if (object?.kind === 'shape')
        draft = { kind: 'shape', value: { ...object.value, ...style } };
      else return;
      options.redraw();
    },
    handleKey(event: KeyboardEvent): boolean {
      if (
        options.editing() ||
        event.isComposing ||
        event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element &&
              node.matches('input, textarea, [contenteditable="true"], [role="textbox"]')
          )
      )
        return false;
      if (
        event.target !== canvas &&
        event.target !== outline &&
        !event.composedPath().includes(actions)
      )
        return false;
      if (event.ctrlKey || event.metaKey) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (drag) cancel();
        else clear();
        return true;
      }
      if (drag) {
        if (event.key === 'Shift') {
          update(drag.latest, true);
          return true;
        }
        return false;
      }
      const object = lookup();
      if (!object) return false;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelected();
        return true;
      }
      if (
        event.key === 'Enter' &&
        (object.kind === 'text' || object.kind === 'table' || object.kind === 'video')
      ) {
        event.preventDefault();
        editSelected();
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
      if (event.altKey && object.kind !== 'shape') return false;
      event.preventDefault();
      flushStyle();
      const original = lookup()!;
      if (event.altKey && original.kind === 'shape') {
        const value = cloneShapeObject(original.value);
        value.end.x += offset.x;
        value.end.y += offset.y;
        commit(command(original, { kind: 'shape', value }));
      } else commit(command(original, translate(original, offset)));
      options.redraw();
      return true;
    },
  };
}
export type SelectionController = ReturnType<typeof createSelection>;
