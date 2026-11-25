import { describe, expect, it } from 'vitest';
import { canReorder, reorderCommands, stackOrder, stampZ, topZ } from '../../src/board/stacking.ts';
import { createBoardScene, createDrawingCanvas } from '../../src/board/scene-renderer.ts';
import { cloneCommand, normalizeCommand } from '../../src/board/model.ts';
import { resolveInk } from '../../src/board/ink.ts';

const pen = (id, z, extra = {}) => ({
  type: 'stroke',
  tool: 'pen',
  id,
  size: 4,
  inkRaw: '#111827',
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ],
  ...(z === undefined ? {} : { z }),
  ...extra,
});
const card = (id, z, x = 0) => ({
  type: 'shape-set',
  object: {
    id,
    kind: 'rectangle',
    start: { x, y: -10 },
    end: { x: x + 40, y: 30 },
    size: 4,
    inkRaw: '#2563eb',
    fill: { color: '#2563eb', solid: true },
    ...(z === undefined ? {} : { z }),
  },
});
const words = (id, z) => ({
  type: 'text-set',
  object: {
    id,
    position: { x: 0, y: 0 },
    paragraphs: [
      {
        align: 'left',
        runs: [{ text: 'Hola', fontSize: 24, inkRaw: '#111827', bold: false, italic: false }],
      },
    ],
    ...(z === undefined ? {} : { z }),
  },
});
const picture = (id, z) => ({
  type: 'content-set',
  object: {
    kind: 'image',
    id,
    position: { x: 0, y: 0 },
    width: 40,
    height: 40,
    title: 'p',
    assetId: 'a',
    ...(z === undefined ? {} : { z }),
  },
});
const ctx = () => document.createElement('canvas').getContext('2d');
const scene = (commands) => createBoardScene(commands, ctx());
const keys = (s) => stackOrder(s).map((o) => `${o.kind}:${o.value.id}`);
const box = { x: 0, y: 0, width: 40, height: 40 };
const near = () => box;
/** Applies commands and returns the new stack. */
function apply(commands, more) {
  return keys(scene([...commands, ...more]));
}

