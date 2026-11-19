import type {
  BoardCommand,
  ContentObject,
  Point,
  TableObject,
  TextObject,
  TextParagraph,
  TextRun,
} from './model.ts';
import { expandCommands } from './model.ts';
import { assetIdFor } from './assets.ts';
import { drawText, layoutText, textFont } from './text-layout.ts';
import type { TextLayout } from './text-layout.ts';
import type { BoardBounds } from './viewport.ts';
import { t } from '../i18n.ts';

export function resolveContent(commands: readonly BoardCommand[]): ContentObject[] {
  const objects = new Map<string, ContentObject>();
  for (const command of expandCommands(commands)) {
    if (command.type === 'clear') objects.clear();
    if (command.type === 'content-set') objects.set(command.object.id, command.object);
    if (command.type === 'content-delete') for (const id of command.ids) objects.delete(id);
  }
  return [...objects.values()];
}

export const TABLE_PADDING = 8;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Wrap styled runs without losing their marks, whitespace, or Unicode graphemes. */
export function wrapParagraphs(
  ctx: CanvasRenderingContext2D,
  paragraphs: TextParagraph[],
  width: number
): TextParagraph[] {
  const result: TextParagraph[] = [];
  ctx.save();
  for (const paragraph of paragraphs) {
    let line: TextRun[] = [],
      used = 0;
    const flush = () => {
      result.push({
        align: paragraph.align,
        runs: line.length
          ? line
          : [{ text: '', fontSize: 24, inkRaw: '#111827', bold: false, italic: false }],
      });
      line = [];
      used = 0;
    };
    const append = (run: TextRun, text: string, measured: number) => {
      const previous = line.at(-1);
      if (
        previous &&
        Object.keys(run).every(
          (key) => key === 'text' || run[key as keyof TextRun] === previous[key as keyof TextRun]
        )
      )
        previous.text += text;
      else line.push({ ...run, text });
      used += measured;
    };
    // A formatting boundary inside a word is not a line-break opportunity.
    const words: { space: boolean; parts: TextRun[] }[] = [];
    for (const run of paragraph.runs)
      for (const token of run.text.replace(/\t/g, '    ').split(/(\s+)/u).filter(Boolean)) {
        const space = /^\s+$/u.test(token),
          last = words.at(-1);
        if (last?.space === space) last.parts.push({ ...run, text: token });
        else words.push({ space, parts: [{ ...run, text: token }] });
      }
    for (const word of words) {
      const sizes = word.parts.map((run) => {
        ctx.font = textFont(run);
        return ctx.measureText(run.text).width;
      });
      const measured = sizes.reduce((sum, size) => sum + size, 0);
      if (used && used + measured > width && !word.space) flush();
      if (measured <= width || word.space)
        word.parts.forEach((run, index) => append(run, run.text, sizes[index]));
      else
        for (const run of word.parts) {
          ctx.font = textFont(run);
          for (const { segment } of graphemes.segment(run.text)) {
            const size = ctx.measureText(segment).width;
            if (used && used + size > width) flush();
            append(run, segment, size);
          }
        }
    }
    flush();
  }
  ctx.restore();
  return result;
}
interface TableLayout {
  bounds: BoardBounds;
  cells: { bounds: BoardBounds; text: TextObject; layout: TextLayout }[];
}
const tableCache = new WeakMap<TableObject, TableLayout>();
export function layoutTable(ctx: CanvasRenderingContext2D, object: TableObject): TableLayout {
  const cached = tableCache.get(object);
  if (cached) return cached;
  const cells: TableLayout['cells'] = [];
  let y = object.position.y;
  for (const row of object.rows) {
    let x = object.position.x,
      height = row.minHeight;
    const rowCells = row.cells.map((paragraphs, column) => {
      const width = object.columnWidths[column],
        innerWidth = width - TABLE_PADDING * 2 - 1;
      const text: TextObject = {
        id: object.id,
        position: { x: x + TABLE_PADDING, y: y + TABLE_PADDING },
        paragraphs: wrapParagraphs(ctx, paragraphs, innerWidth),
      };
      const layout = layoutText(ctx, text);
      // layoutText aligns to its longest line; table cells align to their fixed inner width.
      let runIndex = 0;
      for (const paragraph of text.paragraphs) {
        const offset =
          (innerWidth - layout.bounds.width) *
          (paragraph.align === 'right' ? 1 : paragraph.align === 'center' ? 0.5 : 0);
        for (let i = 0; i < paragraph.runs.length; i++) layout.runs[runIndex++].x += offset;
      }
      height = Math.max(height, layout.bounds.height + TABLE_PADDING * 2 + 1);
      const cell = { bounds: { x, y, width, height: 0 }, text, layout };
      x += width;
      return cell;
    });
    for (const cell of rowCells) {
      cell.bounds.height = height;
      cells.push(cell);
    }
    y += height;
  }
  const layout = {
    bounds: {
      ...object.position,
      width: object.columnWidths.reduce((sum, w) => sum + w, 0),
      height: y - object.position.y,
    },
    cells,
  };
  tableCache.set(object, layout);
  return layout;
}
export function contentBounds(ctx: CanvasRenderingContext2D, object: ContentObject): BoardBounds {
  return object.kind === 'table'
    ? layoutTable(ctx, object).bounds
    : { ...object.position, width: object.width, height: object.height };
}
export function contentCorners(ctx: CanvasRenderingContext2D, object: ContentObject): Point[] {
  const b = contentBounds(ctx, object);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
}
export function resizeMedia<T extends Exclude<ContentObject, TableObject>>(
  object: T,
  corner: number,
  point: Point
): T {
  const corners = [
    { x: object.position.x, y: object.position.y },
    { x: object.position.x + object.width, y: object.position.y },
    { x: object.position.x + object.width, y: object.position.y + object.height },
    { x: object.position.x, y: object.position.y + object.height },
  ];
  const anchor = corners[(corner + 2) % 4],
    ratio = object.height / object.width;
  const dx = Math.abs(point.x - anchor.x),
    dy = Math.abs(point.y - anchor.y);
  const width = Math.min(100000, 100000 / ratio, Math.max(40, dx, dy / ratio));
  const height = width * ratio;
  return {
    ...object,
    position: {
      x: corner === 0 || corner === 3 ? anchor.x - width : anchor.x,
      y: corner < 2 ? anchor.y - height : anchor.y,
    },
    width,
    height,
  };
}

