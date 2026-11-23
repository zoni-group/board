import { loadBoolean, saveBoolean } from '../shared/storage.ts';

export const LS_LOCKED = 'zoni_board_locked';
/** How long the Locked pill must be held to unlock. */
export const HOLD_MS = 1000;
/** A release sooner than this is a tap, which only shows the hint. */
const TAP_MS = 300;

export interface BoardLockOptions {
  root: HTMLElement;
  pill: HTMLButtonElement;
  /** Called after the lock turns on or off. */
  changed(locked: boolean): void;
  /** A quick tap on the pill: tell the teacher to hold instead. */
  hint(): void;
}

/**
 * Lock board: the editing toolbar is replaced by a Locked pill, and holding the pill for a
 * second unlocks it, so a student at a shared screen can't unlock by accident. The lock is
 * kept on this device, so a reload doesn't unlock.
 */
export function createBoardLock({ root, pill, changed, hint }: BoardLockOptions) {
  let locked = loadBoolean(LS_LOCKED);
  let timer: number | undefined,
    frame: number | null = null,
    holding = false,
    started = 0;

  function apply() {
    root.classList.toggle('board-locked', locked);
    pill.hidden = !locked;
  }
  function set(next: boolean) {
    if (locked === next) return;
    locked = next;
    saveBoolean(LS_LOCKED, locked);
    apply();
    changed(locked);
  }
  function paint() {
    const progress = holding ? Math.min(1, (performance.now() - started) / HOLD_MS) : 0;
    pill.style.setProperty('--hold', String(progress));
    frame = holding ? requestAnimationFrame(paint) : null;
  }
  function begin() {
    if (!locked || holding) return;
    holding = true;
    started = performance.now();
    timer = window.setTimeout(() => {
      stop();
      set(false);
    }, HOLD_MS);
    if (frame === null && typeof requestAnimationFrame === 'function')
      frame = requestAnimationFrame(paint);
  }
  function stop() {
    window.clearTimeout(timer);
    holding = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pill.style.setProperty('--hold', '0');
  }
  function release() {
    if (!holding) return;
    const tap = performance.now() - started < TAP_MS;
    stop();
    if (tap) hint();
  }

  pill.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pill.setPointerCapture?.(event.pointerId);
    begin();
  });
  pill.addEventListener('pointerup', release);
  pill.addEventListener('pointercancel', stop);
  pill.addEventListener('lostpointercapture', stop);
  pill.addEventListener('contextmenu', (event) => event.preventDefault());
  pill.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) begin();
  });
  pill.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') release();
  });
  // Clicks (including a keyboard click) never unlock on their own.
  pill.addEventListener('click', (event) => event.preventDefault());
  apply();

  return {
    isLocked: () => locked,
    lock: () => set(true),
    unlock: () => set(false),
  };
}
