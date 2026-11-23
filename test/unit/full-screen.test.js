import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFullScreenButton } from '../../src/board/full-screen.ts';
import { setLang } from '../../src/i18n.ts';

function setup() {
  document.body.innerHTML = '<button id="fs"><span class="btn-icon"></span></button>';
  return document.getElementById('fs');
}
function stub(name, value) {
  Object.defineProperty(document, name, { configurable: true, value });
}

describe('Full screen button', () => {
  beforeEach(() => setLang('en'));
  afterEach(() => {
    for (const name of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen'])
      delete document[name];
    delete document.documentElement.requestFullscreen;
  });

  it('hides itself where the browser cannot go full screen', () => {
    stub('fullscreenEnabled', false);
    const button = setup();
    createFullScreenButton(button);
    expect(button.hidden).toBe(true);
  });

  it('enters and leaves full screen, and its label follows', async () => {
    stub('fullscreenEnabled', true);
    stub('fullscreenElement', null);
    const request = vi.fn(async () => {
      stub('fullscreenElement', document.documentElement);
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    const exit = vi.fn(async () => {
      stub('fullscreenElement', null);
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    document.documentElement.requestFullscreen = request;
    stub('exitFullscreen', exit);
    const button = setup();
    createFullScreenButton(button);
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Full screen');
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-label')).toBe('Exit full screen');
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(button.title).toBe('Full screen');
  });
});
