import { assertNever, BOX_SHAPES, expandCommands, FILLABLE_SHAPES } from './model.ts';
import type { BoardCommand, Point, ShapeKind, ShapeObject } from './model.ts';
import { boundsIntersect } from './viewport.ts';
import type { BoardBounds } from './viewport.ts';

export function resolveShapes(commands: readonly BoardCommand[]): ShapeObject[] {
  const objects = new Map<string, ShapeObject>();
  for (const command of expandCommands(commands)) {
    switch (command.type) {
      case 'clear':
        objects.clear();
        break;
      case 'shape-set':
        objects.set(command.object.id, command.object);
        break;
      case 'shape-delete':
        command.ids.forEach((id) => objects.delete(id));
        break;
      case 'stroke':
        if (command.tool === 'eraser') command.erasedShapeIds?.forEach((id) => objects.delete(id));
        break;
      case 'text-set':
      case 'text-delete':
      case 'stroke-edit':
      case 'stroke-delete':
      case 'content-set':
      case 'content-delete':
        break;
      default:
        assertNever(command);
    }
  }
  return [...objects.values()];
}

export function isBox(kind: ShapeKind): boolean {
  return BOX_SHAPES.includes(kind);
}

export function isFillable(kind: ShapeKind): boolean {
  return FILLABLE_SHAPES.includes(kind);
}

export function boxBounds(shape: ShapeObject): BoardBounds {
  return {
    x: Math.min(shape.start.x, shape.end.x),
    y: Math.min(shape.start.y, shape.end.y),
    width: Math.abs(shape.end.x - shape.start.x),
    height: Math.abs(shape.end.y - shape.start.y),
  };
}

/** Shift: equal box sides, or line angles in 45-degree increments. */
export function constrainedEnd(
  kind: ShapeKind,
  start: Point,
  end: Point,
  constrain: boolean
): Point {
  if (!constrain) return { ...end };
  const dx = end.x - start.x,
    dy = end.y - start.y;
  if (isBox(kind)) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + (dx < 0 ? -size : size), y: start.y + (dy < 0 ? -size : size) };
  }
  const length = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + length * Math.cos(angle), y: start.y + length * Math.sin(angle) };
}

/** The two short lines of an arrowhead at `tip`, pointing away from `tail`. */
function wingsAt(tip: Point, tail: Point, size: number): [Point, Point] {
  const dx = tip.x - tail.x,
    dy = tip.y - tail.y;
  const length = Math.hypot(dx, dy);
  const head = Math.min(length * 0.45, Math.max(12, size * 3));
  const angle = Math.atan2(dy, dx);
  return [-1, 1].map((sign) => ({
    x: tip.x - head * Math.cos(angle + (sign * Math.PI) / 6),
    y: tip.y - head * Math.sin(angle + (sign * Math.PI) / 6),
  })) as [Point, Point];
}

/** The nearest grid point; grids start at the board origin. */
export function snapToGrid(point: Point, step: number): Point {
  return { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step };
}

/**
 * Keeps a number line or axes drawn on grid paper on the grid: number line ends on grid points,
 * axes with a grid corner and an even number of cells each way, so the origin is a grid point.
 * Shapes without a `step` are returned unchanged.
 */
export function alignToGrid(shape: ShapeObject): ShapeObject {
  const step = shape.step;
  if (!step || (shape.kind !== 'numberLine' && shape.kind !== 'axes')) return shape;
  const start = snapToGrid(shape.start, step);
  if (shape.kind === 'numberLine') {
    let end = snapToGrid(shape.end, step);
    // A nearly level or upright drag becomes exactly level or upright, along a grid line.
    const dx = shape.end.x - shape.start.x,
      dy = shape.end.y - shape.start.y;
    const nearly = Math.tan(Math.PI / 12);
    if (Math.abs(dy) <= Math.abs(dx) * nearly) end.y = start.y;
    else if (Math.abs(dx) <= Math.abs(dy) * nearly) end.x = start.x;
    if (end.x === start.x && end.y === start.y) {
      // Too short to snap apart: keep one step in the drag direction.
      end =
        Math.abs(dx) >= Math.abs(dy)
          ? { x: start.x + (dx < 0 ? -step : step), y: start.y }
          : { x: start.x, y: start.y + (dy < 0 ? -step : step) };
    }
    return { ...shape, start, end };
  }
  const even = (from: number, to: number) => {
    const cells = Math.max(1, Math.round(Math.abs(to - from) / (step * 2)));
    return from + (to < from ? -1 : 1) * cells * step * 2;
  };
  return { ...shape, start, end: { x: even(start.x, shape.end.x), y: even(start.y, shape.end.y) } };
}

