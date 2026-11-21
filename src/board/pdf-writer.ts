export interface PdfPageImage {
  /** Baseline JPEG bytes (RGB), embedded as they are. */
  jpeg: Uint8Array;
  /** Image size in pixels. */
  width: number;
  height: number;
  /** Printed page size in points (1/72 in). */
  pageWidth: number;
  pageHeight: number;
}

const encoder = new TextEncoder();
const num = (value: number) => String(Math.round(value * 100) / 100);

/**
 * Writes a PDF with one full-page JPEG per page. It is deliberately tiny: no fonts, no
 * compression of its own, just objects, an xref table with exact byte offsets and a trailer.
 */
export function writePdf(pages: readonly PdfPageImage[]): Blob {
  if (!pages.length) throw new Error('A PDF needs at least one page.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (part: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array<ArrayBuffer>) => {
    offsets[id] = length;
    add(`${id} 0 obj\n${body}\n`);
    if (stream) {
      add('stream\n');
      add(stream);
      add('\nendstream\n');
    }
    add('endobj\n');
  };

  // Objects: 1 Catalog, 2 Pages, then 3 per page (Page, content stream, image).
  const pageId = (i: number) => 3 + i * 3;
  // The binary comment tells transfer tools the file isn't plain text.
  add('%PDF-1.4\n');
  add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`
  );
  pages.forEach((page, i) => {
    const id = pageId(i);
    const w = num(page.pageWidth),
      h = num(page.pageHeight);
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${id + 1} 0 R /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> >>`
    );
    const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    object(id + 1, `<< /Length ${content.length} >>`, content);
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      new Uint8Array(page.jpeg)
    );
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) add(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
