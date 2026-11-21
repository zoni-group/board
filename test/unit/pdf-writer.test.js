import { describe, expect, it } from 'vitest';
import { writePdf } from '../../src/board/pdf-writer.ts';

// Stand-in JPEG bytes; the writer embeds them without looking inside.
const jpeg = (fill) => new Uint8Array([0xff, 0xd8, fill, fill, 0x00, 0x0a, 0xff, 0xd9]);
const page = (fill, width = 200, height = 100) => ({
  jpeg: jpeg(fill),
  width,
  height,
  pageWidth: width * 0.375,
  pageHeight: height * 0.375,
});
async function bytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
const latin1 = (data) => Array.from(data, (b) => String.fromCharCode(b)).join('');

describe('writePdf', () => {
  it('writes a PDF with one page per image', async () => {
    const blob = writePdf([page(1), page(2, 300, 400)]);
    expect(blob.type).toBe('application/pdf');
    const text = latin1(await bytes(blob));
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 75 37.5]');
    expect(text).toContain('/MediaBox [0 0 112.5 150]');
    expect(text).toContain('/Width 300 /Height 400');
  });

  it('points every xref entry at its object, and startxref at the table', async () => {
    const data = await bytes(writePdf([page(1), page(2), page(3)]));
    const text = latin1(data);
    const start = Number(text.match(/startxref\n(\d+)/)[1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const [, count] = text.slice(start).match(/xref\n0 (\d+)\n/);
    const entries = text.slice(start).match(/^\d{10} \d{5} n $/gm);
    expect(entries).toHaveLength(Number(count) - 1);
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10)),
        header = `${index + 1} 0 obj\n`;
      expect(text.slice(offset, offset + header.length)).toBe(header);
    });
    expect(text).toContain(`/Size ${count} /Root 1 0 R`);
  });

  it('embeds the JPEG bytes unchanged, with a matching /Length', async () => {
    const image = page(0xab);
    const text = latin1(await bytes(writePdf([image])));
    const stream = latin1(image.jpeg);
    expect(text).toContain(
      `/Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n${stream}\nendstream`
    );
  });

  it('refuses an empty page list', () => {
    expect(() => writePdf([])).toThrow();
  });
});