export function arrowWings(shape: ShapeObject): [Point, Point] {
  return wingsAt(shape.end, shape.start, shape.size);
}

type Segment = readonly [Point, Point];
const wingSegments = (tip: Point, tail: Point, size: number): Segment[] =>
  wingsAt(tip, tail, size).map((wing): Segment => [tip, wing]);
/** Even ticks across a line from `a` to `b`, kept clear of the arrowheads at both ends. */
function ticksAlong(a: Point, b: Point, size: number, count: number): Segment[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length || count < 1) return [];
  const ux = (b.x - a.x) / length,
    uy = (b.y - a.y) / length;
  const half = Math.max(6, size * 2.5);
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    return [
      { x: p.x - uy * half, y: p.y + ux * half },
      { x: p.x + uy * half, y: p.y - ux * half },
    ] as Segment;
  });
}
const TICK_SPACING = 40;
const arrowMargin = (length: number, size: number) =>
  Math.min(length * 0.2, Math.max(16, size * 4));
/**
 * Ticks every `step` from `from` toward `to` (the grid spacing), from `first` steps out and
 * clear of the arrowhead at `to`, so each one sits on a grid line or dot.
 */
function gridTicks(from: Point, to: Point, size: number, step: number, first: number): Segment[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!length) return [];
  const last = Math.floor((length - arrowMargin(length, size)) / step + 1e-6);
  const ux = (to.x - from.x) / length,
    uy = (to.y - from.y) / length;
  // Short enough not to crowd small cells.
  const half = Math.min(Math.max(6, size * 2.5), step * 0.4);
  const ticks: Segment[] = [];
  for (let k = first; k <= last; k++) {
    const p = { x: from.x + ux * step * k, y: from.y + uy * step * k };
    ticks.push([
      { x: p.x - uy * half, y: p.y + ux * half },
      { x: p.x + uy * half, y: p.y - ux * half },
    ]);
  }
  return ticks;
}
/** The part of a line that carries ticks, leaving room for an arrowhead at each end. */
function inset(a: Point, b: Point, size: number, both: boolean): [Point, Point] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const margin = arrowMargin(length, size);
  const ux = (b.x - a.x) / (length || 1),
    uy = (b.y - a.y) / (length || 1);
  return [
    both ? { x: a.x + ux * margin, y: a.y + uy * margin } : { ...a },
    { x: b.x - ux * margin, y: b.y - uy * margin },
  ];
}

