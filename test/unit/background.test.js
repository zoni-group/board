import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKGROUND,
  MIN_SCREEN_STEP,
  PAPER_COLORS,
  isDarkColor,
  normalizeBackground,
  paintBackgroundPattern,
  patternColors,
  patternStep,
  resolveCanvasColor,
} from '../../src/board/background.ts';

const size = { width: 200, height: 100 };
const view = (zoom = 1) => ({ center: { x: 100, y: 50 }, zoom });
function recorder() {
  const calls = { moveTo: [], lineTo: [], rect: [], stroke: [], fill: 0, beginPath: 0 };
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    save() {},
    restore() {},
    beginPath: () => calls.beginPath++,
    moveTo: (x, y) => calls.moveTo.push([x, y]),
    lineTo: (x, y) => calls.lineTo.push([x, y]),
    rect: (x, y, w, h) => calls.rect.push([x, y, w, h]),
    stroke() {
      calls.stroke.push(ctx.strokeStyle);
    },
    fill: () => calls.fill++,
  };
  return { ctx, calls };
}
const paint = (background, zoom = 1, color = '#ffffff') => {
  const { ctx, calls } = recorder();
  paintBackgroundPattern(ctx, { ...DEFAULT_BACKGROUND, ...background }, view(zoom), size, color);
  return calls;
};

describe('page backgrounds', () => {
  it('normalizes missing or invalid settings to the defaults, field by field', () => {
    expect(normalizeBackground(undefined)).toEqual(DEFAULT_BACKGROUND);
    expect(normalizeBackground({ pattern: 'grid', spacing: 'huge', color: 7 })).toEqual({
      pattern: 'grid',
      spacing: 'medium',
      color: 'auto',
    });
    expect(normalizeBackground({ pattern: 'dotted', spacing: 'small', color: 'green' })).toEqual({
      pattern: 'dotted',
      spacing: 'small',
      color: 'green',
    });
  });
  it('resolves paper colors: Auto follows the theme, presets are fixed', () => {
    expect(resolveCanvasColor(DEFAULT_BACKGROUND, '#141414')).toBe('#141414');
    expect(resolveCanvasColor(DEFAULT_BACKGROUND, '')).toBe('#ffffff');
    expect(resolveCanvasColor({ ...DEFAULT_BACKGROUND, color: 'black' }, '#ffffff')).toBe(
      PAPER_COLORS.black
    );
    expect(isDarkColor(PAPER_COLORS.green)).toBe(true);
    expect(isDarkColor(PAPER_COLORS.black)).toBe(true);
    expect(isDarkColor(PAPER_COLORS.cream)).toBe(false);
    expect(isDarkColor('#ffffff')).toBe(false);
  });
  it('mixes faint pattern lines toward the contrast color of the paper', () => {
    const light = patternColors('#ffffff'),
      dark = patternColors('#000000');
    expect(light.minor).toBe('#e0e0e0');
    expect(light.major < light.minor).toBe(true);
    expect(dark.minor).toBe('#1f1f1f');
  });
  it('doubles the spacing while lines would be closer than 8 screen pixels', () => {
    expect(patternStep('small', 1)).toBe(16);
    expect(patternStep('small', 0.5)).toBe(16);
    expect(patternStep('small', 0.25)).toBe(32);
    expect(patternStep('large', 4)).toBe(64);
    for (const zoom of [0.5, 0.3, 0.1])
      expect(patternStep('small', zoom) * zoom).toBeGreaterThanOrEqual(MIN_SCREEN_STEP);
  });
  it('draws nothing for blank paper', () => {
    const calls = paint({ pattern: 'blank' });
    expect(calls.beginPath).toBe(0);
  });
  it('draws lined paper as horizontal lines on the spacing, covering the visible area', () => {
    const calls = paint({ pattern: 'lined', spacing: 'medium' });
    expect(calls.moveTo.map(([, y]) => y)).toEqual([0, 32, 64, 96]);
    expect(calls.moveTo.every(([x]) => x === 0)).toBe(true);
    expect(calls.lineTo.every(([x]) => x === 200)).toBe(true);
    expect(calls.stroke).toHaveLength(1);
  });
  it('draws grids with major lines every fifth line, in their own color and path', () => {
    const calls = paint({ pattern: 'grid', spacing: 'small' });
    // Rows 0..96 and columns 0..192 every 16 units; the major lines (every 80) come last.
    expect(calls.stroke).toEqual([patternColors('#ffffff').minor, patternColors('#ffffff').major]);
    const horizontal = calls.moveTo.filter(([x]) => x === 0).map(([, y]) => y);
    expect(horizontal).toEqual(expect.arrayContaining([16, 32, 48, 64, 96, 0, 80]));
    expect(calls.moveTo.slice(-5)).toEqual([
      [0, 0],
      [0, 80],
      [0, 0],
      [80, 0],
      [160, 0],
    ]);
  });
  it('keeps lines 1 screen pixel wide and dots in one fill at any zoom', () => {
    const dots = paint({ pattern: 'dotted', spacing: 'large' }, 2);
    expect(dots.fill).toBe(1);
    // Visible area at 2× is x 50..150, y 25..75: dots at 64 and 128 on x, 64 on y.
    expect(dots.rect.map(([x, y, w]) => [x + w / 2, y + w / 2])).toEqual([
      [64, 64],
      [128, 64],
    ]);
    expect(dots.rect[0][2]).toBeCloseTo(1.25);
  });
});
