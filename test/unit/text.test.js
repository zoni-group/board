import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneCommand, normalizeCommand, normalizeTextObject } from '../../src/board/model.ts';
import { resolveTextObjects } from '../../src/board/text-scene.ts';
import { layoutText, drawText, intersectsText } from '../../src/board/text-layout.ts';
import {
  loadTextDraft,
  recoverTextDraft,
  saveTextDraft,
  clearTextDraft,
  TEXT_DRAFT_KEY,
} from '../../src/board/text-draft.ts';
import { textObject } from '../helpers/text-fixture.js';

beforeEach(() => localStorage.clear());

describe('text commands and scene', () => {
  it('validates persisted rich text and rejects invalid coordinates, sizes, colors, and structure', () => {
    const object = textObject();
    expect(normalizeCommand({ type: 'text-set', object })).toEqual({ type: 'text-set', object });
    for (const change of [
      { position: { x: NaN, y: 1 } },
      { paragraphs: [] },
      { paragraphs: [{ align: 'justify', runs: [] }] },
    ])
      expect(normalizeTextObject({ ...object, ...change })).toBeNull();
    for (const change of [
      { fontSize: Infinity },
      { fontSize: -1 },
      { inkRaw: 'url(remote)' },
      { text: 'a\nb' },
      { bold: 'true' },
    ]) {
      const invalid = textObject({
        paragraphs: [{ align: 'left', runs: [{ ...object.paragraphs[0].runs[0], ...change }] }],
      });
      expect(normalizeTextObject(invalid)).toBeNull();
    }
  });
  it('clones rich text without sharing mutable runs or positions', () => {
    const object = textObject();
    const command = cloneCommand({ type: 'text-set', object });
    object.position.x = 999;
    object.paragraphs[0].runs[0].text = 'Changed';
    expect(command.object).toEqual(textObject());
  });
  it('replays edits and moves without reordering blocks, and restores grouped erasures with undo', () => {
    const first = textObject(),
      second = textObject({ id: 'text-2' });
    const moved = textObject({ position: { x: 100, y: 60 } });
    const commands = [
      { type: 'text-set', object: first },
      { type: 'text-set', object: second },
      { type: 'text-set', object: moved },
    ];
    expect(resolveTextObjects(commands)).toEqual([moved, second]);
    const erase = {
      type: 'stroke',
      tool: 'eraser',
      size: 6,
      inkRaw: '#111827',
      points: [{ x: 1, y: 1 }],
      erasedTextIds: ['text-1', 'text-2'],
    };
    expect(resolveTextObjects([...commands, erase])).toEqual([]);
    expect(resolveTextObjects(commands)).toEqual([moved, second]);
    expect(resolveTextObjects([...commands, { type: 'text-delete', ids: ['text-1'] }])).toEqual([
      second,
    ]);
    expect(resolveTextObjects([...commands, { type: 'clear' }])).toEqual([]);
    expect(cloneCommand(erase).erasedTextIds).not.toBe(erase.erasedTextIds);
  });
});

describe('text layout and eraser geometry', () => {
  function context() {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      measureText: (text) => ({
        width: text.length * 10,
        fontBoundingBoxAscent: 24,
        fontBoundingBoxDescent: 8,
      }),
      fillText: vi.fn(),
    };
  }
  it('aligns styled runs on shared baselines and lays out explicit blank lines', () => {
    const object = textObject();
    object.paragraphs.push(
      {
        align: 'center',
        runs: [{ ...object.paragraphs[0].runs[0], text: 'Hi', fontSize: 64, bold: true }],
      },
      { align: 'left', runs: [] }
    );
    const ctx = context(),
      layout = drawText(ctx, object);
    expect(layout.bounds.width).toBe(50);
    expect(layout.bounds.height).toBeCloseTo(38.4 + 76.8 + 38.4);
    expect(layout.runs[1].x).toBe(35);
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(['Hello', 'Hi']);
    expect(layoutText(ctx, object).bounds).toEqual(layout.bounds);
  });
  it('detects swept eraser intersections, including fast moves that skip a whole block', () => {
    const bounds = { x: 20, y: 30, width: 50, height: 40 };
    expect(intersectsText(bounds, { x: 0, y: 50 }, { x: 100, y: 50 }, 3)).toBe(true);
    expect(intersectsText(bounds, { x: 0, y: 27 }, { x: 100, y: 27 }, 3)).toBe(true);
    expect(intersectsText(bounds, { x: 0, y: 20 }, { x: 100, y: 20 }, 3)).toBe(false);
    expect(intersectsText(bounds, { x: 25, y: 40 }, { x: 25, y: 40 }, 3)).toBe(true);
  });
});

describe('local text recovery', () => {
  it('restores an unfinished edit and clears only the matching recovery record', () => {
    const original = textObject(),
      object = textObject({ position: { x: 22, y: 30 } });
    const draft = { token: 'draft-1', original, object };
    expect(saveTextDraft(draft)).toBe(true);
    expect(recoverTextDraft([original])).toEqual(draft);
    clearTextDraft('older-token');
    expect(loadTextDraft()).toEqual(draft);
    clearTextDraft('draft-1');
    expect(loadTextDraft()).toBeNull();
  });
  it('recovers conflicting edits as a new object and never overwrites the current object', () => {
    const original = textObject(),
      object = textObject({ position: { x: 22, y: 30 } });
    saveTextDraft({ token: 'draft-1', original, object });
    const recovered = recoverTextDraft([]);
    expect(recovered.original).toBeNull();
    expect(recovered.object.id).not.toBe(original.id);
    expect(recovered.object.paragraphs).toEqual(object.paragraphs);
  });
  it('discards an already committed recovery copy, and safely rejects corrupt drafts', () => {
    const object = textObject();
    saveTextDraft({ token: 'draft-1', original: null, object });
    expect(recoverTextDraft([object])).toBeNull();
    expect(loadTextDraft()).toBeNull();
    localStorage.setItem(TEXT_DRAFT_KEY, '{broken');
    expect(loadTextDraft()).toBeNull();
    localStorage.setItem(
      TEXT_DRAFT_KEY,
      JSON.stringify({ version: 1, token: 'a', object: {}, original: null })
    );
    expect(loadTextDraft()).toBeNull();
  });
});

it('does not resurrect a finished text draft that was intentionally undone or deleted', () => {
  const object = textObject();
  saveTextDraft({ token: 'accepted', object, original: null, committing: true });
  expect(recoverTextDraft([], [{ type: 'text-set', object }])).toBeNull();
  expect(loadTextDraft()).toBeNull();
});
