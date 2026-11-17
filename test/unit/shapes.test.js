import { describe, expect, it } from 'vitest';
import { cloneCommand, normalizeCommand, normalizeShapeObject } from '../../src/board/model.ts';
import {
  arrowWings,
  constrainedEnd,
  drawShape,
  hitShape,
  hitShapeHandle,
  intersectsShape,
  resolveShapes,
  shapeBounds,
} from '../../src/board/shapes.ts';
import { createBoardScene, createDrawingCanvas } from '../../src/board/scene-renderer.ts';
import { textObject } from '../helpers/text-fixture.js';

const shape = (overrides = {}) => ({
  id: 'shape-1',
  kind: 'rectangle',
  start: { x: -50, y: -30 },
  end: { x: 50, y: 30 },
  size: 4,
  inkRaw: '#2563eb',
  ...overrides,
});

describe('typed shapes and geometry', () => {
  it('keeps small shapes movable while matching the closest resize handle', () => {
    const box = shape({ start: { x: 0, y: 0 }, end: { x: 20, y: 20 } });
    expect(hitShapeHandle(box, { x: 10, y: 10 }, 22)).toBe(-1);
    expect(hitShapeHandle(box, { x: 20, y: 0 }, 22)).toBe(1);
    const line = { ...box, kind: 'line', end: { x: 20, y: 0 } };
    expect(hitShapeHandle(line, { x: 10, y: 0 }, 22)).toBe(-1);
    expect(hitShapeHandle(line, { x: 18, y: 0 }, 22)).toBe(1);
  });
  it.each(['rectangle', 'ellipse', 'line', 'arrow'])(
    'normalizes and independently clones %s commands',
    (kind) => {
      const object = shape({ kind, start: { x: 50, y: 30 }, end: { x: -50, y: -30 } });
      const command = normalizeCommand({ type: 'shape-set', object });
      expect(command.object.kind).toBe(kind);
      expect(command.object.start).toEqual(
        kind === 'rectangle' || kind === 'ellipse' ? { x: -50, y: -30 } : { x: 50, y: 30 }
      );
      const clone = cloneCommand(command);
      clone.object.start.x = 999;
      expect(command.object.start.x).not.toBe(999);
      expect(object.start.x).toBe(50);
    }
  );
  it.each([
    { kind: 'triangle' },
    { id: '' },
    { start: { x: Infinity, y: 0 } },
    { size: 0 },
    { size: 1001 },
    { inkRaw: 'blue' },
    { end: { x: -50, y: 30 } },
    { kind: 'line', end: { x: -50, y: -30 } },
  ])('rejects malformed geometry and styles: %j', (overrides) => {
    expect(normalizeShapeObject(shape(overrides))).toBeNull();
  });
  it('allows vertical and horizontal lines and preserves arrow direction', () => {
    expect(normalizeShapeObject(shape({ kind: 'line', end: { x: -50, y: 100 } }))).not.toBeNull();
    expect(normalizeShapeObject(shape({ kind: 'arrow', end: { x: -100, y: -30 } })).start.x).toBe(
      -50
    );
    const eraser = normalizeCommand({
      type: 'stroke',
      tool: 'eraser',
      points: [{ x: 0, y: 0 }],
      erasedShapeIds: ['a', 'a', '', 2],
    });
    expect(eraser.erasedShapeIds).toEqual(['a']);
    const clone = cloneCommand(eraser);
    clone.erasedShapeIds.push('b');
    expect(eraser.erasedShapeIds).toEqual(['a']);
  });
  it('constrains boxes in every drag direction and lines to 45-degree angles', () => {
    const origin = { x: 0, y: 0 };
    expect(constrainedEnd('rectangle', origin, { x: -50, y: 10 }, true)).toEqual({ x: -50, y: 50 });
    expect(constrainedEnd('ellipse', origin, { x: 10, y: -50 }, true)).toEqual({ x: 50, y: -50 });
    const snapped = constrainedEnd('arrow', origin, { x: -100, y: 15 }, true);
    expect(snapped.x).toBeLessThan(0);
    expect(snapped.y).toBeCloseTo(0);
    const diagonal = constrainedEnd('line', origin, { x: 70, y: 90 }, true);
    expect(diagonal.x).toBeCloseTo(diagonal.y);
  });
  it('retains shape stacking order through edits, grouped erasure, deletion, clear, and undo replay', () => {
    const a = shape(),
      b = shape({ id: 'b' });
    const edited = shape({ inkRaw: '#ff0000' });
    const commands = [
      { type: 'shape-set', object: a },
      { type: 'shape-set', object: b },
      { type: 'shape-set', object: edited },
    ];
    expect(resolveShapes(commands)).toEqual([edited, b]);
    const erase = { type: 'stroke', tool: 'eraser', erasedShapeIds: [a.id, b.id] };
    expect(resolveShapes([...commands, erase])).toEqual([]);
    expect(resolveShapes(commands)).toEqual([edited, b]);
    expect(resolveShapes([...commands, { type: 'shape-delete', ids: [a.id] }])).toEqual([b]);
    expect(resolveShapes([...commands, { type: 'clear' }])).toEqual([]);
  });
  it('selects box interiors, but erases only outlines including swept crossings', () => {
    const box = shape();
    expect(hitShape(box, { x: 0, y: 0 }, 6)).toBe(true);
    expect(intersectsShape(box, { x: 0, y: 0 }, { x: 0, y: 0 }, 3)).toBe(false);
    expect(intersectsShape(box, { x: -100, y: 0 }, { x: 100, y: 0 }, 1)).toBe(true);
    expect(intersectsShape(box, { x: -100, y: 40 }, { x: 100, y: 40 }, 1)).toBe(false);
    const ellipse = shape({ kind: 'ellipse' });
    expect(hitShape(ellipse, { x: 0, y: 0 }, 1)).toBe(true);
    expect(hitShape(ellipse, { x: 49, y: 29 }, 1)).toBe(false);
    expect(intersectsShape(ellipse, { x: -100, y: 0 }, { x: 100, y: 0 }, 1)).toBe(true);
    expect(intersectsShape(ellipse, { x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toBe(false);
  });
  it('hit-tests thin ellipses, diagonal lines and arrow wings with stroke width', () => {
    const ellipse = shape({ kind: 'ellipse', start: { x: 0, y: 0 }, end: { x: 1000, y: 4 } });
    expect(hitShape(ellipse, { x: 500, y: 5 }, 1)).toBe(true);
    expect(hitShape(ellipse, { x: 500, y: 10 }, 1)).toBe(false);
    const line = shape({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
    expect(hitShape(line, { x: 50, y: 53 }, 1)).toBe(true);
    expect(hitShape(line, { x: 20, y: 70 }, 1)).toBe(false);
    const arrow = shape({ kind: 'arrow', start: { x: 0, y: 0 }, end: { x: -100, y: 0 } });
    for (const wing of arrowWings(arrow)) expect(hitShape(arrow, wing, 1)).toBe(true);
    expect(shapeBounds(arrow).height).toBeGreaterThan(4);
  });
  it('includes visible shapes and arrowheads in Fit/export bounds and draws them before text', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    const object = shape({ kind: 'arrow' });
    const commands = [
      { type: 'shape-set', object },
      { type: 'shape-set', object: shape({ id: 'removed', end: { x: 5000, y: 5000 } }) },
      { type: 'shape-delete', ids: ['removed'] },
    ];
    const scene = createBoardScene(commands, ctx);
    expect(scene.bounds).toEqual(shapeBounds(object));
    const withText = createBoardScene(
      [...commands, { type: 'text-set', object: textObject() }],
      ctx
    );
    const out = createDrawingCanvas(
      withText,
      { width: 300, height: 200 },
      '#ffffff',
      (ink) => ink
    ).canvas.getContext('2d');
    expect(out.lineTo).toHaveBeenCalledTimes(3);
    expect(out.stroke).toHaveBeenCalledOnce();
    expect(out.strokeStyle).toBe('#2563eb');
    expect(out.stroke.mock.invocationCallOrder[0]).toBeLessThan(
      out.fillText.mock.invocationCallOrder[0]
    );
    drawShape(ctx, shape({ kind: 'ellipse' }), (ink) => ink);
    expect(ctx.ellipse).toHaveBeenCalledWith(0, 0, 50, 30, 0, 0, Math.PI * 2);
  });
});
