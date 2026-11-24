import { describe, expect, it } from 'vitest';
import { cloneCommand, normalizeCommand, normalizeCommands } from '../../src/board/model.ts';
import {
  applyStrokeStyle,
  HIGHLIGHT_ALPHA,
  inkBounds,
  inkPaintOrder,
  pressureWidth,
  resolveInk,
  strokeBounds,
} from '../../src/board/ink.ts';

const pen = (id = 'a') => ({
  type: 'stroke',
  tool: 'pen',
  id,
  size: 6,
  inkRaw: '#2563eb',
  points: [
    { x: 10, y: 20 },
    { x: 100, y: 20 },
  ],
});
const erase = (x = 50) => ({
  type: 'stroke',
  tool: 'eraser',
  size: 20,
  inkRaw: '#000000',
  points: [{ x, y: 20 }],
});

describe('editable ink', () => {
  it('requires a stable stroke identity in the current format', () => {
    const invalid = { ...pen() };
    delete invalid.id;
    expect(normalizeCommand(invalid)).toBeNull();
    expect(normalizeCommands([invalid, pen()])).toEqual([pen()]);
  });
  it('keeps geometry immutable and moves existing gaps with the stroke', () => {
    const commands = [
      pen(),
      erase(),
      { type: 'stroke-edit', id: 'a', translate: { x: 200, y: -30 } },
    ];
    const saved = JSON.stringify(commands);
    const object = resolveInk(commands)[0];
    expect(object.stroke.points).toBe(commands[0].points);
    expect(object.offset).toEqual({ x: 200, y: -30 });
    expect(object.erasures[0].points).toEqual([{ x: 50, y: 20 }]);
    expect(inkBounds(object)).toEqual({ x: 207, y: -13, width: 96, height: 6 });
    expect(JSON.stringify(commands)).toBe(saved);
  });
  it('converts subsequent erasing into moved object coordinates and restores it on undo replay', () => {
    const commands = [
      pen(),
      erase(),
      { type: 'stroke-edit', id: 'a', translate: { x: 200, y: 0 } },
      erase(275),
    ];
    const object = resolveInk(commands)[0];
    expect(object.erasures.map((mask) => mask.points[0])).toEqual([
      { x: 50, y: 20 },
      { x: 75, y: 20 },
    ]);
    const moved = resolveInk([
      ...commands,
      { type: 'stroke-edit', id: 'a', translate: { x: -100, y: 40 } },
    ])[0];
    expect(moved.offset).toEqual({ x: 100, y: 40 });
    expect(moved.erasures).toEqual(object.erasures);
    expect(resolveInk(commands.slice(0, -1))[0].erasures).toHaveLength(1);
  });
  it('preserves creation order, styles and masks through edits, deletion, and clear', () => {
    const commands = [
      pen('a'),
      pen('b'),
      erase(),
      { type: 'stroke-edit', id: 'a', size: 12, inkRaw: '#cc0000' },
    ];
    expect(resolveInk(commands).map((o) => o.id)).toEqual(['a', 'b']);
    expect(resolveInk(commands)[0].stroke).toMatchObject({ size: 12, inkRaw: '#cc0000' });
    expect(resolveInk(commands)[0].erasures).toHaveLength(1);
    expect(
      resolveInk([...commands, { type: 'stroke-delete', ids: ['a'] }]).map((o) => o.id)
    ).toEqual(['b']);
    expect(resolveInk([...commands, { type: 'clear' }])).toEqual([]);
    expect(
      resolveInk([{ type: 'stroke-edit', id: 'missing', translate: { x: 10, y: 10 } }])
    ).toEqual([]);
  });
  it('only applies an eraser to strokes already present in that area', () => {
    const far = { ...pen('far'), points: [{ x: 10000, y: 10000 }] };
    const objects = resolveInk([pen(), far, erase(), pen('later')]);
    expect(objects.map((o) => o.erasures.length)).toEqual([1, 0, 0]);
  });
  it.each([
    { id: '' },
    { translate: { x: Infinity, y: 0 } },
    { translate: null },
    { size: 0 },
    { size: 1001 },
    { inkRaw: 'red' },
  ])('rejects malformed stroke edits: %j', (patch) => {
    expect(
      normalizeCommand({ type: 'stroke-edit', id: 'a', translate: { x: 10, y: 0 }, ...patch })
    ).toBeNull();
  });
  it('clones edit deltas and deleted ID lists, and rejects an empty edit', () => {
    const command = {
      type: 'stroke-edit',
      id: 'a',
      translate: { x: -20.5, y: 10 },
      size: 8,
      inkRaw: '#123456',
    };
    const copy = cloneCommand(normalizeCommand(command));
    copy.translate.x = 0;
    expect(command.translate.x).toBe(-20.5);
    expect(normalizeCommand({ type: 'stroke-edit', id: 'a' })).toBeNull();
    const deletion = normalizeCommand({ type: 'stroke-delete', ids: ['a', 'a', '', 2] });
    expect(deletion.ids).toEqual(['a']);
    cloneCommand(deletion).ids.push('b');
    expect(deletion.ids).toEqual(['a']);
  });
});

