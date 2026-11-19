import { describe, expect, it } from 'vitest';
import {
  boundsInRegion,
  boxPolygon,
  objectsInRegion,
  pointInPolygon,
  strokeInRegion,
} from '../../src/board/marquee.ts';
import { createBoardScene } from '../../src/board/scene-renderer.ts';
import { resolveInk } from '../../src/board/ink.ts';
import { resolveShapes } from '../../src/board/shapes.ts';
import { resolveTextObjects } from '../../src/board/text-scene.ts';
import { textObject } from '../helpers/text-fixture.js';

const stroke = (id, points) => ({
  type: 'stroke',
  tool: 'pen',
  id,
  size: 4,
  inkRaw: '#111827',
  points,
});
const line = (id, x0, x1, y = 50) =>
  stroke(
    id,
    Array.from({ length: 5 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 4, y }))
  );
const shape = (id, start, end) => ({
  type: 'shape-set',
  object: { id, kind: 'rectangle', start, end, size: 2, inkRaw: '#111827' },
});

describe('selection regions', () => {
  it('tests points against concave lassos', () => {
    // A "C" shape: the notch at the right is outside.
    const c = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 40, y: 30 },
      { x: 40, y: 70 },
      { x: 100, y: 70 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 20, y: 50 }, c)).toBe(true);
    expect(pointInPolygon({ x: 70, y: 50 }, c)).toBe(false);
    expect(pointInPolygon({ x: 70, y: 10 }, c)).toBe(true);
  });

  it('catches strokes with at least 75% of their points inside, including moved strokes', () => {
    const box = boxPolygon({ x: 0, y: 0 }, { x: 100, y: 100 });
    const [inside, mostly, partly] = resolveInk([
      line('a', 10, 90),
      line('b', 10, 120), // 4 of 5 points inside
      line('c', 60, 160), // 2 of 5 inside
    ]);
    expect(strokeInRegion(inside, box)).toBe(true);
    expect(strokeInRegion(mostly, box)).toBe(true);
    expect(strokeInRegion(partly, box)).toBe(false);
    expect(strokeInRegion({ ...inside, offset: { x: 200, y: 0 } }, box)).toBe(false);
  });

  it('catches boxes by their center and at least three corners', () => {
    const region = boxPolygon({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(boundsInRegion({ x: 10, y: 10, width: 50, height: 50 }, region)).toBe(true);
    expect(boundsInRegion({ x: 70, y: 10, width: 50, height: 50 }, region)).toBe(false);
    // A triangle covering three corners and the center.
    const triangle = [
      { x: -10, y: -10 },
      { x: 120, y: -10 },
      { x: -10, y: 120 },
    ];
    expect(boundsInRegion({ x: 0, y: 0, width: 40, height: 40 }, triangle)).toBe(true);
  });

  it('collects every caught object kind from the scene', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    const text = textObject({ id: 'far', position: { x: 900, y: 900 } });
    const scene = createBoardScene(
      [
        line('a', 10, 40),
        line('b', 50, 90),
        line('outside', 300, 400),
        shape('s', { x: 20, y: 60 }, { x: 80, y: 90 }),
        { type: 'text-set', object: text },
      ],
      ctx
    );
    const refs = objectsInRegion(scene, boxPolygon({ x: 0, y: 0 }, { x: 100, y: 100 }), ctx);
    expect(refs).toEqual([
      { kind: 'stroke', id: 'a' },
      { kind: 'stroke', id: 'b' },
      { kind: 'shape', id: 's' },
    ]);
  });
});

describe('batched edits in resolvers', () => {
  it('move and delete several objects exactly like separate commands, and undo together', () => {
    const base = [line('a', 0, 10), line('b', 20, 30), shape('s', { x: 0, y: 0 }, { x: 5, y: 5 })];
    const parts = [
      { type: 'stroke-edit', id: 'a', translate: { x: 7, y: 0 } },
      { type: 'stroke-delete', ids: ['b'] },
      shape('s', { x: 7, y: 0 }, { x: 12, y: 5 }),
    ];
    const batched = [...base, { type: 'batch', commands: parts }];
    expect(resolveInk(batched)).toEqual(resolveInk([...base, ...parts]));
    expect(resolveShapes(batched)).toEqual(resolveShapes([...base, ...parts]));
    // Undo removes the single batch entry and restores everything.
    expect(resolveInk(batched.slice(0, -1))).toEqual(resolveInk(base));
    expect(resolveShapes(batched.slice(0, -1))).toEqual(resolveShapes(base));
  });

  it('applies text deletion inside a batch', () => {
    const text = textObject({ id: 't' });
    expect(
      resolveTextObjects([
        { type: 'text-set', object: text },
        { type: 'batch', commands: [{ type: 'text-delete', ids: ['t'] }] },
      ])
    ).toEqual([]);
  });
});
