import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoardLock, HOLD_MS, LS_LOCKED } from '../../src/board/board-lock.ts';

function setup() {
  document.body.innerHTML = '<button id="pill" hidden></button>';
  const pill = document.getElementById('pill');
  const calls = { changed: vi.fn(), hint: vi.fn() };
  const lock = createBoardLock({ root: document.documentElement, pill, ...calls });
  return { pill, calls, lock };
}
const press = (pill) =>
  pill.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true }));
const release = (pill) =>
  pill.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

describe('Lock board', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove('board-locked');
  });

  it('shows the pill and marks the page while locked, and remembers it on this device', () => {
    const { pill, calls, lock } = setup();
    expect(lock.isLocked()).toBe(false);
    expect(pill.hidden).toBe(true);
    lock.lock();
    expect(calls.changed).toHaveBeenCalledWith(true);
    expect(pill.hidden).toBe(false);
    expect(document.documentElement.classList.contains('board-locked')).toBe(true);
    expect(localStorage.getItem(LS_LOCKED)).toBe('true');
    // A reload starts locked.
    const again = setup();
    expect(again.lock.isLocked()).toBe(true);
    expect(again.pill.hidden).toBe(false);
  });

  it('unlocks only after a full hold', () => {
    const { pill, calls, lock } = setup();
    lock.lock();
    press(pill);
    vi.advanceTimersByTime(HOLD_MS / 2);
    release(pill);
    vi.advanceTimersByTime(HOLD_MS);
    expect(lock.isLocked()).toBe(true);
    expect(calls.hint).not.toHaveBeenCalled();

    press(pill);
    vi.advanceTimersByTime(HOLD_MS);
    expect(lock.isLocked()).toBe(false);
    expect(calls.changed).toHaveBeenLastCalledWith(false);
    expect(pill.hidden).toBe(true);
    expect(document.documentElement.classList.contains('board-locked')).toBe(false);
    expect(localStorage.getItem(LS_LOCKED)).toBe('false');
  });

  it('a quick tap or a click only shows the hint', () => {
    const { pill, calls, lock } = setup();
    lock.lock();
    press(pill);
    vi.advanceTimersByTime(100);
    release(pill);
    expect(calls.hint).toHaveBeenCalledTimes(1);
    pill.click();
    expect(lock.isLocked()).toBe(true);
  });

  it('holding Enter unlocks; key repeats do not restart the hold', () => {
    const { pill, lock } = setup();
    lock.lock();
    const key = (type, repeat = false) =>
      pill.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', repeat, cancelable: true }));
    key('keydown');
    vi.advanceTimersByTime(HOLD_MS / 2);
    key('keydown', true);
    vi.advanceTimersByTime(HOLD_MS / 2);
    expect(lock.isLocked()).toBe(false);
  });
});
