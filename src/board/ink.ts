import { assertNever, expandCommands } from './model.ts';
import type {
  BoardCommand,
  StrokeCommand,
  PenStrokeCommand,
  EraserStrokeCommand,
  Point,
} from './model.ts';
import { applyViewport, boundsIntersect, visibleBounds, worldToScreen } from './viewport.ts';
import type { BoardBounds, BoardSize, BoardViewport } from './viewport.ts';
type InkColor = (raw: string) => string;

/** Resolved state only. Paths stay immutable; masks use the stroke's original coordinate space. */
export interface InkObject {
  id: string;
  stroke: PenStrokeCommand;
  offset: Point;
  erasures: readonly EraserStrokeCommand[];
}

export function inkBounds(object: InkObject): BoardBounds {
  const bounds = strokeBounds(object.stroke);
  return { ...bounds, x: bounds.x + object.offset.x, y: bounds.y + object.offset.y };
}

export function resolveInk(commands: readonly BoardCommand[]): InkObject[] {
  const objects = new Map<string, InkObject>();
  for (const command of expandCommands(commands)) {
    switch (command.type) {
      case 'clear':
        objects.clear();
        break;
      case 'stroke':
        if (command.tool === 'pen') {
          objects.set(command.id, {
            id: command.id,
            stroke: command,
            offset: { x: 0, y: 0 },
            erasures: (command.erasures ?? []).map((mask) => ({
              type: 'stroke',
              tool: 'eraser',
              size: mask.size,
              inkRaw: '#000000',
              points: mask.points,
            })),
          });
        } else {
          const erasedBounds = strokeBounds(command);
          for (const [id, object] of objects) {
            if (!boundsIntersect(inkBounds(object), erasedBounds)) continue;
            const mask: EraserStrokeCommand = {
              type: 'stroke',
              tool: 'eraser',
              size: command.size,
              inkRaw: '#000000',
              points: command.points.map((p) => ({
                x: p.x - object.offset.x,
                y: p.y - object.offset.y,
              })),
            };
            objects.set(id, { ...object, erasures: [...object.erasures, mask] });
          }
        }
        break;
      case 'stroke-edit': {
        const object = objects.get(command.id);
        if (!object) break;
        objects.set(command.id, {
          ...object,
          offset: {
            x: object.offset.x + (command.translate?.x ?? 0),
            y: object.offset.y + (command.translate?.y ?? 0),
          },
          stroke: {
            ...object.stroke,
            ...(command.size !== undefined ? { size: command.size } : {}),
            ...(command.inkRaw !== undefined ? { inkRaw: command.inkRaw } : {}),
          },
        });
        break;
      }
      case 'stroke-delete':
        command.ids.forEach((id) => objects.delete(id));
        break;
      case 'shape-set':
      case 'shape-delete':
      case 'text-set':
      case 'text-delete':
      case 'content-set':
      case 'content-delete':
        break;
      default:
        assertNever(command);
    }
  }
  return [...objects.values()];
}

/** Highlights stay see-through; one stroke() per path, so a stroke never darkens itself. */
export const HIGHLIGHT_ALPHA = 0.35;

export function isHighlighter(stroke: StrokeCommand): boolean {
  return stroke.tool === 'pen' && stroke.pen === 'highlighter';
}

/** Paint order: highlights under all pen ink, creation order within each group. */
export function inkPaintOrder<T extends InkObject>(objects: readonly T[]): T[] {
  const highlights: T[] = [],
    ink: T[] = [];
  for (const object of objects) (isHighlighter(object.stroke) ? highlights : ink).push(object);
  return highlights.length ? [...highlights, ...ink] : [...objects];
}

const scratchSurfaces = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
function drawInkObject(ctx: CanvasRenderingContext2D, object: InkObject, ink: InkColor) {
  ctx.save();
  ctx.translate(object.offset.x, object.offset.y);
  drawStroke(ctx, object.stroke, ink);
  for (const erasure of object.erasures) drawStroke(ctx, erasure, ink);
  ctx.restore();
}

export function renderInk(
  ctx: CanvasRenderingContext2D,
  objects: readonly InkObject[],
  view: BoardViewport,
  size: BoardSize,
  dpr: number,
  ink: InkColor
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  applyViewport(ctx, view, size, dpr);
  const visible = visibleBounds(view, size);
  for (const object of inkPaintOrder(objects)) {
    const bounds = inkBounds(object);
    if (!boundsIntersect(bounds, visible)) continue;
    if (!object.erasures.length) {
      drawInkObject(ctx, object, ink);
      continue;
    }
    let scratch = scratchSurfaces.get(ctx);
    if (!scratch) {
      scratch = document.createElement('canvas');
      scratchSurfaces.set(ctx, scratch);
    }
    const anchor = worldToScreen(bounds, view, size);
    const left = Math.max(0, Math.floor(anchor.x * dpr) - 2),
      top = Math.max(0, Math.floor(anchor.y * dpr) - 2);
    const right = Math.min(
      ctx.canvas.width,
      Math.ceil((anchor.x + bounds.width * view.zoom) * dpr) + 2
    );
    const bottom = Math.min(
      ctx.canvas.height,
      Math.ceil((anchor.y + bounds.height * view.zoom) * dpr) + 2
    );
    if (right <= left || bottom <= top) continue;
    const width = right - left,
      height = bottom - top;
    if (scratch.width !== width) scratch.width = width;
    if (scratch.height !== height) scratch.height = height;
    const target = scratch.getContext('2d');
    if (!target) throw new Error('Ink mask context is unavailable.');
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, width, height);
    target.setTransform(
      dpr * view.zoom,
      0,
      0,
      dpr * view.zoom,
      dpr * (size.width / 2 - view.center.x * view.zoom) - left,
      dpr * (size.height / 2 - view.center.y * view.zoom) - top
    );
    drawInkObject(target, object, ink);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratch, left, top);
    ctx.restore();
  }
}

