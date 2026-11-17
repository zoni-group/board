import { describe, expect, it, vi } from 'vitest';
import {
  applyViewport,
  boundsIntersect,
  exportGeometry,
  fitViewport,
  initialViewport,
  normalizeViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToWorld,
  visibleBounds,
  worldToScreen,
  zoomAt,
} from '../../src/board/viewport.ts';

const size = { width: 800, height: 600 };

describe('board viewport', () => {
  it('starts with board coordinates and round-trips negative points at every zoom', () => {
    const initial = initialViewport(size);
    expect(worldToScreen({ x: 50, y: 80 }, initial, size)).toEqual({ x: 50, y: 80 });
    for (const zoom of [MIN_ZOOM, 0.25, 1, MAX_ZOOM]) {
      const view = { center: { x: -500, y: 900 }, zoom };
      const original = { x: -200, y: 450 };
      const result = screenToWorld(worldToScreen(original, view, size), view, size);
      expect(result.x).toBeCloseTo(original.x);
      expect(result.y).toBeCloseTo(original.y);
    }
  });
  it('keeps zoom anchors stationary, clamps zoom, and pans in screen pixels', () => {
    const view = { center: { x: -100, y: 200 }, zoom: 0.5 },
      anchor = { x: 30, y: 90 };
    const world = screenToWorld(anchor, view, size);
    const changed = zoomAt(view, 2, anchor, size);
    expect(worldToScreen(world, changed, size)).toEqual(anchor);
    expect(zoomAt(view, 100, anchor, size).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(view, 0, anchor, size).zoom).toBe(MIN_ZOOM);
    expect(worldToScreen(world, panBy(view, { x: 40, y: -20 }), size)).toEqual({ x: 70, y: 70 });
  });
  it('fits full bounds with padding and uses the initial view when empty', () => {
    const bounds = { x: -500, y: -400, width: 1000, height: 800 };
    const view = fitViewport(bounds, size);
    expect(view.center).toEqual({ x: 0, y: 0 });
    expect(view.zoom).toBeCloseTo(536 / 800);
    const corner = worldToScreen(bounds, view, size);
    expect(corner.x).toBeGreaterThanOrEqual(32);
    expect(corner.y).toBeGreaterThanOrEqual(32);
    expect(fitViewport(null, size)).toEqual(initialViewport(size));
    expect(fitViewport({ x: 10, y: 20, width: 2, height: 2 }, size).zoom).toBe(1);
    expect(visibleBounds(initialViewport(size), size)).toEqual({ x: 0, y: 0, ...size });
    expect(boundsIntersect(bounds, visibleBounds(view, size))).toBe(true);
  });
  it('stops Fit at 50% even when the whole drawing needs a smaller scale', () => {
    expect(MIN_ZOOM).toBe(0.5);
    expect(fitViewport({ x: -1000, y: -800, width: 2000, height: 1600 }, size)).toEqual({
      center: { x: 0, y: 0 },
      zoom: 0.5,
    });
  });
  it('combines the view and pixel ratio without modifying board coordinates', () => {
    const ctx = { setTransform: vi.fn() };
    applyViewport(ctx, { center: { x: 100, y: -100 }, zoom: 2 }, size, 3);
    expect(ctx.setTransform).toHaveBeenCalledWith(6, 0, 0, 6, 600, 1500);
  });
  it('validates viewport data independently of persistence and clamps zoom', () => {
    const center = { x: -1200, y: 800 };
    for (const invalid of [null, {}, { zoom: 0, center }, { zoom: 1, center: { x: NaN, y: 0 } }])
      expect(normalizeViewport(invalid)).toBeNull();
    for (const [zoom, expected] of [
      [0.01, MIN_ZOOM],
      [0.75, 0.75],
      [10, MAX_ZOOM],
    ])
      expect(normalizeViewport({ center, zoom })).toEqual({ center, zoom: expected });
  });
});

describe('whole-board PNG dimensions', () => {
  it('adds a margin at negative coordinates and sizes empty exports to the viewport', () => {
    const result = exportGeometry({ x: -300, y: -50, width: 1000, height: 300 }, size);
    expect(result).toMatchObject({ width: 1064, height: 364, reduced: false });
    expect(result.view.center).toEqual({ x: 200, y: 100 });
    expect(exportGeometry(null, size)).toMatchObject({ ...size, reduced: false });
  });
  it('caps both dimensions and pixel count, including very wide and tall drawings', () => {
    for (const [width, height] of [
      [1e6, 100],
      [100, 1e6],
      [1e5, 1e5],
    ]) {
      const result = exportGeometry({ x: -5000, y: 12000, width, height }, size);
      expect(result.width).toBeLessThanOrEqual(4096);
      expect(result.height).toBeLessThanOrEqual(4096);
      expect(result.width * result.height).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(result.reduced).toBe(true);
      expect(result.view.zoom).toBeLessThan(MIN_ZOOM);
    }
  });
});
