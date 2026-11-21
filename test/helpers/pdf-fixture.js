/**
 * A small PDF made of vector shapes only, so it renders the same everywhere without fonts.
 * Each page is A4 with a red box in its upper half.
 */
export function vectorPdf(pageCount) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const kids = [];
  objects.push(null); // Pages, filled in below.
  for (let i = 0; i < pageCount; i++) {
    const pageId = objects.length + 1;
    kids.push(`${pageId} 0 R`);
    const content = '1 0 0 rg 100 450 395 300 re f';
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${pageId + 1} 0 R >>`
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(' ')}] >>`;
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
