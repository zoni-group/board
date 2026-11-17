import { assertNever } from './model.ts';
import type { BoardCommand, Point, ShapeKind, ShapeObject } from './model.ts';
import { boundsIntersect } from './viewport.ts';
import type { BoardBounds } from './viewport.ts';

export function resolveShapes(commands: readonly BoardCommand[]): ShapeObject[] {
  const objects = new Map<string, ShapeObject>();
  for (const command of commands) {
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
        break;
      default:
        assertNever(command);
    }
  }
  return [...objects.values()];
}

export function isBox(kind: ShapeKind): boolean {
  return kind === 'rectangle' || kind === 'ellipse';
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

export function arrowWings(shape: ShapeObject): [Point, Point] {
  const dx = shape.end.x - shape.start.x,
    dy = shape.end.y - shape.start.y;
  const length = Math.hypot(dx, dy);
  const head = Math.min(length * 0.45, Math.max(12, shape.size * 3));
  const angle = Math.atan2(dy, dx);
  return [-1, 1].map((sign) => ({
    x: shape.end.x - head * Math.cos(angle + (sign * Math.PI) / 6),
    y: shape.end.y - head * Math.sin(angle + (sign * Math.PI) / 6),
  })) as [Point, Point];
}

export function shapeBounds(shape: ShapeObject): BoardBounds {
  const points = [shape.start, shape.end, ...(shape.kind === 'arrow' ? arrowWings(shape) : [])];
  const left = Math.min(...points.map((p) => p.x)) - shape.size / 2;
  const top = Math.min(...points.map((p) => p.y)) - shape.size / 2;
  return {
    x: left,
    y: top,
    width: Math.max(...points.map((p) => p.x)) + shape.size / 2 - left,
    height: Math.max(...points.map((p) => p.y)) + shape.size / 2 - top,
  };
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeObject,
  ink: (raw: string) => string
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = ink(shape.inkRaw);
  ctx.lineWidth = shape.size;
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
    case 'line':
    case 'arrow':
      ctx.moveTo(shape.start.x, shape.start.y);
      ctx.lineTo(shape.end.x, shape.end.y);
      if (shape.kind === 'arrow') {
        for (const wing of arrowWings(shape)) {
          ctx.moveTo(shape.end.x, shape.end.y);
          ctx.lineTo(wing.x, wing.y);
        }
      }
      break;
    default:
      assertNever(shape.kind);
  }
  ctx.stroke();
  ctx.restore();
}

type Segment = readonly [Point, Point];
function outline(shape: ShapeObject, tolerance: number): Segment[] {
  const { x, y, width, height } = boxBounds(shape);
  if (shape.kind === 'rectangle') {
    const corners = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
    return corners.map((point, i) => [point, corners[(i + 1) % 4]]);
  }
  if (shape.kind === 'ellipse') {
    // Chords stay within tolerance of the true outline (also for very thin ellipses).
    const radius = Math.max(width, height) / 2;
    const count = Math.min(
      4096,
      Math.max(16, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / radius))))
    );
    const points = Array.from({ length: count }, (_, i) => ({
      x: x + width / 2 + (width / 2) * Math.cos((i * Math.PI * 2) / count),
      y: y + height / 2 + (height / 2) * Math.sin((i * Math.PI * 2) / count),
    }));
    return points.map((point, i) => [point, points[(i + 1) % count]]);
  }
  return [
    [shape.start, shape.end],
    ...(shape.kind === 'arrow' ? arrowWings(shape).map((p): Segment => [shape.end, p]) : []),
  ];
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

/** Hit-test the outline with a swept eraser; empty interiors do not erase objects. */
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
  const error = shape.kind === 'ellipse' ? Math.min(0.25, (radius + shape.size / 2) / 4) : 0;
  return outline(shape, error).some(
    ([a, b]) => segmentDistance(from, to, a, b) <= radius + shape.size / 2 + error
  );
}

export function hitShape(shape: ShapeObject, point: Point, padding: number): boolean {
  const box = boxBounds(shape);
  if (
    shape.kind === 'rectangle' &&
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
    return true;
  if (
    shape.kind === 'ellipse' &&
    ((point.x - box.x - box.width / 2) / (box.width / 2)) ** 2 +
      ((point.y - box.y - box.height / 2) / (box.height / 2)) ** 2 <=
      1
  )
    return true;
  return intersectsShape(shape, point, point, padding);
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
