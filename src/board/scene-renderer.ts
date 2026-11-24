import { resolveInk, inkBounds, renderInk } from './ink.ts';
import type { InkObject } from './ink.ts';
export { drawStroke, drawStrokeSegment, applyStrokeStyle, strokeBounds } from './ink.ts';
import type { BoardCommand, TextObject, ShapeObject, ContentObject } from './model.ts';
import { resolveContent, contentBounds, drawContent } from './content.ts';
import type { ContentPaintOptions } from './content.ts';
import { drawShape, resolveShapes, shapeBounds } from './shapes.ts';
import { resolveTextObjects } from './text-scene.ts';
import { cachedTextLayout, drawText } from './text-layout.ts';
import { applyViewport, exportGeometry, unionBounds } from './viewport.ts';
import { paintBackgroundPattern } from './background.ts';
import type { BoardBackground } from './background.ts';
import type { BoardBounds, BoardSize } from './viewport.ts';

export interface BoardScene {
  content: ContentObject[];
  strokes: InkObject[];
  text: TextObject[];
  shapes: ShapeObject[];
  bounds: BoardBounds | null;
}
type InkColor = (raw: string) => string;
export function createBoardScene(
  commands: readonly BoardCommand[],
  ctx: CanvasRenderingContext2D
): BoardScene {
  const strokes = resolveInk(commands);
  const text = resolveTextObjects(commands);
  const shapes = resolveShapes(commands);
  const content = resolveContent(commands);
  let bounds: BoardBounds | null = null;
  for (const object of content) bounds = unionBounds(bounds, contentBounds(ctx, object));
  for (const stroke of strokes) bounds = unionBounds(bounds, inkBounds(stroke));
  for (const object of text) bounds = unionBounds(bounds, cachedTextLayout(ctx, object).bounds);
  for (const object of shapes) bounds = unionBounds(bounds, shapeBounds(object));
  return { strokes, text, shapes, content, bounds };
}

export function createDrawingCanvas(
  scene: BoardScene,
  size: BoardSize,
  background: string,
  ink: InkColor,
  media?: Pick<ContentPaintOptions, 'image'>,
  paper?: BoardBackground,
  { pixelRatio = 1 }: { pixelRatio?: number } = {}
) {
  const geometry = exportGeometry(scene.bounds, size, pixelRatio);
  const out = document.createElement('canvas'),
    inkCanvas = document.createElement('canvas');
  out.width = inkCanvas.width = geometry.width;
  out.height = inkCanvas.height = geometry.height;
  const ctx = out.getContext('2d'),
    inkCtx = inkCanvas.getContext('2d');
  if (!ctx || !inkCtx) throw new Error('Canvas export context is unavailable.');
  renderInk(inkCtx, scene.strokes, geometry.view, geometry, 1, ink);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  applyViewport(ctx, geometry.view, geometry);
  if (paper) paintBackgroundPattern(ctx, paper, geometry.view, geometry, background);
  for (const object of scene.content)
    drawContent(ctx, object, { image: media?.image ?? (() => null), background, ink });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(inkCanvas, 0, 0);
  applyViewport(ctx, geometry.view, geometry);
  for (const shape of scene.shapes) drawShape(ctx, shape, ink);
  for (const object of scene.text) drawText(ctx, object, cachedTextLayout(ctx, object));
  return { canvas: out, reduced: geometry.reduced, area: geometry.area };
}
