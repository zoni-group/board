import { hexToRgb, mixHex, normalizeHex, relLuminance } from './color.ts';
import { isRecord } from './model.ts';
import { visibleBounds } from './viewport.ts';
import type { BoardSize, BoardViewport } from './viewport.ts';

export type BackgroundPattern = 'blank' | 'grid' | 'lined' | 'dotted';
export type BackgroundSpacing = 'small' | 'medium' | 'large';
export type BackgroundColor = 'auto' | 'white' | 'cream' | 'green' | 'black';
/** Page background of one board. It is a board setting, not drawing, so it has no undo step. */
export interface BoardBackground {
  pattern: BackgroundPattern;
  spacing: BackgroundSpacing;
  color: BackgroundColor;
}

export const BACKGROUND_PATTERNS: readonly BackgroundPattern[] = [
  'blank',
  'grid',
  'lined',
  'dotted',
];
export const BACKGROUND_SPACINGS: readonly BackgroundSpacing[] = ['small', 'medium', 'large'];
export const BACKGROUND_COLORS: readonly BackgroundColor[] = [
  'auto',
  'white',
  'cream',
  'green',
  'black',
];
/** Fixed paper colors; `auto` follows the theme's canvas color. */
export const PAPER_COLORS: Record<Exclude<BackgroundColor, 'auto'>, string> = {
  white: '#ffffff',
  cream: '#f8f4e6',
  green: '#1f3b2d',
  black: '#1e2227',
};
/** Pattern spacing in board units, so the paper zooms with the drawing. */
export const SPACING: Record<BackgroundSpacing, number> = { small: 16, medium: 32, large: 64 };
/** Lines closer than this on screen are thinned out, so zooming out stays readable and cheap. */
export const MIN_SCREEN_STEP = 8;
export const GRID_MAJOR_EVERY = 5;

export const DEFAULT_BACKGROUND: Readonly<BoardBackground> = Object.freeze({
  pattern: 'blank',
  spacing: 'medium',
  color: 'auto',
});

function pick<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
/** Invalid or missing fields fall back to the defaults, so older boards keep loading. */
export function normalizeBackground(value: unknown): BoardBackground {
  const source = isRecord(value) ? value : {};
  return {
    pattern: pick(BACKGROUND_PATTERNS, source.pattern, DEFAULT_BACKGROUND.pattern),
    spacing: pick(BACKGROUND_SPACINGS, source.spacing, DEFAULT_BACKGROUND.spacing),
    color: pick(BACKGROUND_COLORS, source.color, DEFAULT_BACKGROUND.color),
  };
}

export function resolveCanvasColor(background: BoardBackground, themeColor: string): string {
  if (background.color !== 'auto') return PAPER_COLORS[background.color];
  return normalizeHex(themeColor) ?? '#ffffff';
}

export function isDarkColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  return rgb ? relLuminance(rgb) < 0.35 : false;
}

/** Pattern line colors: a faint mix of the paper toward its contrast color. */
export function patternColors(canvasColor: string): { minor: string; major: string } {
  const toward = isDarkColor(canvasColor) ? '#ffffff' : '#000000';
  return { minor: mixHex(canvasColor, toward, 0.12), major: mixHex(canvasColor, toward, 0.22) };
}

/** The spacing actually drawn at this zoom: doubled until lines are at least 8 px apart. */
export function patternStep(spacing: BackgroundSpacing, zoom: number): number {
  let step = SPACING[spacing];
  while (step * zoom < MIN_SCREEN_STEP) step *= 2;
  return step;
}

function lineIndices(from: number, to: number, step: number): number[] {
  const indices: number[] = [];
  for (let index = Math.ceil(from / step); index * step <= to; index++) indices.push(index);
  return indices;
}

/**
 * Paints the paper pattern in board coordinates. The context must already have the viewport
 * transform applied, so the pattern pans and zooms with the drawing.
 */
export function paintBackgroundPattern(
  ctx: CanvasRenderingContext2D,
  background: BoardBackground,
  view: BoardViewport,
  size: BoardSize,
  canvasColor: string
): void {
  if (background.pattern === 'blank') return;
  const area = visibleBounds(view, size);
  const step = patternStep(background.spacing, view.zoom);
  // Major grid lines follow the user's spacing, not the thinned-out one.
  const majorEvery = Math.max(
    1,
    Math.round((SPACING[background.spacing] * GRID_MAJOR_EVERY) / step)
  );
  const colors = patternColors(canvasColor);
  const left = area.x,
    top = area.y,
    right = area.x + area.width,
    bottom = area.y + area.height;
  const rows = lineIndices(top, bottom, step),
    columns = lineIndices(left, right, step);
  ctx.save();
  if (background.pattern === 'dotted') {
    const radius = 1.25 / view.zoom;
    ctx.fillStyle = colors.major;
    ctx.beginPath();
    for (const row of rows)
      for (const column of columns)
        ctx.rect(column * step - radius, row * step - radius, radius * 2, radius * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.lineWidth = 1 / view.zoom;
  const lines = (major: boolean) => {
    // Writing lines use the stronger color; grids keep fine minor lines.
    ctx.strokeStyle = major || background.pattern === 'lined' ? colors.major : colors.minor;
    ctx.beginPath();
    for (const row of rows) {
      if (background.pattern === 'grid' && (row % majorEvery === 0) !== major) continue;
      ctx.moveTo(left, row * step);
      ctx.lineTo(right, row * step);
    }
    if (background.pattern === 'grid')
      for (const column of columns) {
        if ((column % majorEvery === 0) !== major) continue;
        ctx.moveTo(column * step, top);
        ctx.lineTo(column * step, bottom);
      }
    ctx.stroke();
  };
  lines(false);
  if (background.pattern === 'grid') lines(true);
  ctx.restore();
}
