import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  constrainPopup,
  observeScreenLayout,
  panelArea,
  visibleScreen,
} from '../../src/board/screen-layout.ts';

let layout;
afterEach(() => {
  layout?.destroy();
  layout = undefined;
  vi.unstubAllGlobals();
});

function setupScreen() {
  const viewport = Object.assign(new EventTarget(), {
    width: 390,
    height: 300,
    offsetTop: 20,
    offsetLeft: 5,
  });
  vi.stubGlobal('visualViewport', viewport);
  document.body.innerHTML =
    '<div class="app"><div class="canvas-frame"></div><div class="board-navigation"></div></div>';
  const navigation = document.querySelector('.board-navigation');
  Object.defineProperty(navigation, 'getBoundingClientRect', {
    value: () => ({
      top: 240,
      bottom: 292,
      left: 137,
      right: 385,
      width: 248,
      height: 52,
    }),
  });
  return viewport;
}

describe('visible screen layout', () => {
  it('uses the visual viewport and reserves navigation space for floating panels', () => {
    setupScreen();
    expect(visibleScreen()).toEqual({
      left: 5,
      top: 20,
      right: 395,
      bottom: 320,
      width: 390,
      height: 300,
    });
    expect(panelArea()).toEqual({
      left: 17,
      top: 28,
      right: 383,
      bottom: 232,
      width: 366,
      height: 204,
    });
  });
  it('falls back to window dimensions when the visual viewport is unavailable', () => {
    vi.stubGlobal('visualViewport', undefined);
    expect(visibleScreen()).toMatchObject({
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });
  it('coalesces keyboard/viewport changes and updates the app without page scrolling', () => {
    const viewport = setupScreen();
    viewport.height = 640;
    const pending = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
      pending.push(fn);
      return pending.length;
    });
    const changed = vi.fn();
    layout = observeScreenLayout(document.querySelector('.app'), changed);
    layout.update();
    expect(document.documentElement.classList.contains('board-short-viewport')).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    viewport.height = 160;
    viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    expect(pending).toHaveLength(1);
    pending.shift()(0);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(document.documentElement.classList.contains('board-short-viewport')).toBe(true);
    expect(document.documentElement.classList.contains('board-tiny-viewport')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--board-visible-height')).toBe('160px');
    expect(document.documentElement.style.getPropertyValue('--board-visible-top')).toBe('40px');
  });
  it('clamps editor popups above navigation and permits internal scrolling', () => {
    setupScreen();
    const popup = document.createElement('div');
    Object.defineProperty(popup, 'getBoundingClientRect', {
      value: () => ({
        left: 360,
        top: 220,
        width: 100,
        height: 100,
      }),
    });
    constrainPopup(popup);
    expect(popup.style.left).toBe('283px');
    expect(popup.style.top).toBe('132px');
    expect(popup.style.maxHeight).toBe('204px');
    expect(popup.style.overflow).toBe('auto');
  });
});
