import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LS_THEME,
  applyTheme,
  isDarkTheme,
  onThemeChange,
  storedTheme,
} from '../../src/board/theme.ts';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  document.head.innerHTML = '';
});

describe('app theme', () => {
  it('reads the stored choice and ignores unknown values', () => {
    expect(storedTheme()).toBe('system');
    localStorage.setItem(LS_THEME, 'dark');
    expect(storedTheme()).toBe('dark');
    localStorage.setItem(LS_THEME, 'sepia');
    expect(storedTheme()).toBe('system');
  });
  it('sets or removes data-theme, saves the choice, and notifies listeners', () => {
    document.head.innerHTML =
      '<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#ffffff">';
    const listener = vi.fn();
    onThemeChange(listener);
    applyTheme('dark', { persist: true });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(isDarkTheme()).toBe(true);
    expect(localStorage.getItem(LS_THEME)).toBe('dark');
    expect(document.querySelector('meta[name="color-scheme"]').content).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]').content).toBe('#181818');
    applyTheme('light');
    expect(isDarkTheme()).toBe(false);
    expect(localStorage.getItem(LS_THEME)).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.querySelector('meta[name="color-scheme"]').content).toBe('light dark');
    expect(listener).toHaveBeenCalledTimes(3);
  });
  it('points theme-specific logo sources at the chosen theme', () => {
    document.body.innerHTML =
      '<picture><source id="d" media="(prefers-color-scheme: dark)"><source id="l" media="(max-width: 500px) and (prefers-color-scheme: light)"></picture>';
    applyTheme('dark');
    expect(document.getElementById('d').media).toBe('all');
    expect(document.getElementById('l').media).toBe('(max-width: 500px) and not all');
    applyTheme('system');
    expect(document.getElementById('d').media).toBe('(prefers-color-scheme: dark)');
    document.body.innerHTML = '';
  });
});
