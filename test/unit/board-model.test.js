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

  it('keeps finite board coordinates and applies the existing stroke defaults', () => {
    expect(
      normalizeCommand({
        type: 'stroke',
        tool: 'unsupported',
        size: Infinity,
        inkRaw: null,
        points: [
          null,
          { x: '1', y: 2 },
          { x: NaN, y: 2 },
          { x: 1, y: Infinity },
          { x: -2.5, y: 3 },
        ],
      })
    ).toEqual({
      type: 'stroke',
      tool: 'pen',
      size: 6,
      inkRaw: '#111827',
      points: [{ x: -2.5, y: 3 }],
    });
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
