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
      { highlightRaw: 'url(remote)' },
      { highlightRaw: '#ff0' },
      { highlightRaw: null },
      { text: 'a\nb' },
      { bold: 'true' },
    ]) {
      const invalid = textObject({
        paragraphs: [{ align: 'left', runs: [{ ...object.paragraphs[0].runs[0], ...change }] }],
      });
      expect(normalizeTextObject(invalid)).toBeNull();
    }
  });
  it('preserves optional highlighting through validation and cloning without changing old text', () => {
    const plain = textObject();
    expect(normalizeTextObject(plain)).toEqual(plain);
    expect(normalizeTextObject(plain).paragraphs[0].runs[0]).not.toHaveProperty('highlightRaw');
    const highlighted = textObject();
    highlighted.paragraphs[0].runs[0].highlightRaw = '#fff176';
    expect(normalizeTextObject(highlighted)).toEqual(highlighted);
    const copy = cloneCommand({ type: 'text-set', object: highlighted });
    highlighted.paragraphs[0].runs[0].highlightRaw = '#64b5f6';
    expect(copy.object.paragraphs[0].runs[0].highlightRaw).toBe('#fff176');
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
      fillRect: vi.fn(),
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
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(layoutText(ctx, object).bounds).toEqual(layout.bounds);
  });
  it('paints run-sized opaque backgrounds before every glyph, including spaces and mixed sizes', () => {
    const base = textObject().paragraphs[0].runs[0];
    const object = textObject({
      paragraphs: [
        {
          align: 'left',
          runs: [
            { ...base, text: 'A ', fontSize: 16, italic: true, highlightRaw: '#fff176' },
            { ...base, text: 'B', fontSize: 64, bold: true, highlightRaw: '#64b5f6' },
            { ...base, text: 'C' },
          ],
        },
        { align: 'right', runs: [{ ...base, text: 'D', highlightRaw: '#aed581' }] },
      ],
    });
    const ctx = context();
    ctx.globalAlpha = 0.3;
    ctx.measureText = (text) => {
      const size = Number.parseFloat(ctx.font.match(/([\d.]+)px/)[1]);
      return {
        width: text.length * 10,
        fontBoundingBoxAscent: size * 0.75,
        fontBoundingBoxDescent: size * 0.25,
      };
    };
    const colors = [];
    ctx.fillRect.mockImplementation(() => colors.push(ctx.fillStyle));
    const layout = drawText(ctx, object);
    expect(ctx.globalAlpha).toBe(1);
    expect(colors).toEqual(['#fff176', '#64b5f6', '#aed581']);
    expect(ctx.fillRect.mock.calls).toEqual([
      [20, layout.runs[0].baseline - 12, 20, 16],
      [40, layout.runs[1].baseline - 48, 10, 64],
      [50, layout.runs[3].baseline - 24, 10, 32],
    ]);
    expect(layout.runs[0].baseline).toBe(layout.runs[1].baseline);
    expect(Math.max(...ctx.fillRect.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...ctx.fillText.mock.invocationCallOrder)
    );
    expect(ctx.fillStyle).toBe(base.inkRaw);
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
    object.paragraphs[0].runs[0].highlightRaw = '#fff176';
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
