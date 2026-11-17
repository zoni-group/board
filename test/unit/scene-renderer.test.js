import { renderInk, resolveInk, inkBounds } from '../../src/board/ink.ts';
import { describe, expect, it, vi } from 'vitest';
import { createBoardScene, createDrawingCanvas } from '../../src/board/scene-renderer.ts';
import { textObject } from '../helpers/text-fixture.js';
import { initialViewport } from '../../src/board/viewport.ts';

const size = { width: 320, height: 240 };
const stroke = (x, tool = 'pen') => ({
  type: 'stroke',
  ...(tool === 'pen' ? { id: `pen-${x}` } : {}),
  tool,
  size: 10,
  inkRaw: '#0000ff',
  points: [{ x, y: 50 }],
});

describe('shared scene rendering', () => {
  it('bounds current pen strokes and text without including cleared content or eraser paths', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    const commands = [
      stroke(-500),
      { type: 'clear' },
      stroke(-50),
      stroke(9000, 'eraser'),
      { type: 'text-set', object: textObject() },
    ];
    const scene = createBoardScene(commands, ctx);
    expect(scene.strokes).toHaveLength(1);
    expect(scene.bounds.x).toBe(-55);
    expect(scene.bounds.width).toBeLessThan(150);
    expect(scene.text).toHaveLength(1);
    expect(inkBounds(scene.strokes[0])).toEqual({ x: -55, y: 45, width: 10, height: 10 });
    expect(
      createBoardScene([...commands, { type: 'text-delete', ids: ['text-1'] }], ctx).text
    ).toEqual([]);
  });
  it('culls thousands of offscreen strokes without enlarging the canvas', () => {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    const strokes = [stroke(50), ...Array.from({ length: 5000 }, (_, i) => stroke(10000 + i * 10))];
    renderInk(ctx, resolveInk(strokes), initialViewport(size), size, 1, (ink) => ink);
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect([canvas.width, canvas.height]).toEqual([320, 240]);
  });
  it('applies erasers to a separate ink surface before an opaque export background and text', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    const object = textObject();
    object.paragraphs[0].runs[0].highlightRaw = '#fff176';
    const scene = createBoardScene(
      [stroke(50), stroke(50, 'eraser'), { type: 'text-set', object }],
      ctx
    );
    const { canvas } = createDrawingCanvas(scene, size, '#ffffff', (ink) => ink);
    const out = canvas.getContext('2d');
    expect(out.drawImage).toHaveBeenCalledTimes(1);
    const ink = out.drawImage.mock.calls[0][0].getContext('2d');
    const isolated = ink.drawImage.mock.calls[0][0].getContext('2d');
    expect(isolated.arc).toHaveBeenCalledTimes(2);
    expect(isolated.globalCompositeOperation).toBe('destination-out');
    expect(out.fillText).toHaveBeenCalledWith('Hello', expect.any(Number), expect.any(Number));
    expect(out.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      out.drawImage.mock.invocationCallOrder[0]
    );
  });
});
