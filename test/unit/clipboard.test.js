import { describe, expect, it } from 'vitest';
import {
  centerDelta,
  cloneItems,
  copyOffset,
  itemAssetIds,
  pasteDelta,
  placeCopies,
  snapDelta,
  strokeFromInk,
  withAssetIds,
} from '../../src/board/clipboard.ts';
import { cloneCommand, normalizeCommand } from '../../src/board/model.ts';
import { resolveInk } from '../../src/board/ink.ts';

const pen = (overrides = {}) => ({
  type: 'stroke',
  tool: 'pen',
  id: 'ink-1',
  size: 4,
  inkRaw: '#111827',
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ],
  ...overrides,
});
const shape = (overrides = {}) => ({
  id: 'shape-1',
  kind: 'rectangle',
  start: { x: 10, y: 10 },
  end: { x: 50, y: 40 },
  size: 4,
  inkRaw: '#111827',
  ...overrides,
});
const text = {
  id: 'text-1',
  position: { x: 5, y: 5 },
  paragraphs: [
    {
      align: 'left',
      runs: [{ text: 'Hola', fontSize: 24, inkRaw: '#111827', bold: false, italic: false }],
    },
  ],
};
const image = {
  kind: 'image',
  id: 'img-1',
  position: { x: 0, y: 0 },
  width: 100,
  height: 80,
  title: 'cat.png',
  assetId: 'asset-1',
};
let counter = 0;
const ids = () => `new-${++counter}`;

