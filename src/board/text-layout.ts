import type { Point, TextObject, TextRun } from './model.ts';

export const TEXT_FONT = 'Arial, Helvetica, sans-serif';
export const DEFAULT_TEXT_SIZE = 32;

export interface TextBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface TextLayout {
  bounds: TextBounds;
  runs: { run: TextRun; x: number; baseline: number }[];
}

export function textFont(run: TextRun): string {
  return `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${run.fontSize}px ${TEXT_FONT}`;
}

export function layoutText(ctx: CanvasRenderingContext2D, object: TextObject): TextLayout {
  ctx.save();
  const lines = object.paragraphs.map((paragraph) => {
    const size = Math.max(
      ...paragraph.runs.map((r) => r.fontSize),
      paragraph.runs.length ? 0 : DEFAULT_TEXT_SIZE
    );
    let ascent = 0,
      descent = 0;
    const runs = paragraph.runs.map((run) => {
      ctx.font = textFont(run);
      const metrics = ctx.measureText(run.text.replace(/\t/g, '    '));
      ascent = Math.max(ascent, metrics.fontBoundingBoxAscent || run.fontSize * 0.9);
      descent = Math.max(descent, metrics.fontBoundingBoxDescent || run.fontSize * 0.2);
      return { run, width: metrics.width };
    });
    if (!runs.length) {
      ascent = size * 0.9;
      descent = size * 0.2;
    }
    return {
      paragraph,
      runs,
      width: runs.reduce((sum, r) => sum + r.width, 0),
      height: Math.max(size * 1.2, ascent + descent),
      ascent,
      descent,
    };
  });
  const width = Math.max(24, ...lines.map((line) => line.width));
  const runs: TextLayout['runs'] = [];
  let y = object.position.y;
  for (const line of lines) {
    let x =
      object.position.x +
      (line.paragraph.align === 'center'
        ? (width - line.width) / 2
        : line.paragraph.align === 'right'
          ? width - line.width
          : 0);
    const baseline = y + (line.height - line.ascent - line.descent) / 2 + line.ascent;
    for (const item of line.runs) {
      runs.push({ run: item.run, x, baseline });
      x += item.width;
    }
    y += line.height;
  }
  ctx.restore();
  return {
    bounds: { x: object.position.x, y: object.position.y, width, height: y - object.position.y },
    runs,
  };
}

export function drawText(ctx: CanvasRenderingContext2D, object: TextObject): TextLayout {
  const layout = layoutText(ctx, object);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const { run, x, baseline } of layout.runs) {
    ctx.font = textFont(run);
    ctx.fillStyle = run.inkRaw;
    ctx.fillText(run.text.replace(/\t/g, '    '), x, baseline);
  }
  ctx.restore();
  return layout;
}

export function containsPoint(bounds: TextBounds, point: Point): boolean {
  return (
    point.x >= bounds.x - 4 &&
    point.x <= bounds.x + bounds.width + 4 &&
    point.y >= bounds.y - 4 &&
    point.y <= bounds.y + bounds.height + 4
  );
}

/** Liang–Barsky clipping against an expanded box catches fast eraser movements. */
export function intersectsText(
  bounds: TextBounds,
  from: Point,
  to: Point,
  radius: number
): boolean {
  const left = bounds.x - radius,
    right = bounds.x + bounds.width + radius;
  const top = bounds.y - radius,
    bottom = bounds.y + bounds.height + radius;
  const dx = to.x - from.x,
    dy = to.y - from.y;
  let enter = 0,
    leave = 1;
  for (const [p, q] of [
    [-dx, from.x - left],
    [dx, right - from.x],
    [-dy, from.y - top],
    [dy, bottom - from.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}
