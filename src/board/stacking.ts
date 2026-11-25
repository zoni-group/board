import { cloneContentObject, cloneShapeObject, cloneTextObject } from './model.ts';
import type {
  AtomicCommand,
  BoardCommand,
  BoardObjectRef,
  ContentObject,
  ShapeObject,
  TextObject,
} from './model.ts';
import { inkBounds, isHighlighter } from './ink.ts';
import type { InkObject } from './ink.ts';
import { contentBounds } from './content.ts';
import { shapeBounds } from './shapes.ts';
import { cachedTextLayout } from './text-layout.ts';
import { boundsIntersect, unionBounds } from './viewport.ts';
import type { BoardBounds } from './viewport.ts';

/** The objects a page shows, by kind, each array in creation order. */
export interface StackScene {
  content: readonly ContentObject[];
  strokes: readonly InkObject[];
  shapes: readonly ShapeObject[];
  text: readonly TextObject[];
}

/** One object in the stack, in the same form the selection uses. */
export type StackObject =
  | { kind: 'stroke'; value: InkObject }
  | { kind: 'shape'; value: ShapeObject }
  | { kind: 'text'; value: TextObject }
  | {
      [K in ContentObject['kind']]: { kind: K; value: Extract<ContentObject, { kind: K }> };
    }[ContentObject['kind']];

export type OrderAction = 'front' | 'forward' | 'backward' | 'back';

export const stackKey = (object: { kind: string; value: { id: string } }) =>
  `${object.kind}:${object.value.id}`;
const refKey = (ref: BoardObjectRef) => `${ref.kind}:${ref.id}`;

/** An object's stack position, or undefined for one saved before stacking existed. */
export function zOf(object: StackObject): number | undefined {
  return object.kind === 'stroke' ? object.value.stroke.z : object.value.z;
}

/**
 * Objects saved before stacking keep the old fixed layers: media, highlighter, ink, shapes,
 * then text on top.
 */
function legacyLayer(object: StackObject): number {
  switch (object.kind) {
    case 'stroke':
      return isHighlighter(object.value.stroke) ? 1 : 2;
    case 'shape':
      return 3;
    case 'text':
      return 4;
    default:
      return 0;
  }
}

/**
 * Every object from bottom to top: objects without a stack position first, in the old layers
 * (creation order within each), then the others by position (creation order breaks ties).
 */
export function stackOrder(scene: StackScene): StackObject[] {
  const all: StackObject[] = [
    ...scene.content.map((value) => ({ kind: value.kind, value }) as StackObject),
    ...scene.strokes.map((value): StackObject => ({ kind: 'stroke', value })),
    ...scene.shapes.map((value): StackObject => ({ kind: 'shape', value })),
    ...scene.text.map((value): StackObject => ({ kind: 'text', value })),
  ];
  const legacy: { object: StackObject; layer: number; index: number }[] = [],
    placed: { object: StackObject; z: number; index: number }[] = [];
  all.forEach((object, index) => {
    const z = zOf(object);
    if (z === undefined) legacy.push({ object, layer: legacyLayer(object), index });
    else placed.push({ object, z, index });
  });
  legacy.sort((a, b) => a.layer - b.layer || a.index - b.index);
  placed.sort((a, b) => a.z - b.z || a.index - b.index);
  return [...legacy.map((e) => e.object), ...placed.map((e) => e.object)];
}

/** The position for the next new object: above everything. */
export function topZ(scene: StackScene): number {
  let top = -Infinity;
  for (const object of stackOrder(scene)) {
    const z = zOf(object);
    if (z !== undefined) top = Math.max(top, z);
  }
  return top === -Infinity ? 0 : Math.floor(top) + 1;
}

/** Area an object covers, for "the next object it overlaps". */
export function stackBounds(ctx: CanvasRenderingContext2D, object: StackObject): BoardBounds {
  switch (object.kind) {
    case 'stroke':
      return inkBounds(object.value);
    case 'shape':
      return shapeBounds(object.value);
    case 'text':
      return cachedTextLayout(ctx, object.value).bounds;
    default:
      return contentBounds(ctx, object.value);
  }
}

/** The stack after `action`, or null when it would not change. */
function reordered(
  stack: StackObject[],
  refs: readonly BoardObjectRef[],
  action: OrderAction,
  bounds: (object: StackObject) => BoardBounds
): StackObject[] | null {
  const wanted = new Set(refs.map(refKey));
  const selected = stack.filter((object) => wanted.has(stackKey(object)));
  if (!selected.length) return null;
  const rest = stack.filter((object) => !wanted.has(stackKey(object)));
  let next: StackObject[];
  if (action === 'front') next = [...rest, ...selected];
  else if (action === 'back') next = [...selected, ...rest];
  else {
    const area = selected.map(bounds).reduce((a, b) => unionBounds(a, b));
    const indexes = selected.map((object) => stack.indexOf(object));
    const up = action === 'forward';
    const edge = up ? Math.max(...indexes) : Math.min(...indexes);
    // Past the nearest object it overlaps, so each step shows; otherwise one place.
    const candidates = (up ? stack.slice(edge + 1) : stack.slice(0, edge).reverse()).filter(
      (object) => !wanted.has(stackKey(object))
    );
    const target =
      candidates.find((object) => boundsIntersect(bounds(object), area)) ?? candidates[0];
    if (!target) return null;
    const at = rest.indexOf(target) + (up ? 1 : 0);
    next = [...rest.slice(0, at), ...selected, ...rest.slice(at)];
  }
  return next.every((object, index) => object === stack[index]) ? null : next;
}

