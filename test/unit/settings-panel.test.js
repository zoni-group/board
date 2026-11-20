import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshLibrary } from '../helpers/library-db.js';
import { closeLibraryDatabase } from '../../src/board/storage.ts';
import { renderSettings } from '../../src/board/settings-panel.ts';
import { setLang } from '../../src/i18n.ts';

const $ = (selector) => document.querySelector(selector);

function render(freeUpSpace) {
  document.body.innerHTML = '<div id="body"></div>';
  renderSettings($('#body'), {
    name: () => 'Board 1',
    rename: async () => {},
    background: () => ({ pattern: 'blank', spacing: 'medium', color: 'auto' }),
    setBackground: () => {},
    theme: () => 'system',
    setTheme: () => {},
    freeUpSpace,
  });
}

describe('Settings → Storage → Free up space', () => {
  beforeEach(async () => {
    setLang('en');
    await freshLibrary();
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => ({ usage: 5e6, quota: 1e9 }),
        persisted: async () => true,
      },
    });
  });
  afterEach(async () => {
    await closeLibraryDatabase();
    vi.unstubAllGlobals();
  });

  it('asks first, and Cancel brings the button back', async () => {
    const free = vi.fn();
    render(free);
    await vi.waitFor(() => expect($('#freeUpSpace')).not.toBeNull());
    expect($('.settings-free').textContent).toContain('images nothing uses anymore');
    $('#freeUpSpace').click();
    expect($('.settings-free').textContent).toContain('on all boards?');
    expect(document.activeElement.textContent).toBe('Cancel');
    document.activeElement.click();
    expect($('#freeUpSpace')).not.toBeNull();
    expect(free).not.toHaveBeenCalled();
  });

  it('reports the space freed and refreshes the storage figures', async () => {
    const free = vi.fn(async () => 12.4e6);
    render(free);
    await vi.waitFor(() => expect($('#freeUpSpace')).not.toBeNull());
    $('#freeUpSpace').click();
    $('#confirmFreeUpSpace').click();
    expect(free).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect($('.settings-free-result')?.textContent).toBe('Freed 12 MB'));
    expect($('.settings-usage').textContent).toContain('on this device');
    expect($('#freeUpSpace')).not.toBeNull();
  });

  it('says when there is nothing to free up, or when it failed', async () => {
    render(async () => 0);
    await vi.waitFor(() => expect($('#freeUpSpace')).not.toBeNull());
    $('#freeUpSpace').click();
    $('#confirmFreeUpSpace').click();
    await vi.waitFor(() =>
      expect($('.settings-free-result')?.textContent).toBe('Nothing to free up')
    );
    render(async () => {
      throw new Error('busy');
    });
    await vi.waitFor(() => expect($('#freeUpSpace')).not.toBeNull());
    $('#freeUpSpace').click();
    $('#confirmFreeUpSpace').click();
    await vi.waitFor(() =>
      expect($('.settings-free-result')?.textContent).toBe("Couldn't free up space")
    );
  });
});
