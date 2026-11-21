import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BoardAsset } from './assets.ts';

/** PDFs larger than this are refused before they are read. */
export const PDF_MAX_BYTES = 50 * 1024 * 1024;
/** The longest side of a rendered page, in pixels. */
const PAGE_PIXELS = 2048;

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfReadOptions {
  signal?: AbortSignal;
  progress?(done: number, total: number): void;
  /** Only the first pages that fit are rendered. */
  maxPages: number;
}

function abortError() {
  return new DOMException('The PDF import was cancelled.', 'AbortError');
}

function jpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('pdfUnreadable'))),
      'image/jpeg',
      0.85
    )
  );
}

/**
 * Renders the pages of a PDF to JPEG images, one at a time, on white paper. Errors carry an
 * i18n key: pdfTooLarge, pdfUnreadable or pdfLocked.
 */
export async function readPdfPages(
  file: Blob,
  { signal, progress, maxPages }: PdfReadOptions
): Promise<{ pages: BoardAsset[]; total: number }> {
  if (file.size > PDF_MAX_BYTES) throw new Error('pdfTooLarge');
  const data = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(data.subarray(0, 1024)).indexOf('%PDF-') < 0)
    throw new Error('pdfUnreadable');
  if (signal?.aborted) throw abortError();

  const task = getDocument({ data, useSystemFonts: true });
  const stop = () => void task.destroy();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const pdf = await task.promise.catch((error: unknown) => {
      if (signal?.aborted) throw abortError();
      throw new Error(
        error instanceof Error && error.name === 'PasswordException' ? 'pdfLocked' : 'pdfUnreadable'
      );
    });
    const total = pdf.numPages,
      count = Math.min(total, Math.max(0, maxPages));
    const pages: BoardAsset[] = [];
    for (let number = 1; number <= count; number++) {
      if (signal?.aborted) throw abortError();
      progress?.(number - 1, count);
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: PAGE_PIXELS / Math.max(base.width, base.height),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('pdfUnreadable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch {
        throw signal?.aborted ? abortError() : new Error('pdfUnreadable');
      }
      pages.push({
        kind: 'image',
        blob: await jpeg(canvas),
        width: canvas.width,
        height: canvas.height,
      });
      page.cleanup();
      // Let the browser free the pixels before the next page.
      canvas.width = canvas.height = 0;
    }
    progress?.(count, count);
    return { pages, total };
  } finally {
    signal?.removeEventListener('abort', stop);
    await task.destroy().catch(() => {});
  }
}
