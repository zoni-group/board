/** Preset colours shared by the ink swatches and the shape fill palette (one per theme). */
export const COLOR_PRESETS = [
  { id: 'graphite', light: '#111827', dark: '#e5e7eb' },
  { id: 'slate', light: '#334155', dark: '#cbd5e1' },
  { id: 'blue', light: '#2563eb', dark: '#60a5fa' },
  { id: 'green', light: '#10b981', dark: '#34d399' },
  { id: 'amber', light: '#f59e0b', dark: '#fbbf24' },
  { id: 'rose', light: '#e11d48', dark: '#fb7185' },
] as const;

/** The preset's translation key for a colour from either theme, if it is one. */
export function presetName(hex: string): string | null {
  const value = hex.toLowerCase();
  return COLOR_PRESETS.find((p) => p.light === value || p.dark === value)?.id ?? null;
}
