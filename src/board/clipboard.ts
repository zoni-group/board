import { cloneContentObject, cloneShapeObject, cloneTextObject } from './model.ts';
import type {
  AtomicCommand,
  BoardObjectRef,
  ContentObject,
  PenStrokeCommand,
  Point,
  ShapeObject,
  TextObject,
} from './model.ts';
import type { InkObject } from './ink.ts';
import { alignToGrid } from './shapes.ts';
import { boundsIntersect } from './viewport.ts';
import type { BoardBounds } from './viewport.ts';

/** A copied object, self-contained: ink carries its moves, colour and erased parts. */
export type ClipItem =
  | { kind: 'stroke'; value: PenStrokeCommand }
  | { kind: 'shape'; value: ShapeObject }
  | { kind: 'text'; value: TextObject }
  | { kind: 'content'; value: ContentObject };

/** How far a duplicate or a repeated paste lands from the one before, in board units. */
export const COPY_OFFSET = 24;

/** The pen stroke an ink object shows now: moved, recoloured and with its erased parts. */
export function strokeFromInk(object: InkObject): PenStrokeCommand {
  const { x, y } = object.offset;
  const move = (p: Point) => ({ x: p.x + x, y: p.y + y });
  // Erased parts are all in object.erasures, including any the stroke was copied with.
  const stroke = { ...object.stroke };
  delete stroke.erasures;
  return {
    ...stroke,
    points: stroke.points.map(move),
    ...(stroke.pressure ? { pressure: [...stroke.pressure] } : {}),
    ...(object.erasures.length
      ? {
          erasures: object.erasures.map((mask) => ({
            size: mask.size,
            points: mask.points.map(move),
          })),
        }
      : {}),
  };
}

/** The grid step the copies keep: the largest step among number lines and axes, if any. */
export function gridStepOf(items: readonly ClipItem[]): number | null {
  let step = 0;
  for (const item of items) if (item.kind === 'shape') step = Math.max(step, item.value.step ?? 0);
  return step || null;
}

/** The step between copies: 24 units, or whole grid steps so number lines and axes stay aligned. */
export function copyOffset(items: readonly ClipItem[]): number {
  const step = gridStepOf(items);
  return step ? step * Math.max(1, Math.round(COPY_OFFSET / step)) : COPY_OFFSET;
}

/** A move rounded to whole grid steps when the copies include grid-aligned shapes. */
export function snapDelta(items: readonly ClipItem[], delta: Point): Point {
  const step = gridStepOf(items);
  return step
    ? { x: Math.round(delta.x / step) * step || 0, y: Math.round(delta.y / step) * step || 0 }
    : delta;
}

/**
 * Where a paste goes: the next step of the cascade while that spot is in view, otherwise
 * centred in the view. `count` is how many copies were placed before (1 for the first paste).
 */
export function pasteDelta(
  items: readonly ClipItem[],
  bounds: BoardBounds,
  visible: BoardBounds,
  count: number
): Point {
  const offset = copyOffset(items) * count;
  const cascade = { ...bounds, x: bounds.x + offset, y: bounds.y + offset };
  if (boundsIntersect(cascade, visible)) return { x: offset, y: offset };
  return centerDelta(items, bounds, visible);
}

/** The move that centres `bounds` in the view (in whole grid steps for grid shapes). */
export function centerDelta(
  items: readonly ClipItem[],
  bounds: BoardBounds,
  visible: BoardBounds
): Point {
  return snapDelta(items, {
    x: visible.x + visible.width / 2 - (bounds.x + bounds.width / 2),
    y: visible.y + visible.height / 2 - (bounds.y + bounds.height / 2),
  });
}

function moveItem(item: ClipItem, delta: Point, id: string): ClipItem {
  const move = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  switch (item.kind) {
    case 'stroke': {
      const value = item.value;
      return {
        kind: 'stroke',
        value: {
          ...value,
          id,
          points: value.points.map(move),
          ...(value.pressure ? { pressure: [...value.pressure] } : {}),
          ...(value.erasures
            ? {
                erasures: value.erasures.map((mask) => ({
                  size: mask.size,
                  points: mask.points.map(move),
                })),
              }
            : {}),
        },
      };
    }
    case 'shape': {
      const value = cloneShapeObject(item.value);
      value.id = id;
      value.start = move(value.start);
      value.end = move(value.end);
      return { kind: 'shape', value: alignToGrid(value) };
    }
    case 'text': {
      const value = cloneTextObject(item.value);
      value.id = id;
      value.position = move(value.position);
      return { kind: 'text', value };
    }
    case 'content': {
      const value = cloneContentObject(item.value);
      value.id = id;
      value.position = move(value.position);
      return { kind: 'content', value };
    }
  }
}

/** A deep copy of the items, e.g. to keep in the clipboard. */
export function cloneItems(items: readonly ClipItem[]): ClipItem[] {
  return items.map((item) =>
    item.kind === 'stroke'
      ? moveItem(item, { x: 0, y: 0 }, item.value.id)
      : item.kind === 'shape'
        ? { kind: 'shape', value: cloneShapeObject(item.value) }
        : item.kind === 'text'
          ? { kind: 'text', value: cloneTextObject(item.value) }
          : { kind: 'content', value: cloneContentObject(item.value) }
  );
}

/**
 * The commands that add copies of `items` moved by `delta`, each with a new id, and the refs
 * that select them. Commit them as one batch so a single Undo removes them all.
 */
export function placeCopies(
  items: readonly ClipItem[],
  delta: Point,
  newId: () => string = () => crypto.randomUUID()
): { commands: AtomicCommand[]; refs: BoardObjectRef[] } {
  const commands: AtomicCommand[] = [],
    refs: BoardObjectRef[] = [];
  for (const item of items) {
    const copy = moveItem(item, delta, newId());
    switch (copy.kind) {
      case 'stroke':
        commands.push(copy.value);
        refs.push({ kind: 'stroke', id: copy.value.id });
        break;
      case 'shape':
        commands.push({ type: 'shape-set', object: copy.value });
        refs.push({ kind: 'shape', id: copy.value.id });
        break;
      case 'text':
        commands.push({ type: 'text-set', object: copy.value });
        refs.push({ kind: 'text', id: copy.value.id });
        break;
      case 'content':
        commands.push({ type: 'content-set', object: copy.value });
        refs.push({ kind: copy.value.kind, id: copy.value.id });
        break;
    }
  }
  return { commands, refs };
}

/** The stored media the items show (images and device videos). */
export function itemAssetIds(items: readonly ClipItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'content') continue;
    const value = item.value;
    if (value.kind === 'image') ids.add(value.assetId);
    else if (value.kind === 'video' && value.source.kind === 'local') ids.add(value.source.assetId);
  }
  return [...ids];
}

/** The items with their media pointed at other stored copies (pasting into another board). */
export function withAssetIds(items: readonly ClipItem[], ids: ReadonlyMap<string, string>) {
  return items.map((item): ClipItem => {
    if (item.kind !== 'content') return item;
    const value = cloneContentObject(item.value);
    if (value.kind === 'image') value.assetId = ids.get(value.assetId) ?? value.assetId;
    else if (value.kind === 'video' && value.source.kind === 'local')
      value.source.assetId = ids.get(value.source.assetId) ?? value.source.assetId;
    return { kind: 'content', value };
  });
}
