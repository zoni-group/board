import { describe, expect, it, vi } from 'vitest';
import { createLaser, LASER_FADE_MS, LASER_TAIL_MS } from '../../src/board/laser.ts';

function fakeLayer() {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => calls.push([key, ...args]);
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    }
  );
  return { layer: { width: 200, height: 100, getContext: () => ctx }, calls, ctx };
}

function setup() {
  let time = 0;
  const frames = [];
  const { layer, calls, ctx } = fakeLayer();
  const laser = createLaser({
    layer,
    view: () => ({ center: { x: 0, y: 0 }, zoom: 2 }),
    size: () => ({ width: 200, height: 100 }),
    dpr: () => 1,
    now: () => time,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: vi.fn(),
  });
  const runFrame = () => frames.shift()?.();
  return {
    laser,
    calls,
    ctx,
    frames,
    runFrame,
    advance: (ms) => {
      time += ms;
    },
  };
}

describe('laser pointer', () => {
  it('draws a trail with a fixed on-screen width and fades it out after release', () => {
    const { laser, calls, ctx, frames, runFrame, advance } = setup();
    laser.start({ x: 0, y: 0 });
    laser.move({ x: 10, y: 10 });
    expect(frames).toHaveLength(1);
    runFrame();
    expect(calls.some(([name]) => name === 'stroke')).toBe(true);
    expect(ctx.lineWidth).toBeCloseTo((5 * 0.35) / 2);
    laser.end();
    advance(LASER_FADE_MS / 2);
    runFrame();
    expect(ctx.globalAlpha).toBeCloseTo(0.5);
    expect(laser.hasTrails()).toBe(true);
    advance(LASER_FADE_MS);
    runFrame();
    expect(laser.hasTrails()).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('drops old parts of a long trail but keeps the pointer visible while resting', () => {
    const { laser, runFrame, advance } = setup();
    laser.start({ x: 0, y: 0 });
    advance(LASER_TAIL_MS + 10);
    runFrame();
    expect(laser.hasTrails()).toBe(true);
    expect(laser.isDrawing()).toBe(true);
  });

  it('removes an interrupted trail immediately', () => {
    const { laser } = setup();
    laser.start({ x: 0, y: 0 });
    laser.move({ x: 5, y: 5 });
    laser.cancel();
    expect(laser.hasTrails()).toBe(false);
    expect(laser.isDrawing()).toBe(false);
  });
});
