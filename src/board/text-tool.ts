import { t, getLang } from '../i18n.ts';
import { cloneTextObject, isEmptyText } from './model.ts';
import type { BoardCommand, Point, TextObject } from './model.ts';
import {
  cachedTextLayout,
  containsPoint,
  drawText,
  intersectsText,
  layoutText,
} from './text-layout.ts';
import {
  applyViewport,
  boundsIntersect,
  screenToWorld,
  visibleBounds,
  worldToScreen,
} from './viewport.ts';
import type { BoardViewport } from './viewport.ts';
import { panelArea } from './screen-layout.ts';
import { clearTextDraft, loadTextDraft, recoverTextDraft, saveTextDraft } from './text-draft.ts';
import type { TextDraft } from './text-draft.ts';
import type { TextEditorSession } from './text-editor.ts';
import type { SelectionController } from './selection.ts';

interface TextToolOptions {
  canvas: HTMLCanvasElement;
  selection: SelectionController;
  selecting(): boolean;
  layer: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  getObjects(): TextObject[];
  getViewport(): BoardViewport;
  reveal(point: Point): void;
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
  const host = document.createElement('div');
  host.className = 'board-text-editor';
  host.hidden = true;
  document.body.append(host);
  const editorBody = document.createElement('div');
  editorBody.className = 'board-text-editor-body';
  const done = document.createElement('button'),
    cancel = document.createElement('button');
  done.type = cancel.type = 'button';
  const actions = document.createElement('div');
  actions.className = 'text-editor-actions';
  actions.append(done, cancel);
  let active = false,
    generation = 0,
    loading = false;
  let session: TextEditorSession | null = null,
    draft: TextDraft | null = null;
  let timer: number | undefined,
    composing = false;
  const erased = new Set<string>();

  function labels() {
    done.textContent = t('doneText');
    cancel.textContent = t('cancelText');
    session?.configure(getLang(), window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  labels();

  function selected() {
    const ref = options.selection.current();
    return ref?.kind === 'text'
      ? options.getObjects().find((object) => object.id === ref.id)
      : undefined;
  }
  function size() {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  function worldPoint(event: { clientX: number; clientY: number }): Point {
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      options.getViewport(),
      rect
    );
  }
  function paint() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, layer.width, layer.height);
    context.restore();
    const boardView = options.getViewport();
    applyViewport(context, boardView, size(), Math.max(1, window.devicePixelRatio || 1));
    const visible = visibleBounds(boardView, size());
    for (const object of options.getObjects()) {
      if (erased.has(object.id) || (draft?.object.id === object.id && (session || loading)))
        continue;
      const displayed = options.selection.displayText(object);
      const layout = cachedTextLayout(context, displayed);
      if (boundsIntersect(layout.bounds, visible)) drawText(context, displayed, layout);
    }
    options.selection.paint();
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
    const area = panelArea();
    const minimumWidth = Math.min(340, area.width);
    // Empty text has only caret-sized bounds; fit its hint inside the editor, including borders.
    const contentWidth = isEmptyText(object)
      ? minimumWidth - 2
      : Math.min(bounds.width + 2, area.width);
    const width = Math.max(minimumWidth, contentWidth);
    host.style.width = `${width}px`;
    host.style.maxHeight = `${area.height}px`;
    session.element.style.setProperty('--board-text-width', `${Math.max(24, contentWidth)}px`);
    const toolbar = session.element.shadowRoot?.querySelector<HTMLElement>(
      '[part~="plugin-container-top"]'
    );
    const toolbarHeight = toolbar?.getBoundingClientRect().height ?? 48;
    const actionsHeight = actions.getBoundingClientRect().height || 40;
    session.element.style.setProperty(
      '--board-text-max-height',
      `${Math.max(38.4, area.height - toolbarHeight - actionsHeight - 12)}px`
    );
    const anchor = worldToScreen(object.position, options.getViewport(), rect);
    const height = Math.min(area.height, host.getBoundingClientRect().height);
    host.style.left = `${Math.max(area.left, Math.min(rect.left + anchor.x, area.right - width))}px`;
    host.style.top = `${Math.max(area.top, Math.min(rect.top + anchor.y - toolbarHeight, area.bottom - height))}px`;
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
    if (isEmptyText(object) && !current.original) {
      clearTextDraft(current.token);
      options.selection.clear();
      paint();
      return true;
    }
    if (JSON.stringify(object) === JSON.stringify(current.original)) {
      void options.persist().then((ok) => {
        if (ok) clearTextDraft(current.token);
        else options.status(t('textSaveFailed'));
      });
      options.selection.select({ kind: 'text', id: object.id });
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
    options.selection.select(isEmptyText(object) ? null : { kind: 'text', id: object.id });
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
    options.selection.select(original ? { kind: 'text', id: object.id } : null);
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
      if (ticket !== generation) return;
      const mounted = await module.mountTextEditor(
        object,
        options.ink(),
        getLang(),
        window.matchMedia('(prefers-color-scheme: dark)').matches,
        changed
      );
      if (ticket !== generation) {
        mounted.destroy();
        return;
      }
      session = mounted;
      loading = false;
      editorBody.replaceChildren(session.element);
      host.replaceChildren(editorBody, actions);
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
      .find((object) =>
        containsPoint(
          cachedTextLayout(context, object).bounds,
          point,
          4 / options.getViewport().zoom
        )
      );
  }
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
    if ((!active && !options.selecting()) || session || loading) return;
    const object = hit(worldPoint(event));
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
    reflow() {
      paint();
      positionEditor();
    },
    finish,
    isEditing: () => Boolean(session || loading),
    isDragging: () => options.selection.isDragging(),
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
      paint();
      if (active) void loadEditor().catch(() => options.status(t('textLoadFailed')));
      return true;
    },
    pointerDown(event: PointerEvent): boolean {
      if (!active) return false;
      if ((event.pointerType === 'mouse' && event.button !== 0) || composing) return true;
      if (!finish()) return true;
      const point = worldPoint(event);
      const object = hit(point);
      if (object) {
        options.selection.select({ kind: 'text', id: object.id });
        paint();
        document.getElementById('textSelection')?.focus({ preventScroll: true });
      } else create(point);
      return true;
    },
    erase(from: Point, to: Point, radius: number): string[] {
      const ids = options
        .getObjects()
        .filter((object) =>
          intersectsText(cachedTextLayout(context, object).bounds, from, to, radius)
        )
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
      const bounds = cachedTextLayout(context, recovered.object).bounds;
      if (!boundsIntersect(bounds, visibleBounds(options.getViewport(), size())))
        options.reveal({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
      active = true;
      canvas.classList.add('text-tool-active');
      void open(recovered.object, recovered.original, recovered.token);
      return true;
    },
    edit(id: string) {
      const object = options.getObjects().find((object) => object.id === id);
      if (object) void open(object, object);
    },
    handleKey(event: KeyboardEvent): boolean {
      if (session || loading) return true;
      if (!active || event.isComposing || event.target !== canvas) return false;
      if (event.key === 'Enter') {
        event.preventDefault();
        const object = selected();
        if (object) void open(object, object);
        else create(screenToWorld({ x: 32, y: 32 }, options.getViewport(), size()));
        return true;
      }
      return false;
    },
  };
}