/** Whether `action` would change the stack (the Order menu disables the others). */
export function canReorder(
  scene: StackScene,
  refs: readonly BoardObjectRef[],
  action: OrderAction,
  bounds: (object: StackObject) => BoardBounds
): boolean {
  return reordered(stackOrder(scene), refs, action, bounds) !== null;
}

function withZ(object: StackObject, z: number): AtomicCommand {
  switch (object.kind) {
    case 'stroke':
      return { type: 'stroke-edit', id: object.value.id, z };
    case 'shape':
      return { type: 'shape-set', object: { ...cloneShapeObject(object.value), z } };
    case 'text':
      return { type: 'text-set', object: { ...cloneTextObject(object.value), z } };
    default:
      return { type: 'content-set', object: { ...cloneContentObject(object.value), z } };
  }
}

/** Smallest gap kept between positions before the page is renumbered. */
const MIN_GAP = 1e-6;

/**
 * The commands that apply `action` to the selected objects, or null when nothing changes.
 * Only the moved objects change, placed between their new neighbours. Pages with objects saved
 * before stacking, or with positions packed too tight, are renumbered 0…n−1 instead.
 */
export function reorderCommands(
  scene: StackScene,
  refs: readonly BoardObjectRef[],
  action: OrderAction,
  bounds: (object: StackObject) => BoardBounds
): AtomicCommand[] | null {
  const stack = stackOrder(scene);
  const next = reordered(stack, refs, action, bounds);
  if (!next) return null;
  const renumber = () =>
    next.flatMap((object, index) => (zOf(object) === index ? [] : [withZ(object, index)]));
  if (stack.some((object) => zOf(object) === undefined)) return renumber();
  const wanted = new Set(refs.map(refKey));
  const first = next.findIndex((object) => wanted.has(stackKey(object)));
  const count = next.filter((object) => wanted.has(stackKey(object))).length;
  const below = first > 0 ? zOf(next[first - 1]) : undefined,
    above = first + count < next.length ? zOf(next[first + count]) : undefined;
  const positions = Array.from({ length: count }, (_, i) =>
    below !== undefined && above !== undefined
      ? below + ((above - below) * (i + 1)) / (count + 1)
      : below !== undefined
        ? Math.floor(below) + 1 + i
        : above !== undefined
          ? Math.ceil(above) - count + i
          : i
  );
  const gaps = [below, ...positions, above].filter((z) => z !== undefined);
  if (gaps.some((z, i) => i > 0 && z - gaps[i - 1] < MIN_GAP)) return renumber();
  return next.slice(first, first + count).map((object, i) => withZ(object, positions[i]));
}

/**
 * New objects go on top: gives each pen stroke and each set of an object not on the page a
 * position above everything, counting up through a batch. A set for an object already on the
 * page keeps that object's position when it arrives without one (the text editor rebuilds text).
 */
export function stampZ(scene: StackScene, command: BoardCommand): BoardCommand {
  // Keyed like the commands: content-set covers images, videos and tables alike.
  const keyOf = (object: StackObject) =>
    `${object.kind === 'stroke' || object.kind === 'shape' || object.kind === 'text' ? object.kind : 'content'}:${object.value.id}`;
  const known = new Map<string, number | undefined>();
  for (const object of stackOrder(scene)) known.set(keyOf(object), zOf(object));
  let next = topZ(scene);
  const stamp = (atomic: AtomicCommand): AtomicCommand => {
    if (atomic.type === 'stroke')
      return atomic.tool === 'pen' && !known.has(`stroke:${atomic.id}`)
        ? { ...atomic, z: next++ }
        : atomic;
    if (atomic.type !== 'shape-set' && atomic.type !== 'text-set' && atomic.type !== 'content-set')
      return atomic;
    const key = `${atomic.type === 'shape-set' ? 'shape' : atomic.type === 'text-set' ? 'text' : 'content'}:${atomic.object.id}`;
    if (!known.has(key)) {
      // Registered, so a later set of the same new object in this batch keeps its place.
      const z = next++;
      known.set(key, z);
      return { ...atomic, object: { ...atomic.object, z } } as AtomicCommand;
    }
    const z = known.get(key);
    return atomic.object.z === undefined && z !== undefined
      ? ({ ...atomic, object: { ...atomic.object, z } } as AtomicCommand)
      : atomic;
  };
  return command.type === 'batch'
    ? { type: 'batch', commands: command.commands.map(stamp) }
    : command.type === 'clear'
      ? command
      : stamp(command);
}