/** Open shapes: every line that is drawn, as segments. */
function openSegments(shape: ShapeObject): Segment[] {
  const { start, end, size } = shape;
  switch (shape.kind) {
    case 'line':
      return [[start, end]];
    case 'arrow':
      return [[start, end], ...wingSegments(end, start, size)];
    case 'numberLine': {
      if (shape.step) {
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const first = Math.ceil(arrowMargin(length, size) / shape.step - 1e-6);
        return [
          [start, end],
          ...wingSegments(end, start, size),
          ...wingSegments(start, end, size),
          ...gridTicks(start, end, size, shape.step, first),
        ];
      }
      const [a, b] = inset(start, end, size, true);
      const count = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / TICK_SPACING));
      return [
        [start, end],
        ...wingSegments(end, start, size),
        ...wingSegments(start, end, size),
        ...ticksAlong(a, b, size, count),
      ];
    }
    case 'axes': {
      const { x, y, width, height } = boxBounds(shape);
      const center = { x: x + width / 2, y: y + height / 2 };
      const left = { x, y: center.y },
        right = { x: x + width, y: center.y },
        bottom = { x: center.x, y: y + height },
        top = { x: center.x, y };
      const segments: Segment[] = [
        [left, right],
        [bottom, top],
        // Arrowheads at both ends of each axis.
        ...wingSegments(right, left, size),
        ...wingSegments(left, right, size),
        ...wingSegments(top, bottom, size),
        ...wingSegments(bottom, top, size),
      ];
      // Ticks step out from the origin; the origin itself has none.
      for (const [from, to] of [
        [center, right],
        [center, left],
        [center, top],
        [center, bottom],
      ] as const) {
        if (shape.step) {
          segments.push(...gridTicks(from, to, size, shape.step, 1));
          continue;
        }
        const [, last] = inset(from, to, size, false);
        const steps = Math.max(
          1,
          Math.round(Math.hypot(last.x - from.x, last.y - from.y) / TICK_SPACING)
        );
        segments.push(...ticksAlong(from, last, size, steps).slice(1));
      }
      return segments;
    }
    default:
      return [];
  }
}

function arc(cx: number, cy: number, r: number, from: number, to: number, count: number): Point[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = from + ((to - from) * i) / count;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}
/** Closed shapes as a polygon, within `tolerance` of the true outline. */
function closedPolygon(shape: ShapeObject, tolerance: number): Point[] {
  const { x, y, width, height } = boxBounds(shape);
  const steps = (radius: number, turn: number) =>
    radius <= 0
      ? 1
      : Math.min(
          4096,
          Math.max(4, Math.ceil(turn / (2 * Math.acos(Math.max(-1, 1 - tolerance / radius)))))
        );
  switch (shape.kind) {
    case 'rectangle':
      return [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
    case 'triangle':
      return [
        { x: x + width / 2, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
    case 'ellipse': {
      const count = Math.max(16, steps(Math.max(width, height) / 2, Math.PI * 2));
      return arc(x + width / 2, y + height / 2, 1, 0, Math.PI * 2, count)
        .slice(0, -1)
        .map((p) => ({
          x: x + width / 2 + (p.x - x - width / 2) * (width / 2),
          y: y + height / 2 + (p.y - y - height / 2) * (height / 2),
        }));
    }
    case 'speechBubble': {
      // A rounded body over the top of the box and a tail down to the bottom-left corner.
      const body = height * 0.78;
      const r = Math.min(width, body) * 0.22;
      const n = steps(r, Math.PI / 2);
      const bottom = y + body;
      return [
        ...arc(x + width - r, y + r, r, -Math.PI / 2, 0, n),
        ...arc(x + width - r, bottom - r, r, 0, Math.PI / 2, n),
        { x: x + width * 0.38, y: bottom },
        { x: x + width * 0.08, y: y + height },
        { x: x + width * 0.18, y: bottom },
        ...arc(x + r, bottom - r, r, Math.PI / 2, Math.PI, n),
        ...arc(x + r, y + r, r, Math.PI, (Math.PI * 3) / 2, n),
      ];
    }
    default:
      return [];
  }
}

function outline(shape: ShapeObject, tolerance: number): Segment[] {
  if (!isFillable(shape.kind)) return openSegments(shape);
  const points = closedPolygon(shape, tolerance);
  return points.map((point, i): Segment => [point, points[(i + 1) % points.length]]);
}

function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function insideShape(shape: ShapeObject, point: Point): boolean {
  if (!isFillable(shape.kind)) return false;
  if (shape.kind === 'ellipse') {
    const box = boxBounds(shape);
    return (
      ((point.x - box.x - box.width / 2) / (box.width / 2)) ** 2 +
        ((point.y - box.y - box.height / 2) / (box.height / 2)) ** 2 <=
      1
    );
  }
  return insidePolygon(point, closedPolygon(shape, 0.5));
}

export function shapeBounds(shape: ShapeObject): BoardBounds {
  const points = isBox(shape.kind) ? [shape.start, shape.end] : openSegments(shape).flat();
  // Axes ticks and arrowheads can reach past the box.
  if (shape.kind === 'axes') points.push(...openSegments(shape).flat());
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  const pad = shape.size / 2;
  return {
    x: left - pad,
    y: top - pad,
    width: right - left + pad * 2,
    height: bottom - top + pad * 2,
  };
}

/** A light fill is see-through, so the outline and writing on top stay readable. */
export const LIGHT_FILL_ALPHA = 0.3;

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeObject,
  ink: (raw: string) => string
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  const box = boxBounds(shape);
  switch (shape.kind) {
    case 'rectangle':
      ctx.rect(box.x, box.y, box.width, box.height);
      break;
    case 'ellipse':
      ctx.ellipse(
        box.x + box.width / 2,
        box.y + box.height / 2,
        box.width / 2,
        box.height / 2,
        0,
        0,
        Math.PI * 2
      );
      break;
    case 'triangle':
    case 'speechBubble': {
      const [first, ...rest] = closedPolygon(shape, 0.25);
      ctx.moveTo(first.x, first.y);
      for (const p of rest) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      break;
    }
    case 'line':
    case 'arrow':
    case 'numberLine':
    case 'axes':
      for (const [a, b] of openSegments(shape)) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      break;
    default:
      assertNever(shape.kind);
  }
  if (shape.fill && isFillable(shape.kind)) {
    const color = shape.fill.color === 'outline' ? shape.inkRaw : shape.fill.color;
    ctx.globalAlpha = shape.fill.solid ? 1 : LIGHT_FILL_ALPHA;
    ctx.fillStyle = shape.fill.solid ? ink(color) : color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = ink(shape.inkRaw);
  ctx.lineWidth = shape.size;
  ctx.stroke();
  ctx.restore();
}

function pointDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t =
    dx || dy
      ? Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))
        )
      : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b)
  );
}

