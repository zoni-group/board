import { t } from '../i18n.ts';
import {
  cloneShapeObject,
  cloneTextObject,
  cloneContentObject,
  normalizeShapeObject,
} from './model.ts';
import type {
  AtomicCommand,
  BoardCommand,
  BoardObjectRef,
  BoardTool,
  Point,
  SelectMode,
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
  alignToGrid,
  constrainedEnd,
  hitShape,
  hitShapeHandle,
  isBox,
  isFillable,
  shapeBounds,
  shapeHandles,
} from './shapes.ts';
import { fillName, renderFillChip } from './fill-palette.ts';
import type { FillPalette } from './fill-palette.ts';
import {
  boundsIntersect,
  screenToWorld,
  unionBounds,
  visibleBounds,
  worldToScreen,
} from './viewport.ts';
import { boxPolygon, objectsInRegion } from './marquee.ts';
import type { BoardBounds, BoardViewport } from './viewport.ts';
import { panelArea } from './screen-layout.ts';
import { strokeFromInk } from './clipboard.ts';
import { stackOrder } from './stacking.ts';
import type { StackObject } from './stacking.ts';
import type { ClipItem } from './clipboard.ts';

type SelectedObject = StackObject;
interface SelectionOptions {
  canvas: HTMLCanvasElement;
  textContext: CanvasRenderingContext2D;
  scene(): BoardScene;
  view(): BoardViewport;
  tool(): BoardTool;
  /** Select button mode: Box and Lasso draw a region on empty space. */
  mode(): SelectMode;
  editing(): boolean;
  hidden(): boolean;
  redraw(): void;
  commit(command: BoardCommand): Promise<boolean>;
  editObject(ref: BoardObjectRef): void;
  changed(ref: BoardObjectRef | null, style: { size: number; inkRaw: string } | null): void;
  beginGrip(event: PointerEvent, ref: BoardObjectRef): void;
  status(message: string): void;
  fillPalette: FillPalette;
  /** The Duplicate button: copy the selection next to itself. */
  duplicate(): void;
  /** The Order button: opens the stacking menu for these objects. */
  order(button: HTMLElement, refs: BoardObjectRef[]): void;
  /** Closes the stacking menu when the selection bar goes away. */
  closeOrder(): void;
}
type Drag = { id: number; start: Point; latest: Point; original: SelectedObject; handle: number };
type GroupDrag = { id: number; start: Point; latest: Point; originals: SelectedObject[] };
type Marquee = { id: number; mode: 'box' | 'lasso'; start: Point; points: Point[] };
const sameRef = (a: BoardObjectRef | null, b: BoardObjectRef) =>
  a?.kind === b.kind && a.id === b.id;
const objectKey = (object: SelectedObject) => `${object.kind}:${object.value.id}`;
const objectRef = (object: SelectedObject): BoardObjectRef => ({
  kind: object.kind,
  id: object.value.id,
});
const SVG = 'http://www.w3.org/2000/svg';

