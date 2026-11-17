import { describe, expect, it } from 'vitest';
import { cloneCommand, normalizeCommand, normalizeCommands } from '../../src/board/model.ts';
import { inkBounds, resolveInk } from '../../src/board/ink.ts';

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