/**
 * Hit-test the outline with a swept eraser. An empty interior does not erase a shape; a
 * filled one does, since the fill is what you see.
 */
export function intersectsShape(
  shape: ShapeObject,
  from: Point,
  to: Point,
  radius: number
): boolean {
  const bounds = shapeBounds(shape);
  if (
    !boundsIntersect(bounds, {
      x: Math.min(from.x, to.x) - radius,
      y: Math.min(from.y, to.y) - radius,
      width: Math.abs(to.x - from.x) + radius * 2,
      height: Math.abs(to.y - from.y) + radius * 2,
    })
  )
    return false;
  if (shape.fill && (insideShape(shape, from) || insideShape(shape, to))) return true;
  const error = shape.kind === 'ellipse' ? Math.min(0.25, (radius + shape.size / 2) / 4) : 0;
  return outline(shape, error).some(
    ([a, b]) => segmentDistance(from, to, a, b) <= radius + shape.size / 2 + error
  );
}

/** Closed shapes are picked up anywhere inside; open ones on their lines. */
export function hitShape(shape: ShapeObject, point: Point, padding: number): boolean {
  if (insideShape(shape, point)) return true;
  return intersectsShape({ ...shape, fill: undefined }, point, point, padding);
}

export function shapeHandles(shape: ShapeObject): Point[] {
  if (!isBox(shape.kind)) return [shape.start, shape.end];
  const { x, y, width, height } = boxBounds(shape);
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

export function hitShapeHandle(shape: ShapeObject, point: Point, padding: number): number {
  const bounds = boxBounds(shape);
  const spacing = isBox(shape.kind)
    ? Math.min(bounds.width, bounds.height)
    : Math.hypot(bounds.width, bounds.height);
  // Leave the center available for movement even when touch targets overlap on small shapes.
  const radius = Math.min(padding, spacing / 3);
  let closest = -1,
    distance = radius;
  shapeHandles(shape).forEach((handle, index) => {
    const next = Math.hypot(handle.x - point.x, handle.y - point.y);
    if (next <= distance) {
      closest = index;
      distance = next;
    }
  });
  return closest;
}
