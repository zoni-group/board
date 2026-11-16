import { describe, expect, it, vi } from 'vitest';
import { createBoardNavigation } from '../../src/board/navigation.ts';
import { initialViewport, screenToWorld } from '../../src/board/viewport.ts';

function setup(tool = 'pen') {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const size = { width: 320, height: 320 };
  let view = initialViewport(size),
    drawing = false;
  const options = {
    canvas,
    ready: () => true,
    tool: () => tool,
    view: () => view,
    size: () => size,
    change: vi.fn((next) => {
      view = next;
    }),
    locked: () => drawing,
    beforeNavigate: vi.fn(() => true),
    start: vi.fn(() => {
      drawing = true;
    }),
    move: vi.fn(),
    end: vi.fn(() => {
      drawing = false;
    }),
    cancelStroke: vi.fn(() => {
      drawing = false;
    }),
    textTap: vi.fn(),
    fit: vi.fn(),
  };
  const navigation = createBoardNavigation(options);
  function pointer(name, id, x = 50, y = 100, type = 'touch') {
    const event = new MouseEvent(name, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: type } });
    canvas.dispatchEvent(event);
  }
  function wheel(properties) {
    canvas.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ...properties }));
  }
  return { canvas, options, navigation, pointer, wheel, view: () => view };
}

describe('board gesture routing', () => {
  it('cancels a touch stroke for a pinch and suppresses the remaining finger until release', () => {
    const app = setup();
    app.pointer('pointerdown', 1);
    app.pointer('pointermove', 1, 60, 100);
    expect(app.options.start).toHaveBeenCalledTimes(1);
    expect(app.options.move).toHaveBeenCalledTimes(1);
    app.pointer('pointerdown', 2, 160, 100);
    expect(app.options.cancelStroke).toHaveBeenCalledTimes(1);
    app.pointer('pointermove', 2, 200, 100);
    expect(app.view().zoom).toBeCloseTo(1.4);
    app.pointer('pointerup', 2, 200, 100);
    app.pointer('pointermove', 1, 100, 100);
    app.pointer('pointerup', 1, 100, 100);
    expect(app.options.end).not.toHaveBeenCalled();
    expect(app.options.move).toHaveBeenCalledTimes(1);
    expect(app.navigation.isBusy()).toBe(false);
    app.pointer('pointerdown', 3);
    app.pointer('pointerup', 3);
    expect(app.options.end).toHaveBeenCalledTimes(1);
  });
  it('combines pinch scale and midpoint movement without losing the world anchor', () => {
    const app = setup();
    const anchor = screenToWorld({ x: 100, y: 100 }, app.view(), { width: 320, height: 320 });
    app.pointer('pointerdown', 1, 50, 100);
    app.pointer('pointerdown', 2, 150, 100);
    app.pointer('pointermove', 1, 0, 140);
    app.pointer('pointermove', 2, 200, 140);
    expect(app.view().zoom).toBe(2);
    expect(screenToWorld({ x: 100, y: 140 }, app.view(), { width: 320, height: 320 })).toEqual(
      anchor
    );
  });
  it('defers text taps, rejects drags, and never opens text for two-finger navigation', () => {
    const app = setup('text');
    app.pointer('pointerdown', 1);
    expect(app.options.textTap).not.toHaveBeenCalled();
    app.pointer('pointerup', 1);
    expect(app.options.textTap).toHaveBeenCalledTimes(1);
    app.pointer('pointerdown', 2);
    app.pointer('pointermove', 2, 100);
    app.pointer('pointerup', 2, 100);
    app.pointer('pointerdown', 3);
    app.pointer('pointerdown', 4, 150);
    app.pointer('pointerup', 4);
    app.pointer('pointerup', 3);
    expect(app.options.textTap).toHaveBeenCalledTimes(1);
    expect(app.options.start).not.toHaveBeenCalled();
  });
  it('ignores palm touches while a pen is drawing and cancels cleanly on capture loss and blur', () => {
    const app = setup();
    app.pointer('pointerdown', 1, 50, 100, 'pen');
    app.pointer('pointerdown', 2);
    app.pointer('pointermove', 2, 150);
    app.pointer('pointerup', 2);
    expect(app.options.change).not.toHaveBeenCalled();
    app.pointer('pointermove', 1, 70, 100, 'pen');
    expect(app.options.move).toHaveBeenCalledTimes(1);
    app.pointer('lostpointercapture', 1, 70, 100, 'pen');
    expect(app.options.end).not.toHaveBeenCalled();
    expect(app.navigation.isBusy()).toBe(false);
    app.pointer('pointerdown', 3);
    window.dispatchEvent(new Event('blur'));
    expect(app.navigation.isBusy()).toBe(false);
    app.pointer('pointerup', 3);
    expect(app.options.end).not.toHaveBeenCalled();
  });
  it('pans with Hand, normalizes wheel deltas, and keeps wheel zoom anchored', () => {
    const app = setup('hand');
    app.pointer('pointerdown', 1, 50, 100, 'mouse');
    app.pointer('pointermove', 1, 90, 120, 'mouse');
    app.pointer('pointerup', 1, 90, 120, 'mouse');
    expect(app.view().center).toEqual({ x: 120, y: 140 });
    expect(app.options.start).not.toHaveBeenCalled();
    app.wheel({ deltaY: 2, deltaMode: 1 });
    expect(app.view().center.y).toBe(172);
    const anchor = { x: 30, y: 80 };
    const world = screenToWorld(anchor, app.view(), { width: 320, height: 320 });
    app.wheel({ clientX: 30, clientY: 80, deltaY: -200, ctrlKey: true });
    const changed = screenToWorld(anchor, app.view(), { width: 320, height: 320 });
    expect(changed.x).toBeCloseTo(world.x);
    expect(changed.y).toBeCloseTo(world.y);
  });
  it('locks view changes while drawing or composing and avoids duplicate WebKit/wheel zoom', () => {
    const app = setup();
    app.pointer('pointerdown', 1, 50, 100, 'mouse');
    app.wheel({ deltaY: -100, ctrlKey: true });
    expect(app.options.change).not.toHaveBeenCalled();
    app.pointer('pointerup', 1, 50, 100, 'mouse');
    app.options.beforeNavigate.mockReturnValue(false);
    app.wheel({ deltaY: -100, ctrlKey: true });
    expect(app.options.change).not.toHaveBeenCalled();
    app.options.beforeNavigate.mockReturnValue(true);
    const start = new Event('gesturestart', { cancelable: true });
    app.canvas.dispatchEvent(start);
    app.wheel({ deltaY: -100, ctrlKey: true });
    expect(app.options.change).not.toHaveBeenCalled();
    const change = new Event('gesturechange', { cancelable: true });
    Object.defineProperty(change, 'scale', { value: 2 });
    app.canvas.dispatchEvent(change);
    expect(app.view().zoom).toBe(2);
    app.canvas.dispatchEvent(new Event('gestureend'));
    app.pointer('pointerdown', 2);
    app.pointer('pointerdown', 3, 150);
    app.canvas.dispatchEvent(start);
    app.canvas.dispatchEvent(change);
    expect(app.options.change).toHaveBeenCalledTimes(1);
  });
});
