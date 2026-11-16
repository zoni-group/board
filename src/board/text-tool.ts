import { t, getLang } from '../i18n.ts';
import { cloneTextObject, isEmptyText } from './model.ts';
import type { BoardCommand, Point, TextObject } from './model.ts';
import { containsPoint, drawText, intersectsText, layoutText } from './text-layout.ts';
import { clearTextDraft, loadTextDraft, recoverTextDraft, saveTextDraft } from './text-draft.ts';
import type { TextDraft } from './text-draft.ts';
import type { TextEditorSession } from './text-editor.ts';

interface TextToolOptions {
  canvas: HTMLCanvasElement;
  layer: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  getObjects(): TextObject[];
  getHistory(): BoardCommand[];
  persist(): Promise<boolean>;
  commit(command: BoardCommand): Promise<boolean>;
  historyChanged(): void;
  ink(): string;
  status(message: string): void;
}
let editorModule: Promise<typeof import('./text-editor.ts')> | undefined;
function loadEditor() {
  return (editorModule ??= import('./text-editor.ts').catch((error) => {
    editorModule = undefined;
    throw error;
  }));
}

export function createTextTool(options: TextToolOptions) {
  const { canvas, layer, context } = options;
  const parent = canvas.parentElement;
  if (!parent) throw new Error('Missing board frame');
  const frame = parent;
  const selection = document.createElement('div');
  selection.id = 'textSelection';
  selection.className = 'text-selection';
  selection.hidden = true;
  selection.tabIndex = 0;
  selection.setAttribute('role', 'group');
  const move = document.createElement('button'),
    edit = document.createElement('button'),
    remove = document.createElement('button');
  move.type = edit.type = remove.type = 'button';
  const tools = document.createElement('div');
  tools.className = 'text-selection-actions';
  tools.append(move, edit, remove);
  selection.append(tools);
  frame.append(selection);
  const host = document.createElement('div');
  host.className = 'board-text-editor';
  host.hidden = true;
  document.body.append(host);
  const done = document.createElement('button'),
    cancel = document.createElement('button');
  done.type = cancel.type = 'button';
  const actions = document.createElement('div');
  actions.className = 'text-editor-actions';
  actions.append(done, cancel);
  let active = false,
    selectedId: string | null = null,
    generation = 0,
    loading = false;
  let session: TextEditorSession | null = null,
    draft: TextDraft | null = null;
  let timer: number | undefined,
    composing = false;
  let drag: { pointer: number; start: Point; original: TextObject; object: TextObject } | null =
    null;
  const erased = new Set<string>();

  function labels() {
    move.textContent = t('moveText');
    edit.textContent = t('editText');
    remove.textContent = t('deleteText');
    done.textContent = t('doneText');
    cancel.textContent = t('cancelText');
    move.setAttribute('aria-label', t('moveText'));
    selection.setAttribute('aria-label', t('selectedText'));
    session?.configure(getLang(), window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  labels();

  function selected() {
    return options.getObjects().find((object) => object.id === selectedId);
  }
  function paint() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, layer.width, layer.height);
    context.restore();
    for (const object of options.getObjects()) {
      if (erased.has(object.id) || (draft?.object.id === object.id && (session || loading)))
        continue;
      drawText(context, drag?.object.id === object.id ? drag.object : object);
    }
    const object = drag?.object ?? selected();
    selection.hidden = !active || !object || Boolean(session || loading) || erased.has(object.id);
    if (object) {
      const { bounds } = layoutText(context, object);
      Object.assign(selection.style, {
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      });
      const view = canvas.getBoundingClientRect();
      const clip = frame.getBoundingClientRect();
      const controls = tools.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = Math.max(view.left, clip.left, viewport?.offsetLeft ?? 0) + 4;
      const top =
        Math.max(
          view.top,
          clip.top,
          viewport?.offsetTop ?? 0,
          document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
        ) + 4;
      const right =
        Math.min(
          view.right,
          clip.right,
          (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth)
        ) - 4;
      const bottom =
        Math.min(
          view.bottom,
          clip.bottom,
          (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)
        ) - 4;
      const desiredY = view.top + (bounds.y < 42 ? bounds.y + bounds.height + 4 : bounds.y - 38);
      tools.style.top = `${Math.max(top, Math.min(desiredY, bottom - controls.height)) - view.top - bounds.y}px`;
      tools.style.left = `${Math.max(left, Math.min(view.left + bounds.x, right - controls.width)) - view.left - bounds.x}px`;
    }
  }
  function flushDraft() {
    window.clearTimeout(timer);
    if (!session || !draft) return;
    draft.object = session.read();
    if (JSON.stringify(draft.object) === JSON.stringify(draft.original)) return;
    if (!saveTextDraft(draft)) options.status(t('textSaveFailed'));
  }
  function positionEditor() {
    if (!session || !draft) return;
    const object = session.read();
    const { bounds } = layoutText(context, object);
    const rect = canvas.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth,
      height = viewport?.height ?? window.innerHeight;
    const offsetX = viewport?.offsetLeft ?? 0,
      offsetY = viewport?.offsetTop ?? 0;
    host.style.width = `${Math.max(24, Math.min(bounds.width + 2, width - 32))}px`;
    const toolbar = session.element.shadowRoot?.querySelector<HTMLElement>(
      '[part~="plugin-container-top"]'
    );
    const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 48;
    host.style.left = `${Math.max(offsetX + 12, Math.min(rect.left + object.position.x, offsetX + width - Math.min(340, width - 24) - 12))}px`;
    host.style.top = `${Math.max(offsetY + toolbarHeight + 12, Math.min(rect.top + object.position.y, offsetY + height - Math.min(bounds.height, height - toolbarHeight - 80) - 60))}px`;
    session.element.style.setProperty(
      '--board-text-max-height',
      `${Math.max(40, height - toolbarHeight - 90)}px`
    );
  }
  function changed() {
    if (!session || !draft) return;
    options.historyChanged();
    positionEditor();
    window.clearTimeout(timer);
    timer = window.setTimeout(flushDraft, 250);
  }
  function closeEditor() {
    generation++;
    loading = false;
    window.clearTimeout(timer);
    session?.destroy();
    session = null;
    host.hidden = true;
    host.replaceChildren();
    composing = false;
    options.historyChanged();
  }
  function finish(): boolean {
    if (composing) return false;
    if (!session || !draft) {
      if (loading) closeEditor();
      return true;
    }
    flushDraft();
    const current = draft;
    const object = session.read();
    draft = null;
    closeEditor();
    selectedId = isEmptyText(object) ? null : object.id;
    if (isEmptyText(object) && !current.original) {
      clearTextDraft(current.token);
      paint();
      return true;
    }
    if (JSON.stringify(object) === JSON.stringify(current.original)) {
      void options.persist().then((ok) => {
        if (ok) clearTextDraft(current.token);
        else options.status(t('textSaveFailed'));
      });
      paint();
      return true;
    }
    saveTextDraft({ ...current, object, committing: true });
    const command: BoardCommand = isEmptyText(object)
      ? { type: 'text-delete', ids: [object.id] }
      : { type: 'text-set', object };
    void options.commit(command).then((ok) => {
      if (ok) clearTextDraft(current.token);
      else options.status(t('textSaveFailed'));
    });
    paint();
    return true;
  }
  function cancelEdit() {
    if (composing) return;
    const current = draft;
    if (current?.original) {
      const original = current.original;
      void options.persist().then((ok) => {
        if (ok) clearTextDraft(current.token);
        else {
          if (loadTextDraft()?.token === current.token)
            saveTextDraft({ ...current, object: original, original: null, committing: true });
          options.status(t('textSaveFailed'));
        }
      });
    } else if (current) clearTextDraft(current.token);
    draft = null;
    closeEditor();
    paint();
    canvas.focus({ preventScroll: true });
  }
  async function open(
    object: TextObject,
    original: TextObject | null,
    token: string = crypto.randomUUID()
  ) {
    if (!finish()) return;
    const ticket = ++generation;
    loading = true;
    selectedId = object.id;
    const previousDraft = loadTextDraft();
    if (
      original &&
      previousDraft?.committing &&
      JSON.stringify(previousDraft.object) === JSON.stringify(original)
    )
      token = previousDraft.token;
    draft = {
      token,
      object: cloneTextObject(object),
      original: original ? cloneTextObject(original) : null,
    };
    paint();
    options.historyChanged();
    options.status(t('loadingText'));
    try {
      const module = await loadEditor();
      if (ticket !== generation || !active) return;
      const mounted = await module.mountTextEditor(
        object,
        options.ink(),
        getLang(),
        window.matchMedia('(prefers-color-scheme: dark)').matches,
        changed
      );
      if (ticket !== generation || !active) {
        mounted.destroy();
        return;
      }
      session = mounted;
      loading = false;
      host.replaceChildren(session.element, actions);
      host.hidden = false;
      labels();
      positionEditor();
      session.focus();
      changed();
      paint();
      options.status(t('editingText'));
    } catch {
      if (ticket !== generation) return;
      closeEditor();
      draft = null;
      paint();
      options.status(t('textLoadFailed'));
    }
  }
  function create(point: Point) {
    void open(
      { id: crypto.randomUUID(), position: point, paragraphs: [{ align: 'left', runs: [] }] },
      null
    );
  }
  function hit(point: Point) {
    return options
      .getObjects()
      .reverse()
      .find((object) => containsPoint(layoutText(context, object).bounds, point));
  }
  function deleteSelected() {
    const object = selected();
    if (!object) return;
    selectedId = null;
    void options.commit({ type: 'text-delete', ids: [object.id] }).then((ok) => {
      if (!ok) options.status(t('textSaveFailed'));
    });
    paint();
    canvas.focus({ preventScroll: true });
  }
  function clampPosition(point: Point): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(point.x, rect.width - 24)),
      y: Math.max(0, Math.min(point.y, rect.height - 24)),
    };
  }
  function stopDrag(commit: boolean) {
    if (!drag) return;
    const current = drag;
    drag = null;
    try {
      move.releasePointerCapture(current.pointer);
    } catch {
      /* Already released. */
    }
    if (
      commit &&
      (current.object.position.x !== current.original.position.x ||
        current.object.position.y !== current.original.position.y)
    )
      void options.commit({ type: 'text-set', object: current.object });
    paint();
  }
  move.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    const object = selected();
    if (!object) return;
    event.preventDefault();
    drag = {
      pointer: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      original: cloneTextObject(object),
      object: cloneTextObject(object),
    };
    try {
      move.setPointerCapture(event.pointerId);
    } catch {
      /* Capture may be unavailable during cancellation. */
    }
  });
  move.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.object.position = clampPosition({
      x: drag.original.position.x + event.clientX - drag.start.x,
      y: drag.original.position.y + event.clientY - drag.start.y,
    });
    paint();
  });
  move.addEventListener('pointerup', (event) => {
    if (drag?.pointer === event.pointerId) stopDrag(true);
  });
  move.addEventListener('pointercancel', () => stopDrag(false));
  move.addEventListener('lostpointercapture', () => stopDrag(false));
  edit.addEventListener('click', () => {
    const object = selected();
    if (object) void open(object, object);
  });
  remove.addEventListener('click', deleteSelected);
  done.addEventListener('click', () => {
    if (finish()) canvas.focus({ preventScroll: true });
  });
  cancel.addEventListener('click', cancelEdit);
  host.addEventListener('compositionstart', () => {
    composing = true;
  });
  host.addEventListener('compositionend', () => {
    composing = false;
    changed();
  });
  const popupEscapes = new WeakSet<Event>();
  host.addEventListener(
    'keydown',
    (event) => {
      const expanded =
        session?.element.shadowRoot?.querySelector<HTMLElement>('[aria-expanded="true"]');
      if (event.key === 'Escape' && !event.isComposing && !composing && expanded) {
        popupEscapes.add(event);
        event.preventDefault();
        event.stopPropagation();
        // Closing through the control also handles popups whose focus stayed on the host (mobile Safari).
        expanded.click();
      }
    },
    true
  );
  host.addEventListener('keydown', (event) => {
    if (event.isComposing || composing || event.defaultPrevented || popupEscapes.has(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (finish()) canvas.focus({ preventScroll: true });
    }
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!session || event.composedPath().includes(host)) return;
      // Board undo/redo targets the editor until the edit is finished.
      if (
        event
          .composedPath()
          .some((node) => node instanceof Element && (node.id === 'undo' || node.id === 'redo'))
      )
        return;
      finish();
    },
    true
  );
  canvas.addEventListener('dblclick', (event) => {
    if (!active || session || loading) return;
    const rect = canvas.getBoundingClientRect();
    const object = hit({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (object) void open(object, object);
  });
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushDraft();
  });
  document.addEventListener('i18n:change', labels);
  window.addEventListener('resize', () => {
    positionEditor();
    paint();
  });
  window.addEventListener(
    'scroll',
    () => {
      positionEditor();
      paint();
    },
    true
  );
  window.visualViewport?.addEventListener('resize', positionEditor);
  window.visualViewport?.addEventListener('scroll', positionEditor);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', labels);

  return {
    paint,
    finish,
    isEditing: () => Boolean(session || loading),
    canUndo: () => session?.canUndo() ?? false,
    canRedo: () => session?.canRedo() ?? false,
    undo: () => {
      session?.undo();
      changed();
    },
    redo: () => {
      session?.redo();
      changed();
    },
    activate(value: boolean) {
      if (!value && !finish()) return false;
      active = value;
      canvas.classList.toggle('text-tool-active', active);
      if (!active) {
        selectedId = null;
        stopDrag(false);
      }
      paint();
      if (active) void loadEditor().catch(() => options.status(t('textLoadFailed')));
      return true;
    },
    pointerDown(event: PointerEvent): boolean {
      if (!active) return false;
      if ((event.pointerType === 'mouse' && event.button !== 0) || composing) return true;
      if (!finish()) return true;
      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const object = hit(point);
      if (object) {
        selectedId = object.id;
        paint();
        selection.focus({ preventScroll: true });
      } else create(point);
      return true;
    },
    erase(from: Point, to: Point, radius: number): string[] {
      const ids = options
        .getObjects()
        .filter((object) => intersectsText(layoutText(context, object).bounds, from, to, radius))
        .map((object) => object.id);
      ids.forEach((id) => erased.add(id));
      paint();
      return ids;
    },
    clearErasePreview() {
      erased.clear();
      paint();
    },
    recover() {
      const recovered = recoverTextDraft(options.getObjects(), options.getHistory());
      if (!recovered) return false;
      active = true;
      canvas.classList.add('text-tool-active');
      void open(recovered.object, recovered.original, recovered.token);
      return true;
    },
    handleKey(event: KeyboardEvent): boolean {
      if (session || loading) return true;
      if (!active || event.isComposing) return false;
      if (event.target !== canvas && event.target !== selection) return false;
      if (event.key === 'Escape') {
        selectedId = null;
        paint();
        return true;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const object = selected();
        if (object) void open(object, object);
        else create({ x: 32, y: 32 });
        return true;
      }
      const object = selected();
      if (!object) return false;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return true;
      }
      const delta = event.shiftKey ? 10 : 1;
      const offsets: Record<string, Point> = {
        ArrowLeft: { x: -delta, y: 0 },
        ArrowRight: { x: delta, y: 0 },
        ArrowUp: { x: 0, y: -delta },
        ArrowDown: { x: 0, y: delta },
      };
      const offset = offsets[event.key];
      if (!offset) return false;
      event.preventDefault();
      const next = cloneTextObject(object);
      next.position = clampPosition({
        x: object.position.x + offset.x,
        y: object.position.y + offset.y,
      });
      if (next.position.x !== object.position.x || next.position.y !== object.position.y)
        void options.commit({ type: 'text-set', object: next });
      return true;
    },
  };
}