export interface ContentPaintOptions {
  image(id: string): CanvasImageSource | null;
  background: string;
  ink(raw: string): string;
}
export function drawContent(
  ctx: CanvasRenderingContext2D,
  object: ContentObject,
  options: ContentPaintOptions
) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (object.kind === 'table') {
    const layout = layoutTable(ctx, object);
    ctx.fillStyle = options.background;
    ctx.fillRect(layout.bounds.x, layout.bounds.y, layout.bounds.width, layout.bounds.height);
    ctx.strokeStyle = options.ink(object.borderRaw);
    ctx.lineWidth = 1;
    for (const cell of layout.cells) {
      const b = cell.bounds;
      if (object.borderRaw !== 'none') ctx.strokeRect(b.x, b.y, b.width, b.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.width, b.height);
      ctx.clip();
      drawText(ctx, cell.text, cell.layout);
      ctx.restore();
    }
  } else {
    const { x, y } = object.position,
      { width, height } = object;
    const id = assetIdFor(object),
      image = id ? options.image(id) : null;
    if (object.kind === 'video' || !image) {
      ctx.fillStyle = options.background;
      ctx.fillRect(x, y, width, height);
    }
    if (image) ctx.drawImage(image, x, y, width, height);
    else {
      ctx.fillStyle = options.ink('#64748b');
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = options.ink('#64748b');
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, width, height);
    }
    if (object.kind === 'video') {
      const radius = Math.min(28, width / 6, height / 5),
        cx = x + width / 2,
        cy = y + height / 2;
      ctx.fillStyle = '#111827';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.24, cy - radius * 0.45);
      ctx.lineTo(cx + radius * 0.48, cy);
      ctx.lineTo(cx - radius * 0.24, cy + radius * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    if (object.kind === 'video' || !image) {
      const labelHeight = Math.min(32, height);
      ctx.fillStyle = '#111827';
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, y + height - labelHeight, width, labelHeight);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 6, y, width - 12, height);
      ctx.clip();
      ctx.font = '14px Arial, Helvetica, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        object.kind === 'image'
          ? `${t('missingImage')} · ${object.title}`
          : object.title || t('video'),
        x + 8,
        y + height - labelHeight / 2
      );
      ctx.restore();
    }
  }
  ctx.restore();
}
