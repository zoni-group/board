export interface ScreenArea {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export function visibleScreen(): ScreenArea {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0,
    top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth,
    height = viewport?.height ?? window.innerHeight;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** Floating panels share the area above navigation, including when a keyboard is open. */
export function panelArea(): ScreenArea {
  const screen = visibleScreen();
  const nav = document.querySelector('.board-navigation')?.getBoundingClientRect();
  const left = screen.left + 12,
    top = screen.top + 8;
  const right = screen.right - 12;
  const bottom = Math.max(
    top + 1,
    Math.min(screen.bottom - 8, nav ? nav.top - 8 : screen.bottom - 8)
  );
  return { left, top, right, bottom, width: Math.max(1, right - left), height: bottom - top };
}

export function constrainPopup(element: HTMLElement): void {
  const area = panelArea();
  element.style.maxWidth = `${area.width}px`;
  element.style.maxHeight = `${area.height}px`;
  element.style.overflow = 'auto';
  element.style.overscrollBehavior = 'contain';
  const rect = element.getBoundingClientRect();
  element.style.left = `${Math.max(area.left, Math.min(rect.left, area.right - rect.width))}px`;
  element.style.top = `${Math.max(area.top, Math.min(rect.top, area.bottom - rect.height))}px`;
}

export function observeScreenLayout(app: HTMLElement, onChange: () => void) {
  let scheduled: number | null = null;
  function update() {
    if (scheduled !== null) window.cancelAnimationFrame(scheduled);
    scheduled = null;
    const screen = visibleScreen();
    const root = document.documentElement;
    root.classList.toggle('board-short-viewport', screen.height <= 360);
    root.classList.toggle('board-tiny-viewport', screen.height <= 200);
    root.style.setProperty('--board-visible-top', `${screen.top}px`);
    root.style.setProperty('--board-visible-left', `${screen.left}px`);
    root.style.setProperty('--board-visible-width', `${screen.width}px`);
    root.style.setProperty('--board-visible-height', `${screen.height}px`);
    const area = panelArea();
    root.style.setProperty('--board-panel-height', `${area.height}px`);
    root.style.setProperty('--board-overlay-height', `${Math.max(1, area.bottom - screen.top)}px`);
    onChange();
    document.dispatchEvent(new Event('board:layout'));
  }
  function schedule() {
    if (scheduled === null) scheduled = window.requestAnimationFrame(update);
  }
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  const observer = new ResizeObserver(schedule);
  const frame = app.querySelector('.canvas-frame');
  if (frame) observer.observe(frame);
  return {
    update,
    destroy() {
      if (scheduled !== null) window.cancelAnimationFrame(scheduled);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    },
  };
}
