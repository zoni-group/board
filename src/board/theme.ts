import { loadText, saveText } from '../shared/storage.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
export const LS_THEME = 'zoni_board_theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function storedTheme(): ThemeChoice {
  const value = loadText(LS_THEME, null);
  return (THEME_CHOICES as readonly string[]).includes(value ?? '')
    ? (value as ThemeChoice)
    : 'system';
}

/** The app theme in effect: an explicit choice, or the system preference. */
export function isDarkTheme(): boolean {
  const choice = document.documentElement.dataset.theme;
  if (choice === 'dark') return true;
  if (choice === 'light') return false;
  return systemPrefersDark();
}

function syncMeta() {
  const dark = isDarkTheme();
  const choice = document.documentElement.dataset.theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
    ?.setAttribute('content', choice ? choice : 'light dark');
  // The browser chrome follows the app theme, not only the OS one.
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute('content', dark ? '#181818' : '#ffffff'));
  // Theme-specific <picture> sources (the logo) follow the chosen theme instead of the OS.
  document.querySelectorAll<HTMLSourceElement>('picture source[media]').forEach((source) => {
    const original = (source.dataset.themeMedia ??= source.media);
    if (!/prefers-color-scheme/.test(original)) return;
    source.media = choice
      ? original.replace(/\(prefers-color-scheme:\s*(dark|light)\)/, (_, scheme: string) =>
          scheme === choice ? 'all' : 'not all'
        )
      : original;
  });
}

/** Applies a theme choice to the page; `system` follows the OS setting. */
export function applyTheme(choice: ThemeChoice, { persist = false } = {}): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  if (persist) saveText(LS_THEME, choice);
  syncMeta();
  document.dispatchEvent(new CustomEvent('theme:change', { detail: { choice } }));
}

/** Runs `listener` whenever the effective theme may have changed (choice or OS setting). */
export function onThemeChange(listener: () => void): void {
  document.addEventListener('theme:change', listener);
  if (typeof window.matchMedia !== 'function') return;
  window.matchMedia(DARK_QUERY).addEventListener?.('change', () => {
    if (!document.documentElement.dataset.theme) {
      syncMeta();
      listener();
    }
  });
}
