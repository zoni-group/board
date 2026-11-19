import { describe, expect, it } from 'vitest';
import {
  cloneCommand,
  expandCommands,
  normalizeCommand,
  normalizeCommands,
} from '../../src/board/model.ts';

describe('board command validation', () => {
  it.each([
    null,
    undefined,
    42,
    [],
    {},
    'stroke',
    { type: 'text' },
    { type: 'stroke', points: [] },
  ])('rejects malformed or unsupported commands: %j', (value) => {
    expect(normalizeCommand(value)).toBeNull();
  });

  it('requires valid current stroke fields and preserves finite coordinates', () => {
    const stroke = {
      type: 'stroke',
      id: 'pen-1',
      tool: 'pen',
      size: 6,
      inkRaw: '#111827',
      points: [{ x: -2.5, y: 3 }],
    };
    expect(normalizeCommand(stroke)).toEqual(stroke);
    for (const bad of [
      { ...stroke, tool: 'unsupported' },
      { ...stroke, size: Infinity },
      { ...stroke, inkRaw: null },
      { ...stroke, points: [{ x: 2, y: 3 }, null] },
    ])
      expect(normalizeCommand(bad)).toBeNull();
  });
  it('preserves erasers and clear commands while dropping invalid history entries', () => {
    const eraser = {
      type: 'stroke',
      tool: 'eraser',
      size: 12,
      inkRaw: '#2563eb',
      points: [{ x: 1, y: 2 }],
    };
    expect(
      normalizeCommands([null, eraser, { type: 'clear', extra: true }, { type: 'stroke' }])
    ).toEqual([eraser, { type: 'clear' }]);
    expect(normalizeCommands({ commands: [] })).toEqual([]);
  });
});

describe('batch commands', () => {
  const stroke = (id) => ({
    type: 'stroke',
    tool: 'pen',
    id,
    size: 6,
    inkRaw: '#111827',
    points: [{ x: 0, y: 0 }],
  });
  const move = (id) => ({ type: 'stroke-edit', id, translate: { x: 5, y: 0 } });

  it('round-trips through validation and cloning without sharing data', () => {
    const batch = { type: 'batch', commands: [move('a'), { type: 'stroke-delete', ids: ['b'] }] };
    expect(normalizeCommand(batch)).toEqual(batch);
    const copy = cloneCommand(batch);
    expect(copy).toEqual(batch);
    copy.commands[0].translate.x = 99;
    expect(batch.commands[0].translate.x).toBe(5);
  });

  it('drops invalid, nested and clear entries, and rejects empty batches', () => {
    expect(
      normalizeCommand({
        type: 'batch',
        commands: [
          move('a'),
          { type: 'clear' },
          { type: 'batch', commands: [move('b')] },
          { type: 'stroke-edit' },
        ],
      })
    ).toEqual({ type: 'batch', commands: [move('a')] });
    expect(normalizeCommand({ type: 'batch', commands: [] })).toBeNull();
    expect(normalizeCommand({ type: 'batch', commands: [{ type: 'clear' }] })).toBeNull();
    expect(normalizeCommand({ type: 'batch' })).toBeNull();
  });

  it('expands batches in order for resolvers', () => {
    const commands = [
      stroke('a'),
      { type: 'batch', commands: [move('a'), move('b')] },
      { type: 'clear' },
    ];
    expect([...expandCommands(commands)]).toEqual([
      stroke('a'),
      move('a'),
      move('b'),
      { type: 'clear' },
    ]);
  });
});
