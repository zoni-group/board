import { describe, expect, it } from 'vitest';
import { normalizeCommand, normalizeCommands } from '../../src/board/model.ts';

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