export function createSelection(options: SelectionOptions) {
  const { canvas } = options;
  let ref: BoardObjectRef | null = null,
    draft: SelectedObject | null = null,
    drag: Drag | null = null;
  let signature = '';
  // A group holds two or more objects selected with Box or Lasso; `ref` is null meanwhile.
  let group: BoardObjectRef[] | null = null,
    groupDraft: Map<string, SelectedObject> | null = null,
    groupDrag: GroupDrag | null = null,
    marquee: Marquee | null = null;
  const marqueeLayer = document.createElementNS(SVG, 'svg');
  marqueeLayer.classList.add('selection-marquee');
  marqueeLayer.setAttribute('aria-hidden', 'true');
  const marqueeShape = document.createElementNS(SVG, 'polygon');
  marqueeLayer.append(marqueeShape);
  marqueeLayer.style.display = 'none';
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
  canvas.parentElement!.append(outline, marqueeLayer);
  const actions = document.createElement('div');
  actions.hidden = true;
  actions.setAttribute('role', 'toolbar');
  const move = document.createElement('button'),
    edit = document.createElement('button'),
    fill = document.createElement('button'),
    duplicate = document.createElement('button'),
    order = document.createElement('button'),
    remove = document.createElement('button'),
    done = document.createElement('button');
  for (const button of [move, edit, fill, duplicate, order, remove, done]) button.type = 'button';
  order.className = 'selection-order';
  order.setAttribute('aria-haspopup', 'menu');
  order.setAttribute('aria-expanded', 'false');
  move.className = 'selection-move';
  duplicate.className = 'selection-duplicate';
  // Fill for a selected closed shape: the chip previews it and opens the fill palette.
  fill.className = 'selection-fill';
  fill.hidden = true;
  fill.setAttribute('aria-haspopup', 'dialog');
  fill.setAttribute('aria-expanded', 'false');
  fill.innerHTML = '<span aria-hidden="true"></span><span></span>';
  actions.append(move, edit, fill, duplicate, order, remove, done);
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
  /** Several object changes become one board operation, so one Undo reverts them together. */
  function commitAll(values: (BoardCommand | null)[]) {
    const commands = values.filter((value): value is AtomicCommand =>
      Boolean(value && value.type !== 'batch' && value.type !== 'clear')
    );
    if (commands.length > 1) commit({ type: 'batch', commands });
    else commit(commands[0] ?? null);
  }
  function groupObjects(): SelectedObject[] {
    return (group ?? [])
      .map((target) => lookup(target))
      .filter((object): object is SelectedObject => object !== null);
  }
  function shownGroupObjects(): SelectedObject[] {
    return groupObjects().map((object) => groupDraft?.get(objectKey(object)) ?? object);
  }
  /** Undo or other edits may remove group members; one left becomes a normal selection. */
  function syncGroup() {
    if (!group) return;
    const objects = groupObjects();
    if (objects.length === group.length) return;
    groupDraft = null;
    groupDrag = null;
    group = objects.length >= 2 ? objects.map(objectRef) : null;
    if (objects.length === 1) ref = objectRef(objects[0]);
  }
  function groupArea(): BoardBounds | null {
    let area: BoardBounds | null = null;
    for (const object of shownGroupObjects()) area = unionBounds(area, bounds(object));
    return area;
  }
  function placeActions(anchor: Point, area: BoardBounds, view: BoardViewport, rect: DOMRect) {
    if (actions.hidden) return;
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
  function paintMarquee() {
    if (!marquee || marquee.points.length < 2) {
      marqueeLayer.style.display = 'none';
      return;
    }
    const rect = canvas.getBoundingClientRect(),
      view = options.view();
    marqueeLayer.style.display = '';
    marqueeLayer.setAttribute('width', String(rect.width));
    marqueeLayer.setAttribute('height', String(rect.height));
    marqueeShape.setAttribute(
      'points',
      marquee.points
        .map((p) => worldToScreen(p, view, rect))
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ')
    );
  }
  function paintGroup() {
    const objects = shownGroupObjects();
    const styled = objects.find((object) => object.kind === 'stroke' || object.kind === 'shape');
    const style =
      styled?.kind === 'stroke'
        ? styled.value.stroke
        : styled?.kind === 'shape'
          ? styled.value
          : null;
    const controlRef = objectRef(styled ?? objects[0]);
    const nextSignature = JSON.stringify([group, options.tool(), style?.size, style?.inkRaw]);
    options.changed(controlRef, null);
    if (!groupDraft && signature !== nextSignature) {
      signature = nextSignature;
      options.changed(controlRef, style);
    }
    const rect = canvas.getBoundingClientRect(),
      view = options.view(),
      area = groupArea();
    outline.hidden = actions.hidden =
      !area ||
      options.editing() ||
      options.hidden() ||
      !boundsIntersect(area, visibleBounds(view, rect));
    if (!area || outline.hidden) return;
    const anchor = worldToScreen(area, view, rect);
    const label = t('objectsSelected', { count: objects.length });
    outline.id = 'groupSelection';
    outline.className = 'object-selection group-selection';
    outline.setAttribute('aria-label', label);
    actions.className = 'object-selection-actions group-selection-actions';
    actions.setAttribute('aria-label', label);
    Object.assign(outline.style, {
      left: `${anchor.x}px`,
      top: `${anchor.y}px`,
      width: `${area.width * view.zoom}px`,
      height: `${area.height * view.zoom}px`,
    });
    handles.forEach((handle) => (handle.hidden = true));
    move.hidden = edit.hidden = fill.hidden = true;
    done.hidden = false;
    actions.hidden ||= Boolean(groupDrag);
    placeActions(anchor, area, view, rect);
  }
  function paint() {
    paintSelection();
    // The fill palette belongs to the shape it was opened for.
    if (fill.getAttribute('aria-expanded') === 'true' && (fill.hidden || actions.hidden))
      options.fillPalette.close();
    if (order.getAttribute('aria-expanded') === 'true' && actions.hidden) options.closeOrder();
  }
  function paintSelection() {
    syncGroup();
    paintMarquee();
    if (group) {
      paintGroup();
      return;
    }
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
    // Every object gets a grip to drag by, for the ones that are thin, small or edit on a tap.
    move.hidden = false;
    edit.hidden = object.kind === 'stroke' || object.kind === 'shape' || object.kind === 'image';
    edit.textContent = t(object.kind === 'video' ? 'playVideo' : 'editText');
    done.hidden = object.kind === 'text' && options.tool() === 'text';
    fill.hidden = !(object.kind === 'shape' && isFillable(object.value.kind));
    if (object.kind === 'shape' && !fill.hidden) {
      renderFillChip(
        fill.firstElementChild as HTMLElement,
        object.value.fill ?? null,
        object.value.inkRaw
      );
      fill.setAttribute(
        'aria-label',
        t('fillWith', { color: fillName(object.value.fill ?? null) })
      );
      fill.title = fill.getAttribute('aria-label')!;
    }
    actions.hidden ||= Boolean(drag);
    placeActions(anchor, area, view, rect);
  }
  function labels() {
    move.textContent = t('moveText');
    edit.textContent = t('editText');
    duplicate.textContent = t('duplicate');
    order.textContent = t('order');
    remove.textContent = t('deleteText');
    fill.lastElementChild!.textContent = t('fill');
    done.textContent = t('doneText');
  }
  labels();
  function flushStyle() {
    if (!groupDrag && groupDraft) {
      const drafts = groupDraft;
      groupDraft = null;
      commitAll(
        groupObjects().map((object) => {
          const next = drafts.get(objectKey(object));
          return next ? command(object, next) : null;
        })
      );
      options.redraw();
    }
    if (drag || !draft) return;
    const original = lookup(),
      next = draft;
    draft = null;
    if (original) commit(command(original, next));
    options.redraw();
  }
  function cancel() {
    if (!drag && !groupDrag && !marquee) return;
    if (drag) draft = null;
    if (groupDrag) groupDraft = null;
    drag = null;
    groupDrag = null;
    marquee = null;
    options.redraw();
  }
  function clear() {
    flushStyle();
    cancel();
    ref = null;
    group = null;
    groupDraft = null;
    paint();
  }
  function select(next: BoardObjectRef | null) {
    if (group || !sameRef(ref, next ?? { kind: 'stroke', id: '' })) flushStyle();
    cancel();
    group = null;
    groupDraft = null;
    ref = next;
    draft = null;
    paint();
  }
  function selectGroup(refs: BoardObjectRef[]) {
    if (refs.length < 2) {
      select(refs[0] ?? null);
      return;
    }
    flushStyle();
    cancel();
    ref = null;
    draft = null;
    group = refs;
    groupDraft = null;
    signature = '';
    canvas.focus({ preventScroll: true });
    options.status(t('objectsSelected', { count: refs.length }));
    paint();
  }
  function beginGroup(event: PointerEvent) {
    flushStyle();
    const originals = groupObjects(),
      p = point(event);
    groupDrag = { id: event.pointerId, start: p, latest: p, originals };
    groupDraft = new Map(originals.map((object) => [objectKey(object), object]));
    canvas.focus({ preventScroll: true });
    paint();
  }
  function updateGroup(p: Point) {
    if (!groupDrag) return;
    groupDrag.latest = p;
    const delta = { x: p.x - groupDrag.start.x, y: p.y - groupDrag.start.y };
    groupDraft = new Map(
      groupDrag.originals.map((object) => [objectKey(object), translate(object, delta)])
    );
    options.redraw();
  }
  function endGroup(event: PointerEvent) {
    if (!groupDrag) return;
    updateGroup(point(event));
    const current = groupDrag,
      drafts = groupDraft;
    groupDrag = null;
    groupDraft = null;
    const distance =
      Math.hypot(current.latest.x - current.start.x, current.latest.y - current.start.y) *
      options.view().zoom;
    if (distance >= 3 && drafts)
      commitAll(
        current.originals.map((object) => {
          const next = drafts.get(objectKey(object));
          return next ? command(object, next) : null;
        })
      );
    options.redraw();
  }
  function endMarquee(event: PointerEvent) {
    if (!marquee) return;
    const current = marquee,
      p = point(event);
    marquee = null;
    const polygon = current.mode === 'box' ? boxPolygon(current.start, p) : [...current.points, p];
    const xs = polygon.map((q) => q.x),
      ys = polygon.map((q) => q.y);
    const extent =
      Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) *
      options.view().zoom;
    // A tiny drag is a tap on empty space.
    if (extent < 4 || polygon.length < 3) {
      clear();
      return;
    }
    const refs = objectsInRegion(options.scene(), polygon, options.textContext);
    if (refs.length) selectGroup(refs);
    else clear();
  }
  function hit(event: MouseEvent & { pointerType?: string }): BoardObjectRef | null {
    const p = point(event),
      zoom = options.view().zoom,
      padding = event.pointerType === 'touch' ? 10 : 6;
    // Top of the stack first: a tap picks what shows on top.
    for (const object of stackOrder(options.scene()).reverse()) {
      const hit =
        object.kind === 'text'
          ? containsPoint(
              cachedTextLayout(options.textContext, object.value).bounds,
              p,
              padding / zoom
            )
          : object.kind === 'shape'
            ? hitShape(object.value, p, padding / zoom)
            : object.kind === 'stroke'
              ? hitInk(object.value, p, zoom, padding)
              : containsPoint(contentBounds(options.textContext, object.value), p, padding / zoom);
      if (hit) return objectRef(object);
    }
    return null;
  }
  function begin(event: PointerEvent, target: BoardObjectRef, handle = -1) {
    flushStyle();
    const original = lookup(target);
    if (!original) return;
    group = null;
    groupDraft = null;
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
      draft = { kind: 'shape', value: alignToGrid(value) };
    } else if (drag.handle >= 0 && (original.kind === 'image' || original.kind === 'video')) {
      const value = resizeMedia(original.value, drag.handle, p);
      draft = { kind: value.kind, value } as SelectedObject;
    } else {
      draft = translate(original, { x: p.x - drag.start.x, y: p.y - drag.start.y });
      // Number lines and axes on grid paper move in whole grid steps.
      if (draft.kind === 'shape') draft = { kind: 'shape', value: alignToGrid(draft.value) };
    }
    options.redraw();
  }
  function end(event: PointerEvent) {
    if (groupDrag?.id === event.pointerId) {
      endGroup(event);
      return;
    }
    if (marquee?.id === event.pointerId) {
      endMarquee(event);
      return;
    }
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
    if (group) {
      const ids: Record<
        'stroke-delete' | 'shape-delete' | 'text-delete' | 'content-delete',
        string[]
      > = { 'stroke-delete': [], 'shape-delete': [], 'text-delete': [], 'content-delete': [] };
      for (const object of groupObjects())
        ids[
          object.kind === 'stroke'
            ? 'stroke-delete'
            : object.kind === 'shape'
              ? 'shape-delete'
              : object.kind === 'text'
                ? 'text-delete'
                : 'content-delete'
        ].push(object.value.id);
      group = null;
      groupDraft = null;
      groupDrag = null;
      commitAll(
        (Object.keys(ids) as (keyof typeof ids)[])
          .filter((type) => ids[type].length)
          .map((type) => ({ type, ids: ids[type] }))
      );
      options.redraw();
      canvas.focus({ preventScroll: true });
      return;
    }
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
  function nudgeGroup(offset: Point) {
    flushStyle();
    commitAll(groupObjects().map((object) => command(object, translate(object, offset))));
    options.redraw();
  }
  edit.addEventListener('click', editSelected);
  remove.addEventListener('click', removeSelected);
  duplicate.addEventListener('click', () => options.duplicate());
  order.addEventListener('click', () => {
    flushStyle();
    const refs = selectedRefs();
    if (refs.length) options.order(order, refs);
  });
  function selectedRefs(): BoardObjectRef[] {
    return group ? groupObjects().map(objectRef) : lookup() ? [ref!] : [];
  }
  fill.addEventListener('click', () => {
    flushStyle();
    const original = lookup();
    if (original?.kind !== 'shape') return;
    const id = original.value.id;
    options.fillPalette.toggle(fill, original.value.fill ?? null, original.value.inkRaw, (next) => {
      const current = lookup({ kind: 'shape', id });
      if (current?.kind !== 'shape') return;
      const value = cloneShapeObject(current.value);
      delete value.fill;
      if (next) value.fill = { ...next };
      commit(command(current, { kind: 'shape', value }));
      options.redraw();
    });
  });
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
    /** Number of selected objects (a group counts each member). */
    count: () => (group ? groupObjects().length : lookup() ? 1 : 0),
    select,
    /** Selects these objects: one on its own, several as a group. */
    selectAll(refs: BoardObjectRef[]) {
      if (refs.length > 1) selectGroup(refs);
      else select(refs[0] ?? null);
    },
    /** Copies of the selected objects, in paint order, and the area they cover. */
    snapshot(): { items: ClipItem[]; bounds: BoardBounds } | null {
      flushStyle();
      // Stack order, so overlapping copies stack like the originals.
      const stack = stackOrder(options.scene()).map(objectKey);
      const order = (object: SelectedObject) => stack.indexOf(objectKey(object));
      const objects = (group ? groupObjects() : [lookup()].filter((o) => o !== null)).sort(
        (a, b) => order(a) - order(b)
      );
      if (!objects.length) return null;
      const items = objects.map((object): ClipItem => {
        switch (object.kind) {
          case 'stroke':
            return { kind: 'stroke', value: strokeFromInk(object.value) };
          case 'shape':
            return { kind: 'shape', value: cloneShapeObject(object.value) };
          case 'text':
            return { kind: 'text', value: cloneTextObject(object.value) };
          default:
            return { kind: 'content', value: cloneContentObject(object.value) };
        }
      });
      return { items, bounds: objects.map(bounds).reduce(unionBounds) };
    },
    /** The selected objects (each member of a group). */
    refs: selectedRefs,
    /** Deletes the selection (Cut). */
    removeSelected,
    clear,
    paint,
    begin,
    cancel,
    flushStyle,
    isDragging: () => Boolean(drag || groupDrag || marquee),
    start(event: PointerEvent) {
      const p = point(event),
        padding = (event.pointerType === 'touch' ? 10 : 4) / options.view().zoom;
      if (group) {
        const area = groupArea();
        if (area && containsPoint(area, p, padding)) {
          beginGroup(event);
          return;
        }
      }
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
      if (target) {
        begin(event, target, handle);
        return;
      }
      clear();
      const mode = options.mode();
      if (mode === 'box' || mode === 'lasso') {
        marquee = { id: event.pointerId, mode, start: p, points: [p] };
        canvas.focus({ preventScroll: true });
      }
    },
    move(event: PointerEvent) {
      if (drag?.id === event.pointerId) update(point(event), event.shiftKey);
      else if (groupDrag?.id === event.pointerId) updateGroup(point(event));
      else if (marquee?.id === event.pointerId) {
        const p = point(event);
        if (marquee.mode === 'box') marquee.points = boxPolygon(marquee.start, p);
        else {
          const last = marquee.points[marquee.points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) * options.view().zoom >= 2)
            marquee.points.push(p);
        }
        paintMarquee();
      }
    },
    end,
    displayStroke(object: InkObject): InkObject {
      const grouped = groupDraft?.get(`stroke:${object.id}`);
      if (grouped?.kind === 'stroke') return grouped.value;
      return draft?.kind === 'stroke' && draft.value.id === object.id ? draft.value : object;
    },
    displayShape(object: ShapeObject): ShapeObject {
      const grouped = groupDraft?.get(`shape:${object.id}`);
      if (grouped?.kind === 'shape') return grouped.value;
      return draft?.kind === 'shape' && draft.value.id === object.id ? draft.value : object;
    },
    displayText(object: TextObject): TextObject {
      const grouped = groupDraft?.get(`text:${object.id}`);
      if (grouped?.kind === 'text') return grouped.value;
      return draft?.kind === 'text' && draft.value.id === object.id ? draft.value : object;
    },
    displayContent(object: ContentObject): ContentObject {
      const grouped = groupDraft?.get(`${object.kind}:${object.id}`);
      if (grouped && grouped.kind === object.kind) return grouped.value as ContentObject;
      return (draft?.kind === 'image' || draft?.kind === 'video' || draft?.kind === 'table') &&
        draft.value.id === object.id
        ? draft.value
        : object;
    },
    updateStyle(style: Partial<Pick<ShapeObject, 'size' | 'inkRaw'>>) {
      if (drag || groupDrag || options.editing()) return;
      if (group) {
        const drafts = new Map(groupDraft ?? []);
        let changed = false;
        for (const object of groupObjects()) {
          const base = drafts.get(objectKey(object)) ?? object;
          if (base.kind === 'stroke') {
            drafts.set(objectKey(object), {
              kind: 'stroke',
              value: { ...base.value, stroke: { ...base.value.stroke, ...style } },
            });
            changed = true;
          } else if (base.kind === 'shape') {
            drafts.set(objectKey(object), { kind: 'shape', value: { ...base.value, ...style } });
            changed = true;
          }
        }
        if (!changed) return;
        groupDraft = drafts;
        options.redraw();
        return;
      }
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
        if (drag || groupDrag || marquee) cancel();
        else clear();
        return true;
      }
      if (groupDrag || marquee) return false;
      if (drag) {
        if (event.key === 'Shift') {
          update(drag.latest, true);
          return true;
        }
        return false;
      }
      const step = event.shiftKey ? 10 : 1;
      if (group) {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          removeSelected();
          return true;
        }
        const groupOffset = (
          {
            ArrowLeft: { x: -step, y: 0 },
            ArrowRight: { x: step, y: 0 },
            ArrowUp: { x: 0, y: -step },
            ArrowDown: { x: 0, y: step },
          } as Record<string, Point>
        )[event.key];
        if (!groupOffset || event.altKey) return false;
        event.preventDefault();
        nudgeGroup(groupOffset);
        return true;
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
      // On grid paper, a number line or axes moves one grid step (axes resize by two, to keep
      // the origin on the grid).
      const gridStep = original.kind === 'shape' ? original.value.step : undefined;
      if (gridStep) {
        const scale =
          (event.altKey && original.kind === 'shape' && original.value.kind === 'axes' ? 2 : 1) *
          gridStep;
        offset.x = Math.sign(offset.x) * scale;
        offset.y = Math.sign(offset.y) * scale;
      }
      if (event.altKey && original.kind === 'shape') {
        const value = cloneShapeObject(original.value);
        value.end.x += offset.x;
        value.end.y += offset.y;
        commit(command(original, { kind: 'shape', value: alignToGrid(value) }));
      } else {
        const next = translate(original, offset);
        commit(
          command(
            original,
            next.kind === 'shape' ? { kind: 'shape', value: alignToGrid(next.value) } : next
          )
        );
      }
      options.redraw();
      return true;
    },
  };
}
export type SelectionController = ReturnType<typeof createSelection>;
