import { assertNever } from './model.ts';
import type { BoardCommand, StrokeCommand, TextObject } from './model.ts';
import { resolveTextObjects } from './text-scene.ts';
import { cachedTextLayout, drawText } from './text-layout.ts';
import {
  applyViewport,
  boundsIntersect,
  exportGeometry,
  unionBounds,
  visibleBounds,
} from './viewport.ts';
import type { BoardBounds, BoardSize, BoardViewport } from './viewport.ts';

export interface BoardScene {
  strokes: StrokeCommand[];
  text: TextObject[];
  bounds: BoardBounds | null;
}
type InkColor = (raw: string) => string;
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
  const radius = Math.max(1, stroke.size / 2);
  const bounds = {
    x: left - radius,
    y: top - radius,
    width: right - left + radius * 2,
    height: bottom - top + radius * 2,
  };
  strokeBoundsCache.set(stroke, bounds);
  return bounds;
}

export function createBoardScene(
  commands: readonly BoardCommand[],
  ctx: CanvasRenderingContext2D
): BoardScene {
  let strokes: StrokeCommand[] = [];
  for (const command of commands) {
    if (command.type === 'clear') strokes = [];
    else if (command.type === 'stroke' && command.points.length) strokes.push(command);
  }
  const text = resolveTextObjects(commands);
  let bounds: BoardBounds | null = null;
  for (const stroke of strokes)
    if (stroke.tool === 'pen') bounds = unionBounds(bounds, strokeBounds(stroke));
  for (const object of text) bounds = unionBounds(bounds, cachedTextLayout(ctx, object).bounds);
  return { strokes, text, bounds };
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
      ctx.strokeStyle = ctx.fillStyle = '#000000';
      break;
    case 'pen':
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = ctx.fillStyle = ink(stroke.inkRaw);
      break;
    default:
      assertNever(stroke.tool);
  }
}
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeCommand,
  ink: InkColor
): void {
  if (!stroke.points.length) return;
  ctx.save();
  applyStrokeStyle(ctx, stroke, ink);
  ctx.beginPath();
  const first = stroke.points[0];
  if (stroke.points.length === 1) {
    ctx.arc(first.x, first.y, Math.max(1, stroke.size / 2), 0, Math.PI * 2);
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
export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly StrokeCommand[],
  view: BoardViewport,
  size: BoardSize,
  dpr: number,
  ink: InkColor
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  applyViewport(ctx, view, size, dpr);
  const visible = visibleBounds(view, size);
  for (const stroke of strokes)
    if (boundsIntersect(strokeBounds(stroke), visible)) drawStroke(ctx, stroke, ink);
}

export function createDrawingCanvas(
  scene: BoardScene,
  size: BoardSize,
  background: string,
  ink: InkColor
) {
  const geometry = exportGeometry(scene.bounds, size);
  const out = document.createElement('canvas'),
    inkCanvas = document.createElement('canvas');
  out.width = inkCanvas.width = geometry.width;
  out.height = inkCanvas.height = geometry.height;
  const ctx = out.getContext('2d'),
    inkCtx = inkCanvas.getContext('2d');
  if (!ctx || !inkCtx) throw new Error('Canvas export context is unavailable.');
  renderStrokes(inkCtx, scene.strokes, geometry.view, geometry, 1, ink);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(inkCanvas, 0, 0);
  applyViewport(ctx, geometry.view, geometry);
  for (const object of scene.text) drawText(ctx, object, cachedTextLayout(ctx, object));
  return { canvas: out, reduced: geometry.reduced };
}
