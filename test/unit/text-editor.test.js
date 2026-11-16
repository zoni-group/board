import { describe, expect, it } from 'vitest';
import { toEditorDocument, fromEditorDocument } from '../../src/board/text-editor.ts';
import { textObject } from '../helpers/text-fixture.js';

describe('board/editor text formatting adapters', () => {
  it('round-trips highlights alongside other formatting and leaves plain text unchanged', () => {
    const plain = textObject();
    expect(fromEditorDocument(toEditorDocument(plain), plain, '#111827')).toEqual(plain);
    const object = textObject({
      paragraphs: [
        {
          align: 'center',
          runs: [
            { ...plain.paragraphs[0].runs[0], text: 'Plain ' },
            {
              text: 'Highlighted',
              fontSize: 64,
              inkRaw: '#ff0000',
              bold: true,
              italic: true,
              highlightRaw: '#fff176',
            },
          ],
        },
      ],
    });
    expect(fromEditorDocument(toEditorDocument(object), object, '#111827')).toEqual(object);
  });

  it('merges matching runs while preserving highlighted and unhighlighted boundaries', () => {
    const base = textObject().paragraphs[0].runs[0];
    const object = textObject({
      paragraphs: [
        {
          align: 'left',
          runs: [
            { ...base, text: 'A', highlightRaw: '#fff176' },
            { ...base, text: 'B', highlightRaw: '#fff176' },
            { ...base, text: 'C', highlightRaw: '#64b5f6' },
            { ...base, text: 'D' },
            { ...base, text: 'E' },
          ],
        },
      ],
    });
    const runs = fromEditorDocument(toEditorDocument(object), object, '#111827').paragraphs[0].runs;
    expect(runs).toEqual([
      { ...base, text: 'AB', highlightRaw: '#fff176' },
      { ...base, text: 'C', highlightRaw: '#64b5f6' },
      { ...base, text: 'DE' },
    ]);
  });

  it('normalizes short hex highlights and ignores invalid colors without losing text', () => {
    const object = textObject();
    for (const [color, expected] of [
      ['#ff0', '#ffff00'],
      ['url(remote)', undefined],
    ]) {
      const doc = toEditorDocument(object);
      doc.children[0].children[0].marks.push({ type: 'highlight', attrs: { color } });
      const run = fromEditorDocument(doc, object, '#111827').paragraphs[0].runs[0];
      expect(run.text).toBe('Hello');
      expect(run.highlightRaw).toBe(expected);
    }
  });
});
