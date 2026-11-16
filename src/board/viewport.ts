import { isFiniteNumber, isRecord, normalizePoint } from './model.ts';
import type { Point } from './model.ts';
import { loadJson, saveJson } from '../shared/storage.ts';

export interface BoardSize {
  width: number;
  height: number;
}
export interface BoardBounds extends BoardSize {
  x: number;
  y: number;
}
export interface BoardViewport {
  center: Point;
  zoom: number;
}

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 4;
export const VIEWPORT_KEY = 'vatio_board_viewport_v1';

export function initialViewport(size: BoardSize): BoardViewport {
  return { center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 };
}
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
export function worldToScreen(point: Point, view: BoardViewport, size: BoardSize): Point {
  return {
    x: (point.x - view.center.x) * view.zoom + size.width / 2,
    y: (point.y - view.center.y) * view.zoom + size.height / 2,
  };
}
export function screenToWorld(point: Point, view: BoardViewport, size: BoardSize): Point {
  return {
    x: (point.x - size.width / 2) / view.zoom + view.center.x,
    y: (point.y - size.height / 2) / view.zoom + view.center.y,
  };
}
export function panBy(view: BoardViewport, delta: Point): BoardViewport {
  return {
    ...view,
    center: { x: view.center.x - delta.x / view.zoom, y: view.center.y - delta.y / view.zoom },
  };
}
export function zoomAt(
  view: BoardViewport,
  zoom: number,
  anchor: Point,
  size: BoardSize
): BoardViewport {
  const world = screenToWorld(anchor, view, size);
  const nextZoom = clampZoom(zoom);
  return {
    zoom: nextZoom,
    center: {
      x: world.x - (anchor.x - size.width / 2) / nextZoom,
      y: world.y - (anchor.y - size.height / 2) / nextZoom,
    },
  };
}
export function fitViewport(bounds: BoardBounds | null, size: BoardSize): BoardViewport {
  if (!bounds) return initialViewport(size);
  return {
    center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    zoom: clampZoom(
      Math.min(
        1,
        Math.max(1, size.width - 64) / Math.max(1, bounds.width),
        Math.max(1, size.height - 64) / Math.max(1, bounds.height)
      )
    ),
  };
}
export function visibleBounds(view: BoardViewport, size: BoardSize): BoardBounds {
  return {
    ...screenToWorld({ x: 0, y: 0 }, view, size),
    width: size.width / view.zoom,
    height: size.height / view.zoom,
  };
}
export function boundsIntersect(a: BoardBounds, b: BoardBounds): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}
export function unionBounds(a: BoardBounds | null, b: BoardBounds): BoardBounds {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
export function applyViewport(
  ctx: CanvasRenderingContext2D,
  view: BoardViewport,
  size: BoardSize,
  dpr = 1
): void {
  ctx.setTransform(
    dpr * view.zoom,
    0,
    0,
    dpr * view.zoom,
    dpr * (size.width / 2 - view.center.x * view.zoom),
    dpr * (size.height / 2 - view.center.y * view.zoom)
  );
}
export function loadViewport(): BoardViewport | null {
  const value = loadJson(VIEWPORT_KEY);
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isFiniteNumber(value.zoom) ||
    value.zoom < MIN_ZOOM ||
    value.zoom > MAX_ZOOM
  )
    return null;
  const center = normalizePoint(value.center);
  return center ? { center, zoom: value.zoom } : null;
}
export function saveViewport(view: BoardViewport): boolean {
  return saveJson(VIEWPORT_KEY, { version: 1, center: view.center, zoom: view.zoom });
}

export function exportGeometry(bounds: BoardBounds | null, size: BoardSize) {
  const area = bounds
    ? { x: bounds.x - 32, y: bounds.y - 32, width: bounds.width + 64, height: bounds.height + 64 }
    : { x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, size.height) };
  const scale = Math.min(
    1,
    4096 / area.width,
    4096 / area.height,
    Math.sqrt((8 * 1024 * 1024) / (area.width * area.height))
  );
  const width = Math.max(1, Math.floor(area.width * scale)),
    height = Math.max(1, Math.floor(area.height * scale));
  return {
    width,
    height,
    reduced: scale < 1,
    view: {
      center: { x: area.x + area.width / 2, y: area.y + area.height / 2 },
      zoom: Math.min(width / area.width, height / area.height),
    },
  };
}