describe('highlighter ink', () => {
  const highlight = (id) => ({ ...pen(id), size: 18, inkRaw: '#f59e0b', pen: 'highlighter' });

  it('survives validation and cloning, and drops unknown pen types', () => {
    expect(normalizeCommand(highlight('h'))).toEqual(highlight('h'));
    expect(cloneCommand(highlight('h'))).toEqual(highlight('h'));
    expect(normalizeCommand({ ...pen('x'), pen: 'laser' })).toEqual(pen('x'));
    expect(normalizeCommand({ ...pen('x'), pen: 'crayon' })).toEqual(pen('x'));
  });

  it('paints highlights under pen ink and keeps creation order within each group', () => {
    const objects = resolveInk([pen('a'), highlight('h1'), pen('b'), highlight('h2')]);
    expect(inkPaintOrder(objects).map((object) => object.id)).toEqual(['h1', 'h2', 'a', 'b']);
  });

  it('keeps moves and restyles on highlights', () => {
    const [object] = resolveInk([
      highlight('h'),
      { type: 'stroke-edit', id: 'h', translate: { x: 5, y: 0 }, inkRaw: '#10b981' },
    ]);
    expect(object.stroke).toMatchObject({ pen: 'highlighter', inkRaw: '#10b981' });
    expect(object.offset).toEqual({ x: 5, y: 0 });
  });

  it('is see-through, while pen ink and erasers stay opaque', () => {
    const ctx = {};
    applyStrokeStyle(ctx, highlight('h'), () => '#000000');
    expect(ctx.globalAlpha).toBe(HIGHLIGHT_ALPHA);
    expect(ctx.strokeStyle).toBe('#f59e0b'); // not darkened for contrast
    applyStrokeStyle(ctx, pen('a'), (raw) => raw);
    expect(ctx.globalAlpha).toBe(1);
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    applyStrokeStyle(ctx, erase(), (raw) => raw);
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.globalCompositeOperation).toBe('destination-out');
  });
});

describe('stylus pressure', () => {
  const pressed = (pressure, extra = {}) => ({ ...pen(), pressure, ...extra });

  it('keeps pressure that matches the points, and draws half pressure at the chosen size', () => {
    expect(normalizeCommand(pressed([0.2, 0.9]))).toEqual(pressed([0.2, 0.9]));
    expect(pressureWidth(6, 0.5)).toBeCloseTo(6);
    expect(pressureWidth(6, 1)).toBeGreaterThan(pressureWidth(6, 0.1));
  });
  it('drops pressure that is unusable, so the stroke draws at an even width', () => {
    for (const pressure of [[0.5], [0.5, 1.5], [0.5, Number.NaN], 'x'])
      expect(normalizeCommand(pressed(pressure))).toEqual(pen());
    expect(normalizeCommand(pressed([0.2, 0.9], { pen: 'highlighter' }))).toEqual({
      ...pen(),
      pen: 'highlighter',
    });
  });
  it('copies pressure with the stroke and widens its bounds for a firm press', () => {
    const stroke = pressed([0.2, 1]);
    const copy = cloneCommand(stroke);
    expect(copy.pressure).toEqual([0.2, 1]);
    expect(copy.pressure).not.toBe(stroke.pressure);
    expect(strokeBounds(stroke).height).toBeGreaterThan(strokeBounds(pen()).height);
    expect(strokeBounds(pressed([0.1, 0.1])).height).toBeLessThan(strokeBounds(pen()).height);
  });
});
