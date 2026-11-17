import { describe, expect, it } from 'vitest';
import { cloneCommand, normalizeCommand, normalizeContentObject } from '../../src/board/model.ts';
import {
  contentBounds,
  layoutTable,
  resolveContent,
  resizeMedia,
  wrapParagraphs,
} from '../../src/board/content.ts';
import { createBoardScene, createDrawingCanvas } from '../../src/board/scene-renderer.ts';
import { parseVideoUrl, videoEmbedUrl } from '../../src/board/video.ts';
import {
  fromTableDocument,
  toTableDocument,
  isSafeTableDocument,
} from '../../src/board/table-editor.ts';
import { imageObject, tableObject } from '../helpers/content-fixture.js';

describe('board content', () => {
  it('validates and deeply clones all new object variants', () => {
    for (const object of [
      imageObject(),
      tableObject(),
      { ...imageObject(), kind: 'video', source: { kind: 'local', assetId: 'video-1' } },
      { ...imageObject(), kind: 'video', source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' } },
    ]) {
      const normalized = normalizeContentObject(object);
      expect(normalized).not.toBeNull();
      const command = { type: 'content-set', object: normalized };
      expect(normalizeCommand(command)).toEqual(command);
      const cloned = cloneCommand(command);
      cloned.object.position.x++;
      expect(cloned.object.position.x).not.toBe(command.object.position.x);
    }
    const invalids = [
      { ...imageObject(), width: Infinity },
      { ...imageObject(), assetId: '' },
      { ...imageObject(), position: { x: NaN, y: 0 } },
      { ...tableObject(), columnWidths: [10, 120] },
      { ...tableObject(), rows: [] },
      { ...tableObject(), rows: [{ minHeight: 48, cells: [] }] },
    ];
    for (const value of invalids) expect(normalizeContentObject(value)).toBeNull();
  });
  it('keeps creation order on edits and resolves deletion, clearing, undo, and redo', () => {
    const a = imageObject(),
      b = tableObject();
    const commands = [
      { type: 'content-set', object: a },
      { type: 'content-set', object: b },
      { type: 'content-set', object: { ...a, width: 400 } },
      { type: 'content-delete', ids: [b.id] },
    ];
    expect(resolveContent(commands).map((o) => o.id)).toEqual([a.id]);
    expect(resolveContent(commands.slice(0, -1)).map((o) => o.id)).toEqual([a.id, b.id]);
    expect(resolveContent([...commands, { type: 'clear' }])).toEqual([]);
    expect(
      resolveContent([
        ...commands,
        { type: 'stroke', tool: 'eraser', size: 100, points: [{ x: 20, y: 30 }] },
      ])
    ).toHaveLength(1);
  });
  it('resizes opposite corners with stable proportions and finite positive dimensions', () => {
    const image = imageObject();
    const resized = resizeMedia(image, 0, { x: -180, y: -120 });
    expect(resized.width / resized.height).toBe(2);
    expect(resized.position.x + resized.width).toBe(image.position.x + image.width);
    expect(resized.position.y + resized.height).toBe(image.position.y + image.height);
    expect(resizeMedia(image, 0, { x: 900, y: 900 }).width).toBeGreaterThan(0);
  });
  it('round-trips table text marks, alignment, borders, widths and row sizes', () => {
    const table = tableObject();
    expect(fromTableDocument(toTableDocument(table), table, '#111827')).toEqual(table);
    const doc = toTableDocument(table);
    doc.children[0].attrs.borderColor = 'none';
    expect(fromTableDocument(doc, table, '#111827').borderRaw).toBe('none');
    const clone = cloneCommand({ type: 'content-set', object: table });
    clone.object.rows[0].cells[0][0].runs[0].text = 'Changed';
    expect(table.rows[0].cells[0][0].runs[0].text).toBe('Hello world');
  });
  it('rejects unsupported table structures instead of dropping content', () => {
    const table = tableObject();
    const merged = toTableDocument(table);
    merged.children[0].children[0].children[0].attrs = { colspan: 2 };
    expect(isSafeTableDocument(merged)).toBe(false);
    expect(() => fromTableDocument(merged, table, '#111827')).toThrow('invalidTable');
    const outside = toTableDocument(table);
    outside.children[1].children[0].text = 'Unowned text';
    expect(isSafeTableDocument(outside)).toBe(false);
    expect(fromTableDocument({ children: [] }, table, '#111827')).toBeNull();
  });
  it('wraps long words and Unicode text, retains marks, and grows rows to fit', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.measureText.mockImplementation((text) => ({ width: Array.from(text).length * 10 }));
    const table = tableObject();
    table.columnWidths = [60, 120];
    table.rows[0].cells[0][0].runs[0].text = 'Longword 👨‍👩‍👧‍👦 family';
    const paragraph = table.rows[0].cells[0][0];
    const wrapped = wrapParagraphs(ctx, [paragraph], 44);
    expect(
      wrapped
        .flatMap((p) => p.runs)
        .map((r) => r.text)
        .join('')
    ).toBe(paragraph.runs[0].text);
    expect(
      wrapped.flatMap((p) => p.runs).every((r) => r.bold && r.highlightRaw === '#fff176')
    ).toBe(true);
    expect(wrapped.flatMap((p) => p.runs).some((r) => r.text.includes('👨‍👩‍👧‍👦'))).toBe(true);
    const layout = layoutTable(ctx, table);
    expect(layout.cells[0].bounds.height).toBeGreaterThan(48);
    expect(layout.bounds.width).toBe(180);
  });
  it('keeps differently formatted parts of a word on the same wrapped line', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.measureText.mockImplementation((text) => ({ width: text.length * 10 }));
    const base = { fontSize: 24, inkRaw: '#111827', bold: false, italic: false };
    const lines = wrapParagraphs(
      ctx,
      [
        {
          align: 'left',
          runs: [
            { ...base, text: 'xx bo' },
            { ...base, bold: true, text: 'ld' },
          ],
        },
      ],
      65
    );
    expect(lines.map((line) => line.runs.map((run) => run.text).join(''))).toEqual(['xx ', 'bold']);
    expect(lines[1].runs[1].bold).toBe(true);
  });
  it('includes content in Fit bounds and exports image pixels, tables and video cards', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    const video = {
      ...imageObject(),
      id: 'v',
      kind: 'video',
      source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
      title: 'Example video',
    };
    const scene = createBoardScene(
      [imageObject(), tableObject(), video].map((object) => ({ type: 'content-set', object })),
      ctx
    );
    expect(scene.bounds.x).toBe(-100);
    expect(contentBounds(ctx, tableObject()).width).toBe(280);
    const image = document.createElement('canvas');
    const { canvas } = createDrawingCanvas(
      scene,
      { width: 640, height: 480 },
      '#ffffff',
      (ink) => ink,
      { image: () => image }
    );
    const out = canvas.getContext('2d');
    expect(out.drawImage).toHaveBeenCalledWith(image, 20, 30, 200, 100);
    expect(out.fillText).toHaveBeenCalledWith(
      'Hello world',
      expect.any(Number),
      expect.any(Number)
    );
    expect(out.fillText).toHaveBeenCalledWith(
      'Example video',
      expect.any(Number),
      expect.any(Number)
    );
  });
});

describe('video URLs', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', { kind: 'youtube', videoId: 'dQw4w9WgXcQ' }],
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=20',
      { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
    ],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', { kind: 'youtube', videoId: 'dQw4w9WgXcQ' }],
    [
      'https://vimeo.com/123456/abcdef1234',
      { kind: 'vimeo', videoId: '123456', hash: 'abcdef1234' },
    ],
    [
      'https://player.vimeo.com/video/123456?h=abcdef1234',
      { kind: 'vimeo', videoId: '123456', hash: 'abcdef1234' },
    ],
  ])('normalizes %s', (url, expected) => expect(parseVideoUrl(url)).toEqual(expected));
  it.each([
    'javascript:alert(1)',
    'http://youtu.be/dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://evil.test/file.mp4',
    'https://user@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/invalid',
    '<iframe src="https://youtube.com">',
  ])('rejects %s', (url) => expect(parseVideoUrl(url)).toBeNull());
  it('creates only controlled provider embeds without autoplay', () => {
    expect(videoEmbedUrl({ kind: 'youtube', videoId: 'dQw4w9WgXcQ' })).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&rel=0'
    );
    expect(videoEmbedUrl({ kind: 'local', assetId: 'x' })).toBeNull();
  });
});
