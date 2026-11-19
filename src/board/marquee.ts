import { contentBounds } from './content.ts';
import type { InkObject } from './ink.ts';
import type { BoardObjectRef, Point } from './model.ts';
import type { BoardScene } from './scene-renderer.ts';
import { shapeBounds } from './shapes.ts';
import { cachedTextLayout } from './text-layout.ts';
import type { BoardBounds } from './viewport.ts';

/** A stroke is caught when at least this share of its points lies inside the region. */
export const STROKE_INSIDE_RATIO = 0.75;

/** Even-odd rule; works for concave and self-crossing lasso paths. */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

export function boxPolygon(a: Point, b: Point): Point[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}

export function strokeInRegion(object: InkObject, polygon: readonly Point[]): boolean {
  const points = object.stroke.points;
  if (!points.length || polygon.length < 3) return false;
  let inside = 0;
  for (const point of points)
    if (pointInPolygon({ x: point.x + object.offset.x, y: point.y + object.offset.y }, polygon))
      inside++;
  return inside / points.length >= STROKE_INSIDE_RATIO;
}

/** Boxes (shapes, text, media) are caught when their center and at least 3 corners are inside. */
export function boundsInRegion(bounds: BoardBounds, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  if (!pointInPolygon(center, polygon)) return false;
  const corners = boxPolygon(
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  );
  return corners.filter((corner) => pointInPolygon(corner, polygon)).length >= 3;
}

/** Every object the region catches, in the scene's layer order (bottom to top). */
export function objectsInRegion(
  scene: BoardScene,
  polygon: readonly Point[],
  textContext: CanvasRenderingContext2D
): BoardObjectRef[] {
  const refs: BoardObjectRef[] = [];
  for (const value of scene.content)
    if (boundsInRegion(contentBounds(textContext, value), polygon))
      refs.push({ kind: value.kind, id: value.id });
  for (const value of scene.strokes)
    if (strokeInRegion(value, polygon)) refs.push({ kind: 'stroke', id: value.id });
  for (const value of scene.shapes)
    if (boundsInRegion(shapeBounds(value), polygon)) refs.push({ kind: 'shape', id: value.id });
  for (const value of scene.text)
    if (boundsInRegion(cachedTextLayout(textContext, value).bounds, polygon))
      refs.push({ kind: 'text', id: value.id });
  return refs;
}
