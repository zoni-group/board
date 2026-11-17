import type { BoardTool, Point } from './model.ts';
import { clampZoom, panBy, screenToWorld, zoomAt } from './viewport.ts';
import type { BoardSize, BoardViewport } from './viewport.ts';

interface NavigationOptions {
  canvas: HTMLCanvasElement;
  ready(): boolean;
  tool(): BoardTool;
  view(): BoardViewport;
  size(): BoardSize;
  change(view: BoardViewport): void;
  locked(): boolean;
  beforeNavigate(): boolean;
  start(event: PointerEvent): void;
  move(event: PointerEvent): void;
  end(event: PointerEvent): void;
  cancelStroke(): void;
  textTap(event: PointerEvent): void;
  fit(): void;
}
type Gesture =
  | { kind: 'idle' | 'suppressed' }
  | { kind: 'drawing'; id: number; type: string }
  | { kind: 'text-tap'; id: number; start: Point; moved: boolean }
  | { kind: 'pan'; id: number; last: Point }
  | { kind: 'pinch'; ids: [number, number]; distance: number; anchor: Point; zoom: number };

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createBoardNavigation(options: NavigationOptions) {
  const { canvas } = options;
  const pointers = new Map<number, { point: Point; type: string }>();
  let gesture: Gesture = { kind: 'idle' };
  let space = false;
  let webkit: { view: BoardViewport; anchor: Point } | null = null;

  function point(event: { clientX: number; clientY: number }): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function syncCursor() {
    canvas.classList.toggle('hand-tool-active', space || options.tool() === 'hand');
    canvas.classList.toggle(
      'board-is-panning',
      gesture.kind === 'pan' || gesture.kind === 'pinch' || Boolean(webkit)
    );
  }
  function capture(id: number) {
    try {
      canvas.setPointerCapture(id);
    } catch {
      /* Synthetic or cancelled pointer. */
    }
  }
  function release(id: number) {
    try {
      canvas.releasePointerCapture(id);
    } catch {
      /* Already released. */
    }
  }
  function cancel() {
    const ids = [...pointers.keys()];
    pointers.clear();
    gesture = { kind: 'idle' };
    webkit = null;
    options.cancelStroke();
    ids.forEach(release);
    syncCursor();
  }
  function pointerDown(event: PointerEvent) {
    event.preventDefault();
    if (!options.ready()) return;
    const type = event.pointerType || 'mouse';
    if (type === 'touch' && webkit) {
      webkit = null;
      syncCursor();
    }
    if (type === 'touch' && gesture.kind === 'drawing' && gesture.type !== 'touch') return;
    if (type === 'mouse' && event.button !== 0 && event.button !== 1) return;
    if (type === 'pen' && gesture.kind !== 'idle') cancel();
    if (type !== 'touch' && gesture.kind !== 'idle') return;
    if (gesture.kind === 'idle' && options.locked()) return;
    const current = point(event);
    pointers.set(event.pointerId, { point: current, type });
    capture(event.pointerId);
    const touches = [...pointers.entries()].filter(([, value]) => value.type === 'touch');
    if (type === 'touch' && touches.length >= 2) {
      if (gesture.kind === 'pinch' || gesture.kind === 'suppressed') return;
      options.cancelStroke();
      if (options.locked() || !options.beforeNavigate()) {
        gesture = { kind: 'suppressed' };
        return;
      }
      const [[firstId, first], [secondId, second]] = touches;
      gesture = {
        kind: 'pinch',
        ids: [firstId, secondId],
        distance: Math.max(1, distance(first.point, second.point)),
        anchor: screenToWorld(midpoint(first.point, second.point), options.view(), options.size()),
        zoom: options.view().zoom,
      };
      syncCursor();
      return;
    }
    if (gesture.kind !== 'idle') return;
    if (space || options.tool() === 'hand' || event.button === 1) {
      if (options.locked() || !options.beforeNavigate()) gesture = { kind: 'suppressed' };
      else gesture = { kind: 'pan', id: event.pointerId, last: current };
      syncCursor();
    } else if (options.tool() === 'text') {
      if (type === 'touch')
        gesture = { kind: 'text-tap', id: event.pointerId, start: current, moved: false };
      else {
        gesture = { kind: 'suppressed' };
        options.textTap(event);
      }
    } else {
      gesture = { kind: 'drawing', id: event.pointerId, type };
      options.start(event);
    }
  }
  function pointerMove(event: PointerEvent) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    const current = point(event);
    pointer.point = current;
    if (gesture.kind === 'drawing' && gesture.id === event.pointerId) options.move(event);
    else if (gesture.kind === 'text-tap' && gesture.id === event.pointerId) {
      if (distance(current, gesture.start) > 8) gesture.moved = true;
    } else if (gesture.kind === 'pan' && gesture.id === event.pointerId) {
      options.change(
        panBy(options.view(), { x: current.x - gesture.last.x, y: current.y - gesture.last.y })
      );
      gesture.last = current;
    } else if (gesture.kind === 'pinch') {
      const first = pointers.get(gesture.ids[0]),
        second = pointers.get(gesture.ids[1]);
      if (!first || !second) return;
      const middle = midpoint(first.point, second.point),
        size = options.size();
      const zoom = clampZoom(
        (gesture.zoom * distance(first.point, second.point)) / gesture.distance
      );
      options.change({
        zoom,
        center: {
          x: gesture.anchor.x - (middle.x - size.width / 2) / zoom,
          y: gesture.anchor.y - (middle.y - size.height / 2) / zoom,
        },
      });
    }
  }
  function pointerEnd(event: PointerEvent, cancelled: boolean) {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    if (gesture.kind === 'drawing' && gesture.id === event.pointerId) {
      if (cancelled) options.cancelStroke();
      else options.end(event);
    } else if (
      gesture.kind === 'text-tap' &&
      gesture.id === event.pointerId &&
      !cancelled &&
      !gesture.moved &&
      distance(point(event), gesture.start) <= 8
    ) {
      options.textTap(event);
    }
    pointers.delete(event.pointerId);
    // A finger remaining after a pinch must never turn into a new drawing stroke.
    gesture = { kind: pointers.size ? 'suppressed' : 'idle' };
    release(event.pointerId);
    syncCursor();
  }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', (event) => pointerEnd(event, false));
  canvas.addEventListener('pointercancel', (event) => pointerEnd(event, true));
  canvas.addEventListener('lostpointercapture', (event) => pointerEnd(event, true));
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (
        !options.ready() ||
        gesture.kind !== 'idle' ||
        webkit ||
        options.locked() ||
        !options.beforeNavigate()
      )
        return;
      const multiplier =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? options.size().height : 1;
      const dx = event.deltaX * multiplier,
        dy = event.deltaY * multiplier;
      if (event.ctrlKey || event.metaKey)
        options.change(
          zoomAt(
            options.view(),
            options.view().zoom * Math.exp(-dy * 0.002),
            point(event),
            options.size()
          )
        );
      else
        options.change(
          panBy(options.view(), event.shiftKey && dx === 0 ? { x: -dy, y: 0 } : { x: -dx, y: -dy })
        );
    },
    { passive: false }
  );

  type WebKitGesture = Event & { scale: number; clientX: number; clientY: number };
  canvas.addEventListener(
    'gesturestart',
    (raw) => {
      raw.preventDefault();
      // Touchscreen pinches are already handled by Pointer Events.
      if (pointers.size || !options.ready() || options.locked() || !options.beforeNavigate())
        return;
      const event = raw as WebKitGesture;
      const anchor = Number.isFinite(event.clientX)
        ? point(event)
        : { x: options.size().width / 2, y: options.size().height / 2 };
      webkit = { view: options.view(), anchor };
      syncCursor();
    },
    { passive: false }
  );
  canvas.addEventListener(
    'gesturechange',
    (raw) => {
      raw.preventDefault();
      const { scale } = raw as WebKitGesture;
      if (webkit && Number.isFinite(scale) && scale > 0)
        options.change(
          zoomAt(webkit.view, webkit.view.zoom * scale, webkit.anchor, options.size())
        );
    },
    { passive: false }
  );
  canvas.addEventListener('gestureend', (event) => {
    event.preventDefault();
    webkit = null;
    syncCursor();
  });

  function handleKey(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const path = event.composedPath();
    if (
      !options.ready() ||
      path.some(
        (node) =>
          node instanceof Element &&
          node.matches('input, textarea, [contenteditable="true"], [role="textbox"]')
      )
    )
      return false;
    if (
      !path.some(
        (node) =>
          node === canvas ||
          (node instanceof Element &&
            (node.id === 'textSelection' ||
              node.closest('.board-navigation, .object-selection-actions, .object-selection')))
      )
    )
      return false;
    if (event.code === 'Space' && event.target === canvas) {
      space = true;
      event.preventDefault();
      syncCursor();
      return true;
    }
    if (options.locked() || gesture.kind !== 'idle' || !options.beforeNavigate()) return false;
    const size = options.size(),
      anchor = { x: size.width / 2, y: size.height / 2 };
    if (event.key === '+' || event.key === '=' || event.key === '-')
      options.change(
        zoomAt(
          options.view(),
          options.view().zoom * (event.key === '-' ? 1 / 1.25 : 1.25),
          anchor,
          size
        )
      );
    else if (event.key === '0') options.change(zoomAt(options.view(), 1, anchor, size));
    else if (event.key.toLowerCase() === 'f') options.fit();
    else if (options.tool() === 'hand' && event.key.startsWith('Arrow')) {
      const step = event.shiftKey ? 200 : 40;
      const deltas: Record<string, Point> = {
        ArrowLeft: { x: step, y: 0 },
        ArrowRight: { x: -step, y: 0 },
        ArrowUp: { x: 0, y: step },
        ArrowDown: { x: 0, y: -step },
      };
      options.change(panBy(options.view(), deltas[event.key]));
    } else return false;
    event.preventDefault();
    return true;
  }
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      space = false;
      syncCursor();
    }
  });
  window.addEventListener('blur', () => {
    space = false;
    cancel();
  });
  return {
    beginDrag(event: PointerEvent, start: () => void) {
      if (!options.ready() || gesture.kind !== 'idle' || options.locked()) return;
      event.preventDefault();
      pointers.set(event.pointerId, { point: point(event), type: event.pointerType || 'mouse' });
      capture(event.pointerId);
      gesture = { kind: 'drawing', id: event.pointerId, type: event.pointerType || 'mouse' };
      start();
    },
    cancel,
    syncCursor,
    handleKey,
    isBusy: () => gesture.kind !== 'idle' || Boolean(webkit),
  };
}
