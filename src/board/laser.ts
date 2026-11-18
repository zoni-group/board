import type { Point } from './model.ts';
import { applyViewport } from './viewport.ts';
import type { BoardSize, BoardViewport } from './viewport.ts';

/** How long a released trail takes to fade out. */
export const LASER_FADE_MS = 1000;
/** While pointing, older parts of the trail disappear so it never covers the board. */
export const LASER_TAIL_MS = 1500;
const COLOR = '#ef4444';
const CORE = '#fee2e2';
const WIDTH = 5; // screen pixels, at any zoom

interface TimedPoint extends Point {
  time: number;
}
interface Trail {
  points: TimedPoint[];
  endedAt: number | null;
}

interface LaserOptions {
  layer: HTMLCanvasElement;
  view(): BoardViewport;
  size(): BoardSize;
  dpr(): number;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (id: number) => void;
}

/** A temporary pointer trail on its own overlay. It never creates board commands. */
export function createLaser(options: LaserOptions) {
  const context = options.layer.getContext('2d');
  if (!context) throw new Error('Laser canvas context is unavailable.');
  const ctx = context;
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? ((cb) => window.requestAnimationFrame(cb));
  const cancelFrame = options.cancelFrame ?? ((id) => window.cancelAnimationFrame(id));
  let trails: Trail[] = [];
  let active: Trail | null = null;
  let frame: number | null = null;

  function prune(time: number) {
    trails = trails.filter((trail) => {
      if (trail.endedAt !== null) return time - trail.endedAt < LASER_FADE_MS;
      // Keep the newest point so the pointer stays visible while it rests.
      const firstKept = trail.points.findIndex((p) => time - p.time < LASER_TAIL_MS);
      trail.points = trail.points.slice(firstKept < 0 ? trail.points.length - 1 : firstKept);
      return true;
    });
  }

  function drawTrail(trail: Trail, alpha: number, zoom: number) {
    const points = trail.points;
    if (!points.length) return;
    ctx.globalAlpha = alpha;
    for (const [color, width, blur] of [
      [COLOR, WIDTH, 12],
      [CORE, WIDTH * 0.35, 0],
    ] as const) {
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.shadowColor = blur ? COLOR : 'transparent';
      ctx.shadowBlur = blur * options.dpr();
      ctx.lineWidth = width / zoom;
      ctx.beginPath();
      if (points.length === 1) {
        ctx.arc(points[0].x, points[0].y, width / zoom / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) {
        const previous = points[index - 1],
          point = points[index];
        ctx.quadraticCurveTo(
          previous.x,
          previous.y,
          (previous.x + point.x) / 2,
          (previous.y + point.y) / 2
        );
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }

  function paint() {
    const time = now();
    prune(time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, options.layer.width, options.layer.height);
    if (!trails.length) return;
    const view = options.view();
    ctx.save();
    applyViewport(ctx, view, options.size(), options.dpr());
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const trail of trails) {
      const alpha = trail.endedAt === null ? 1 : 1 - (time - trail.endedAt) / LASER_FADE_MS;
      if (alpha > 0) drawTrail(trail, alpha, view.zoom);
    }
    ctx.restore();
  }

  function tick() {
    frame = null;
    paint();
    if (trails.length) frame = requestFrame(tick);
  }
  function schedule() {
    if (frame === null) frame = requestFrame(tick);
  }

  return {
    start(point: Point) {
      if (active) active.endedAt = now();
      active = { points: [{ ...point, time: now() }], endedAt: null };
      trails.push(active);
      schedule();
    },
    move(point: Point) {
      if (!active) return;
      active.points.push({ ...point, time: now() });
      schedule();
    },
    /** Release: the trail fades out. */
    end() {
      if (!active) return;
      active.endedAt = now();
      active = null;
      schedule();
    },
    /** Interrupted (second finger, tool change): remove the unfinished trail at once. */
    cancel() {
      if (!active) return;
      trails = trails.filter((trail) => trail !== active);
      active = null;
      paint();
    },
    clear() {
      trails = [];
      active = null;
      if (frame !== null) cancelFrame(frame);
      frame = null;
      paint();
    },
    paint,
    isDrawing: () => active !== null,
    hasTrails: () => trails.length > 0,
  };
}
