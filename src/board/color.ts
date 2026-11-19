/** Hex color helpers shared by ink contrast and page backgrounds. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export function normalizeHex(hex: unknown): string | null {
  if (!hex) return null;
  let h = String(hex).trim();
  if (h[0] !== '#') h = '#' + h;
  // #rgb -> #rrggbb
  if (/^#([0-9a-fA-F]{3})$/.test(h)) {
    const m = h.slice(1);
    h =
      '#' +
      m
        .split('')
        .map((ch) => ch + ch)
        .join('');
  }
  if (!/^#([0-9a-fA-F]{6})$/.test(h)) return null;
  return h.toLowerCase();
}

export function hexToRgb(hex: string): Rgb | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) => v.toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

export function srgbToLin(c: number) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relLuminance(rgb: Rgb) {
  const R = srgbToLin(rgb.r),
    G = srgbToLin(rgb.g),
    B = srgbToLin(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(hexA: string, hexB: string) {
  const a = hexToRgb(hexA),
    b = hexToRgb(hexB);
  if (!a || !b) return 1;
  const L1 = relLuminance(a);
  const L2 = relLuminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

export function mixHex(hexA: string, hexB: string, t: number) {
  const a = hexToRgb(hexA),
    b = hexToRgb(hexB);
  if (!a || !b) return hexA;
  const tt = clamp01(t);
  const r = Math.round(a.r + (b.r - a.r) * tt);
  const g = Math.round(a.g + (b.g - a.g) * tt);
  const bb = Math.round(a.b + (b.b - a.b) * tt);
  return rgbToHex({ r, g, b: bb });
}
