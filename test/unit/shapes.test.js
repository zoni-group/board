import { describe, expect, it } from 'vitest';
import { cloneCommand, normalizeCommand, normalizeShapeObject } from '../../src/board/model.ts';
import {
  alignToGrid,
  arrowWings,
  constrainedEnd,
  drawShape,
  hitShape,
  hitShapeHandle,
  intersectsShape,
  isBox,
  isFillable,
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
  it.each([
    'rectangle',
    'ellipse',
    'line',
    'arrow',
    'triangle',
    'speechBubble',
    'numberLine',
    'axes',
  ])('normalizes and independently clones %s commands', (kind) => {
    const object = shape({ kind, start: { x: 50, y: 30 }, end: { x: -50, y: -30 } });
    const command = normalizeCommand({ type: 'shape-set', object });
    expect(command.object.kind).toBe(kind);
    expect(command.object.start).toEqual(isBox(kind) ? { x: -50, y: -30 } : { x: 50, y: 30 });
    const clone = cloneCommand(command);
    clone.object.start.x = 999;
    expect(command.object.start.x).not.toBe(999);
    expect(object.start.x).toBe(50);
  });
  it.each([
    { kind: 'star' },
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
      size: 6,
      inkRaw: '#111827',
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

describe('new shapes and fill', () => {
  it('keeps a valid fill on closed shapes and drops it elsewhere', () => {
    const blue = { color: '#2563EB', solid: true };
    expect(normalizeShapeObject(shape({ fill: blue })).fill).toEqual({
      color: '#2563eb',
      solid: true,
    });
    expect(normalizeShapeObject(shape({ fill: { color: 'outline', solid: 'yes' } })).fill).toEqual({
      color: 'outline',
    });
    for (const fill of [{ color: 'blue' }, { color: 3 }, 'red', null])
      expect(normalizeShapeObject(shape({ fill }))).not.toHaveProperty('fill');
    for (const kind of ['line', 'arrow', 'numberLine', 'axes'])
      expect(normalizeShapeObject(shape({ kind, fill: blue }))).not.toHaveProperty('fill');
    const copy = cloneCommand({ type: 'shape-set', object: shape({ fill: { color: '#2563eb' } }) });
    copy.object.fill.color = '#000000';
    expect(shape({ fill: { color: '#2563eb' } }).fill.color).toBe('#2563eb');
  });
  it('knows which shapes are boxes and which can be filled', () => {
    expect(['rectangle', 'ellipse', 'triangle', 'speechBubble'].every(isFillable)).toBe(true);
    expect(['line', 'arrow', 'numberLine', 'axes'].some(isFillable)).toBe(false);
    expect(['triangle', 'speechBubble', 'axes'].every(isBox)).toBe(true);
    expect(['line', 'arrow', 'numberLine'].some(isBox)).toBe(false);
  });
  it('selects inside a triangle and a speech bubble, but not outside the triangle', () => {
    const triangle = shape({ kind: 'triangle', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
    expect(hitShape(triangle, { x: 50, y: 70 }, 1)).toBe(true);
    expect(hitShape(triangle, { x: 8, y: 20 }, 1)).toBe(false);
    const bubble = shape({ kind: 'speechBubble', start: { x: 0, y: 0 }, end: { x: 200, y: 100 } });
    expect(hitShape(bubble, { x: 100, y: 40 }, 1)).toBe(true);
    // The tail reaches the bottom-left corner; the bottom-right corner is empty.
    expect(hitShape(bubble, { x: 22, y: 90 }, 1)).toBe(true);
    expect(hitShape(bubble, { x: 190, y: 95 }, 1)).toBe(false);
  });
  it('erases a filled shape from inside, an empty one only on its outline', () => {
    const inside = { x: 0, y: 0 };
    expect(intersectsShape(shape(), inside, inside, 4)).toBe(false);
    expect(intersectsShape(shape({ fill: { color: '#2563eb' } }), inside, inside, 4)).toBe(true);
  });
  it('includes arrowheads and ticks in number line and axes bounds', () => {
    const numberLine = shape({ kind: 'numberLine', start: { x: 0, y: 0 }, end: { x: 200, y: 0 } });
    const bounds = shapeBounds(numberLine);
    expect(bounds.x).toBeLessThanOrEqual(-2);
    expect(bounds.height).toBeGreaterThan(20);
    expect(hitShape(numberLine, { x: 100, y: 9 }, 1)).toBe(true);
    const axes = shape({ kind: 'axes', start: { x: 0, y: 0 }, end: { x: 200, y: 200 } });
    expect(hitShape(axes, { x: 100, y: 30 }, 1)).toBe(true);
    expect(hitShape(axes, { x: 30, y: 30 }, 1)).toBe(false);
    expect(shapeBounds(axes).width).toBeGreaterThanOrEqual(200);
  });
});

describe('number lines and axes on grid paper', () => {
  const numberLine = (overrides = {}) =>
    shape({ kind: 'numberLine', start: { x: 0, y: 0 }, end: { x: 192, y: 0 }, ...overrides });
  it('keeps the grid step only on number lines and axes', () => {
    expect(normalizeShapeObject(numberLine({ step: 32 })).step).toBe(32);
    expect(normalizeShapeObject(shape({ kind: 'axes', step: 16 })).step).toBe(16);
    for (const step of [0, 2, 2000, '32', Number.NaN])
      expect(normalizeShapeObject(numberLine({ step }))).not.toHaveProperty('step');
    for (const kind of ['line', 'arrow', 'rectangle'])
      expect(normalizeShapeObject(shape({ kind, step: 32 }))).not.toHaveProperty('step');
  });
  it('snaps number line ends to grid points, keeping at least one step', () => {
    const aligned = alignToGrid(
      numberLine({ step: 32, start: { x: 13, y: 50 }, end: { x: 200, y: 60 } })
    );
    expect(aligned.start).toEqual({ x: 0, y: 64 });
    expect(aligned.end).toEqual({ x: 192, y: 64 });
    const tiny = alignToGrid(numberLine({ step: 32, start: { x: 3, y: 3 }, end: { x: -8, y: 5 } }));
    expect(tiny.start).toEqual({ x: 0, y: 0 });
    expect(tiny.end).toEqual({ x: -32, y: 0 });
  });
  it('gives axes an even number of cells, so the origin is a grid point', () => {
    const axes = alignToGrid(
      shape({ kind: 'axes', step: 32, start: { x: 10, y: 20 }, end: { x: 170, y: 140 } })
    );
    expect(axes.start).toEqual({ x: 0, y: 32 });
    expect(axes.end).toEqual({ x: 192, y: 160 });
    const origin = { x: (axes.start.x + axes.end.x) / 2, y: (axes.start.y + axes.end.y) / 2 };
    expect(origin.x % 32).toBe(0);
    expect(origin.y % 32).toBe(0);
  });
  it('puts a tick on every grid line along the number line', () => {
    const stepped = numberLine({ step: 32 });
    for (const x of [32, 64, 96, 128, 160]) expect(hitShape(stepped, { x, y: 9 }, 1)).toBe(true);
    expect(hitShape(stepped, { x: 48, y: 9 }, 1)).toBe(false);
    const axes = shape({ kind: 'axes', step: 32, start: { x: 0, y: 0 }, end: { x: 256, y: 256 } });
    for (const x of [32, 64, 192, 224]) expect(hitShape(axes, { x, y: 128 + 9 }, 1)).toBe(true);
    expect(hitShape(axes, { x: 80, y: 128 + 9 }, 1)).toBe(false);
  });
  it('leaves shapes without a step unchanged', () => {
    const free = numberLine({ start: { x: 13, y: 50 } });
    expect(alignToGrid(free)).toBe(free);
  });
});

describe('number lines on grid paper stay straight', () => {
  it('levels a nearly level drag and uprights a nearly upright one', () => {
    const line = (end) =>
      alignToGrid(shape({ kind: 'numberLine', step: 16, start: { x: 37, y: 70 }, end }));
    expect(line({ x: 530, y: 75 }).end.y).toBe(line({ x: 530, y: 75 }).start.y);
    expect(line({ x: 45, y: 400 }).end.x).toBe(line({ x: 45, y: 400 }).start.x);
    // A clear diagonal is kept.
    expect(line({ x: 300, y: 300 }).end).toEqual({ x: 304, y: 304 });
  });
});

describe('axes arrows', () => {
  it('point both ways on each axis', () => {
    const axes = shape({ kind: 'axes', start: { x: 0, y: 0 }, end: { x: 256, y: 256 } });
    // Wing tips 12 units back from each end, 6 units off the axis line.
    for (const tip of [
      { x: 10.4, y: 134 },
      { x: 245.6, y: 134 },
      { x: 134, y: 10.4 },
      { x: 134, y: 245.6 },
    ])
      expect(hitShape(axes, tip, 1)).toBe(true);
  });
});
