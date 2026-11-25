import { drawInk, resolveInk, inkBounds } from './ink.ts';
import type { InkObject } from './ink.ts';
export { drawStroke, drawStrokeSegment, applyStrokeStyle, strokeBounds } from './ink.ts';
import type {
  BoardCommand,
  TextObject,
  ShapeObject,
  ContentObject,
  EraserStrokeCommand,
} from './model.ts';
import { resolveContent, contentBounds, drawContent } from './content.ts';
import type { ContentPaintOptions } from './content.ts';
import { drawShape, resolveShapes, shapeBounds } from './shapes.ts';
import { resolveTextObjects } from './text-scene.ts';
import { cachedTextLayout, drawText } from './text-layout.ts';
import {
  applyViewport,
  boundsIntersect,
  exportGeometry,
  unionBounds,
  visibleBounds,
} from './viewport.ts';
import { stackBounds, stackOrder } from './stacking.ts';
import type { StackObject } from './stacking.ts';
import { strokeBounds } from './ink.ts';
import { paintBackgroundPattern } from './background.ts';
import type { BoardBackground } from './background.ts';
import type { BoardBounds, BoardSize, BoardViewport } from './viewport.ts';

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

export interface ScenePaintOptions {
  ink: InkColor;
  media: ContentPaintOptions;
  /** How an object shows now (a selection drag), or null to leave it out (being edited or erased). */
  display?(object: StackObject): StackObject | null;
  /** The eraser being dragged: it hides the ink it crosses until the stroke is saved. */
  eraser?: EraserStrokeCommand | null;
}

/**
 * Draws every object in stack order onto a canvas, bottom to top. The caller paints the paper
 * first. Objects outside the view are skipped.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  view: BoardViewport,
  size: BoardSize,
  dpr: number,
  options: ScenePaintOptions
) {
  ctx.save();
  applyViewport(ctx, view, size, dpr);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const visible = visibleBounds(view, size);
  const eraser = options.eraser ?? null,
    erasing = eraser ? strokeBounds(eraser) : null;
  for (const stacked of stackOrder(scene)) {
    const object = options.display ? options.display(stacked) : stacked;
    if (!object || !boundsIntersect(stackBounds(ctx, object), visible)) continue;
    switch (object.kind) {
      case 'stroke': {
        let ink = object.value;
        if (eraser && erasing && boundsIntersect(inkBounds(ink), erasing))
          ink = {
            ...ink,
            erasures: [
              ...ink.erasures,
              {
                ...eraser,
                points: eraser.points.map((p) => ({
                  x: p.x - ink.offset.x,
                  y: p.y - ink.offset.y,
                })),
              },
            ],
          };
        drawInk(ctx, ink, view, size, dpr, options.ink);
        break;
      }
      case 'shape':
        drawShape(ctx, object.value, options.ink);
        break;
      case 'text':
        drawText(ctx, object.value, cachedTextLayout(ctx, object.value));
        break;
      default:
        drawContent(ctx, object.value, options.media);
    }
  }
  ctx.restore();
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
  const out = document.createElement('canvas');
  out.width = geometry.width;
  out.height = geometry.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas export context is unavailable.');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  applyViewport(ctx, geometry.view, geometry);
  if (paper) paintBackgroundPattern(ctx, paper, geometry.view, geometry, background);
  renderScene(ctx, scene, geometry.view, geometry, 1, {
    ink,
    media: { image: media?.image ?? (() => null), background, ink },
  });
  return { canvas: out, reduced: geometry.reduced, area: geometry.area };
}