describe('board clipboard', () => {
  it('bakes moves, colour and erased parts into a copied stroke', () => {
    const [ink] = resolveInk([
      pen(),
      {
        type: 'stroke',
        tool: 'eraser',
        size: 10,
        inkRaw: '#000000',
        points: [{ x: 20, y: 0 }],
      },
      { type: 'stroke-edit', id: 'ink-1', translate: { x: 100, y: 50 }, inkRaw: '#2563eb' },
    ]);
    const stroke = strokeFromInk(ink);
    expect(stroke.points).toEqual([
      { x: 100, y: 50 },
      { x: 140, y: 50 },
    ]);
    expect(stroke.inkRaw).toBe('#2563eb');
    expect(stroke.erasures).toEqual([{ size: 10, points: [{ x: 120, y: 50 }] }]);
    // The copy resolves to the same look: the erased part stays erased.
    const [copy] = resolveInk([stroke]);
    expect(copy.offset).toEqual({ x: 0, y: 0 });
    expect(copy.erasures).toHaveLength(1);
    expect(copy.erasures[0].points).toEqual([{ x: 120, y: 50 }]);
  });

  it('keeps valid erasure masks on load and drops bad ones', () => {
    const loaded = normalizeCommand(
      pen({
        erasures: [
          { size: 8, points: [{ x: 1, y: 2 }] },
          { size: -1, points: [{ x: 1, y: 2 }] },
          { size: 8, points: [] },
          { size: 8, points: [{ x: 'a', y: 2 }] },
        ],
      })
    );
    expect(loaded.erasures).toEqual([{ size: 8, points: [{ x: 1, y: 2 }] }]);
    expect(normalizeCommand(pen({ erasures: 'nope' }))).not.toHaveProperty('erasures');
    const highlighter = normalizeCommand(pen({ pen: 'highlighter', pressure: [0.5, 0.5] }));
    expect(highlighter.pen).toBe('highlighter');
    expect(highlighter).not.toHaveProperty('pressure');
    const clone = cloneCommand(loaded);
    expect(clone.erasures).toEqual(loaded.erasures);
    expect(clone.erasures[0].points).not.toBe(loaded.erasures[0].points);
  });

  it('places moved copies with new ids, one command per object', () => {
    const items = [
      { kind: 'stroke', value: pen({ pressure: [0.2, 0.8] }) },
      { kind: 'shape', value: shape({ fill: { color: '#2563eb' } }) },
      { kind: 'text', value: text },
      { kind: 'content', value: image },
    ];
    const { commands, refs } = placeCopies(items, { x: 24, y: 24 }, ids);
    expect(refs.map((ref) => ref.kind)).toEqual(['stroke', 'shape', 'text', 'image']);
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(4);
    expect(refs.every((ref) => ref.id.startsWith('new-'))).toBe(true);
    expect(commands.map((command) => command.type)).toEqual([
      'stroke',
      'shape-set',
      'text-set',
      'content-set',
    ]);
    expect(commands[0].points[0]).toEqual({ x: 24, y: 24 });
    expect(commands[0].pressure).toEqual([0.2, 0.8]);
    expect(commands[1].object.start).toEqual({ x: 34, y: 34 });
    expect(commands[1].object.fill).toEqual({ color: '#2563eb' });
    expect(commands[2].object.position).toEqual({ x: 29, y: 29 });
    expect(commands[3].object.position).toEqual({ x: 24, y: 24 });
    // The originals are untouched.
    expect(items[1].value.start).toEqual({ x: 10, y: 10 });
    expect(text.position).toEqual({ x: 5, y: 5 });
  });

  it('keeps number lines and axes on the grid', () => {
    const items = [
      {
        kind: 'shape',
        value: shape({
          kind: 'numberLine',
          start: { x: 0, y: 64 },
          end: { x: 192, y: 64 },
          step: 64,
        }),
      },
    ];
    expect(copyOffset(items)).toBe(64);
    expect(copyOffset([{ kind: 'shape', value: shape() }])).toBe(24);
    expect(copyOffset([{ kind: 'shape', value: shape({ kind: 'axes', step: 16 }) }])).toBe(32);
    expect(snapDelta(items, { x: 100, y: -20 })).toEqual({ x: 128, y: 0 });
    const { commands } = placeCopies(items, { x: 64, y: 64 }, ids);
    expect(commands[0].object.start).toEqual({ x: 64, y: 128 });
    expect(commands[0].object.step).toBe(64);
  });

  it('cascades pastes in view and centres them otherwise', () => {
    const items = [{ kind: 'shape', value: shape() }];
    const bounds = { x: 0, y: 0, width: 40, height: 40 };
    const view = { x: -100, y: -100, width: 400, height: 300 };
    expect(pasteDelta(items, bounds, view, 1)).toEqual({ x: 24, y: 24 });
    expect(pasteDelta(items, bounds, view, 3)).toEqual({ x: 72, y: 72 });
    // Cut then paste: the first paste lands in place.
    expect(pasteDelta(items, bounds, view, 0)).toEqual({ x: 0, y: 0 });
    const away = { x: 1000, y: 1000, width: 400, height: 300 };
    expect(pasteDelta(items, bounds, away, 1)).toEqual({ x: 1180, y: 1130 });
    expect(centerDelta(items, bounds, view)).toEqual({ x: 80, y: 30 });
  });

  it('copies deeply and points media at copies stored on another board', () => {
    const video = {
      ...image,
      kind: 'video',
      id: 'vid-1',
      source: { kind: 'local', assetId: 'asset-2' },
    };
    delete video.assetId;
    const youtube = { ...video, id: 'vid-2', source: { kind: 'youtube', videoId: 'abc' } };
    const items = [
      { kind: 'content', value: image },
      { kind: 'content', value: video },
      { kind: 'content', value: youtube },
    ];
    expect(itemAssetIds(items)).toEqual(['asset-1', 'asset-2']);
    const moved = withAssetIds(
      items,
      new Map([
        ['asset-1', 'copy-1'],
        ['asset-2', 'copy-2'],
      ])
    );
    expect(itemAssetIds(moved)).toEqual(['copy-1', 'copy-2']);
    expect(image.assetId).toBe('asset-1');
    const copies = cloneItems(items);
    expect(copies).toEqual(items);
    expect(copies[0].value).not.toBe(image);
  });
});