let hitCanvas: HTMLCanvasElement | undefined;
/** The tiny tile includes nearby visible ink, but never selects through an erased gap. */
export function hitInk(object: InkObject, point: Point, zoom: number, padding: number): boolean {
  if (
    !boundsIntersect(inkBounds(object), {
      x: point.x - padding / zoom,
      y: point.y - padding / zoom,
      width: (padding * 2) / zoom,
      height: (padding * 2) / zoom,
    })
  )
    return false;
  hitCanvas ??= document.createElement('canvas');
  const size = Math.ceil(padding * 2 + 1);
  if (hitCanvas.width !== size) hitCanvas.width = hitCanvas.height = size;
  const ctx = hitCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  renderInk(
    ctx,
    [object],
    { center: point, zoom },
    { width: size, height: size },
    1,
    () => '#000000'
  );
  const pixels = ctx.getImageData(0, 0, size, size).data;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (
        Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= padding &&
        pixels[(y * size + x) * 4 + 3] > 0
      )
        return true;
    }
  return false;
}
const strokeBoundsCache = new WeakMap<StrokeCommand, BoardBounds>();

export function strokeBounds(stroke: StrokeCommand): BoardBounds {
  const cached = strokeBoundsCache.get(stroke);
  if (cached) return cached;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const point of stroke.points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const widest =
    stroke.tool === 'pen' && stroke.pressure
      ? pressureWidth(
          stroke.size,
          stroke.pressure.reduce((a, b) => Math.max(a, b), 0)
        )
      : stroke.size;
  const radius = Math.max(1, widest / 2);
  const bounds = {
    x: left - radius,
    y: top - radius,
    width: right - left + radius * 2,
    height: bottom - top + radius * 2,
  };
  strokeBoundsCache.set(stroke, bounds);
  return bounds;
}

export function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeCommand,
  ink: InkColor
): void {
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (stroke.tool) {
    case 'eraser':
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ctx.fillStyle = '#000000';
      break;
    case 'pen':
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = stroke.pen === 'highlighter' ? HIGHLIGHT_ALPHA : 1;
      // Highlights keep their bright color: contrast darkening is for readable pen lines.
      ctx.strokeStyle = ctx.fillStyle =
        stroke.pen === 'highlighter' ? stroke.inkRaw : ink(stroke.inkRaw);
      break;
    default:
      assertNever(stroke);
  }
}
/** Stylus pressure scales the chosen size: half pressure draws at exactly that size. */
export function pressureWidth(size: number, pressure: number): number {
  return size * (0.3 + 1.4 * pressure);
}
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * One piece of a pressure stroke, with the same curve as the single-path drawing: piece
 * `index` (1 … points.length - 1) ends halfway to point `index`; piece `points.length` is the
 * straight tail to the last point. Round caps join the pieces into one line.
 */
export function drawStrokeSegment(
  ctx: CanvasRenderingContext2D,
  stroke: PenStrokeCommand & { pressure: number[] },
  index: number,
  ink: InkColor
): void {
  const { points, pressure } = stroke;
  if (index < 1 || index > points.length || points.length < 2) return;
  const control = points[index - 1];
  const from = index === 1 ? points[0] : midpoint(points[index - 2], control);
  ctx.save();
  applyStrokeStyle(ctx, stroke, ink);
  ctx.lineWidth = pressureWidth(stroke.size, pressure[index - 1] ?? 0.5);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  if (index === points.length) ctx.lineTo(control.x, control.y);
  else {
    const to = midpoint(control, points[index]);
    ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeCommand,
  ink: InkColor
): void {
  if (!stroke.points.length) return;
  if (stroke.tool === 'pen' && stroke.pressure && stroke.points.length > 1) {
    const pressured = stroke as PenStrokeCommand & { pressure: number[] };
    for (let index = 1; index <= stroke.points.length; index++)
      drawStrokeSegment(ctx, pressured, index, ink);
    return;
  }
  ctx.save();
  applyStrokeStyle(ctx, stroke, ink);
  ctx.beginPath();
  const first = stroke.points[0];
  if (stroke.points.length === 1) {
    const dot =
      stroke.tool === 'pen' && stroke.pressure
        ? pressureWidth(stroke.size, stroke.pressure[0])
        : stroke.size;
    ctx.arc(first.x, first.y, Math.max(1, dot / 2), 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(first.x, first.y);
    let previous = first;
    for (let index = 1; index < stroke.points.length; index++) {
      const point = stroke.points[index];
      ctx.quadraticCurveTo(
        previous.x,
        previous.y,
        (previous.x + point.x) / 2,
        (previous.y + point.y) / 2
      );
      previous = point;
    }
    ctx.lineTo(previous.x, previous.y);
    ctx.stroke();
  }
  ctx.restore();
}