describe('stacking order', () => {
  it('keeps the old layers for objects saved before stacking, below newer ones', () => {
    const s = scene([
      words('t'),
      card('s'),
      pen('ink'),
      pen('hl', undefined, { pen: 'highlighter' }),
      picture('img'),
      pen('new', 0),
      picture('newer', 1),
    ]);
    expect(keys(s)).toEqual([
      'image:img',
      'stroke:hl',
      'stroke:ink',
      'shape:s',
      'text:t',
      'stroke:new',
      'image:newer',
    ]);
    expect(topZ(s)).toBe(2);
    expect(topZ(scene([words('t')]))).toBe(0);
  });

  it('stamps new objects on top and keeps the place of edited ones', () => {
    const s = scene([card('a', 3), words('t', 5), words('old')]);
    const batch = stampZ(s, {
      type: 'batch',
      commands: [pen('p'), card('b'), card('b'), words('t'), words('old')],
    });
    expect(batch.commands.map((c) => (c.type === 'stroke' ? c.z : c.object.z))).toEqual([
      6,
      7,
      7,
      5,
      undefined,
    ]);
    // Erasers and deletes are left alone.
    const eraser = { type: 'stroke', tool: 'eraser', size: 8, inkRaw: '#000000', points: [] };
    expect(stampZ(s, eraser)).toBe(eraser);
  });

  it('brings to front and sends to back, keeping a group in order', () => {
    const base = [card('a', 0), card('b', 1), card('c', 2), card('d', 3)];
    const s = scene(base);
    const refs = [
      { kind: 'shape', id: 'a' },
      { kind: 'shape', id: 'b' },
    ];
    const front = reorderCommands(s, refs, 'front', near);
    expect(front.map((c) => c.object.z)).toEqual([4, 5]);
    expect(apply(base, front)).toEqual(['shape:c', 'shape:d', 'shape:a', 'shape:b']);
    const back = reorderCommands(s, [{ kind: 'shape', id: 'd' }], 'back', near);
    expect(apply(base, back)).toEqual(['shape:d', 'shape:a', 'shape:b', 'shape:c']);
    expect(back[0].object.z).toBeLessThan(0);
    expect(reorderCommands(s, [{ kind: 'shape', id: 'd' }], 'front', near)).toBeNull();
    expect(canReorder(s, [{ kind: 'shape', id: 'd' }], 'front', near)).toBe(false);
    expect(canReorder(s, [{ kind: 'shape', id: 'd' }], 'back', near)).toBe(true);
  });

  it('steps past the next overlapping object, skipping ones elsewhere', () => {
    const base = [card('a', 0, 0), card('far', 1, 500), card('b', 2, 10), card('c', 3, 20)];
    const s = scene(base);
    const bounds = (o) => ({ x: o.value.start.x, y: 0, width: 40, height: 40 });
    const forward = reorderCommands(s, [{ kind: 'shape', id: 'a' }], 'forward', bounds);
    expect(forward).toHaveLength(1);
    expect(forward[0].object.z).toBe(2.5);
    expect(apply(base, forward)).toEqual(['shape:far', 'shape:b', 'shape:a', 'shape:c']);
    const backward = reorderCommands(s, [{ kind: 'shape', id: 'c' }], 'backward', bounds);
    expect(apply(base, backward)).toEqual(['shape:a', 'shape:far', 'shape:c', 'shape:b']);
    // Nothing overlaps: one place.
    const alone = reorderCommands(s, [{ kind: 'shape', id: 'far' }], 'forward', bounds);
    expect(apply(base, alone)).toEqual(['shape:a', 'shape:b', 'shape:far', 'shape:c']);
  });

  it('numbers every object once on a page saved before stacking, then moves only the selection', () => {
    const base = [picture('img'), pen('ink'), words('t')];
    const s = scene(base);
    const commands = reorderCommands(s, [{ kind: 'image', id: 'img' }], 'front', near);
    expect(commands).toHaveLength(3);
    expect(commands.find((c) => c.type === 'stroke-edit')).toEqual({
      type: 'stroke-edit',
      id: 'ink',
      z: 0,
    });
    const after = [...base, ...commands];
    expect(keys(scene(after))).toEqual(['stroke:ink', 'text:t', 'image:img']);
    const next = reorderCommands(scene(after), [{ kind: 'text', id: 't' }], 'back', near);
    expect(next).toHaveLength(1);
    expect(keys(scene([...after, ...next]))).toEqual(['text:t', 'stroke:ink', 'image:img']);
  });

  it('renumbers when positions get too close', () => {
    const base = [card('a', 0), card('b', 1e-7), card('c', 2e-7)];
    const commands = reorderCommands(scene(base), [{ kind: 'shape', id: 'c' }], 'backward', near);
    expect(commands.every((c) => Number.isInteger(c.object.z))).toBe(true);
    expect(apply(base, commands)).toEqual(['shape:a', 'shape:c', 'shape:b']);
  });

  it('loads, clones and applies stack positions, including on stroke edits', () => {
    expect(normalizeCommand(card('a', 2)).object.z).toBe(2);
    expect(normalizeCommand(card('a', Infinity)).object).not.toHaveProperty('z');
    expect(normalizeCommand(words('t', -1)).object.z).toBe(-1);
    expect(normalizeCommand(picture('i', 0.5)).object.z).toBe(0.5);
    expect(normalizeCommand(pen('p', 4)).z).toBe(4);
    const edit = normalizeCommand({ type: 'stroke-edit', id: 'p', z: 9 });
    expect(edit).toEqual({ type: 'stroke-edit', id: 'p', z: 9 });
    expect(normalizeCommand({ type: 'stroke-edit', id: 'p', z: 'x' })).toBeNull();
    expect(cloneCommand(words('t', 3)).object.z).toBe(3);
    expect(resolveInk([pen('p', 1), edit])[0].stroke.z).toBe(9);
  });

  it('draws in stack order: ink above a card, or under it once sent back', () => {
    // A dot of ink (an arc) and an oval card (an ellipse): which is drawn last?
    const dot = (z) => pen('p', z, { points: [{ x: 10, y: 10 }] });
    const oval = (z) => {
      const command = card('a', z);
      command.object.kind = 'ellipse';
      return command;
    };
    const top = (commands) => {
      const out = createDrawingCanvas(
        scene(commands),
        { width: 320, height: 240 },
        '#ffffff',
        (i) => i
      ).canvas.getContext('2d');
      return out.arc.mock.invocationCallOrder.at(-1) > out.ellipse.mock.invocationCallOrder.at(-1)
        ? 'ink on top'
        : 'card on top';
    };
    expect(top([oval(0), dot(1)])).toBe('ink on top');
    expect(top([oval(1), dot(0)])).toBe('card on top');
    // Saved before stacking: shapes stay above ink, as before.
    expect(top([dot(), oval()])).toBe('card on top');
    expect(top([oval(), dot()])).toBe('card on top');
  });
});
