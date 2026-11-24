import { getLang, t } from '../i18n.ts';
import { isDarkTheme, onThemeChange } from './theme.ts';
import { IconImage, IconTable, IconText, IconVideo } from '../icons.ts';
import { applyButtonIcon } from '../shared/tools-menu.ts';
import {
  discardAsset,
  IMAGE_TYPES,
  importImage,
  importVideo,
  readAsset,
  saveAsset,
  VIDEO_TYPES,
} from './assets.ts';
import { contentBounds } from './content.ts';
import { cloneContentObject, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from './model.ts';
import type {
  BoardCommand,
  BoardObjectRef,
  ContentObject,
  Point,
  TableObject,
  VideoObject,
} from './model.ts';
import type { SelectionController } from './selection.ts';
import { constrainPopup, panelArea } from './screen-layout.ts';
import { screenToWorld } from './viewport.ts';
import type { BoardViewport } from './viewport.ts';
import { parseVideoUrl, videoEmbedUrl } from './video.ts';
import type { TableEditorSession } from './table-editor.ts';

interface ContentToolOptions {
  canvas: HTMLCanvasElement;
  button: HTMLButtonElement;
  selection: SelectionController;
  ready(): boolean;
  boardId(): string;
  objects(): ContentObject[];
  view(): BoardViewport;
  prepare(): boolean;
  text(): void;
  commit(command: BoardCommand): Promise<boolean>;
  redraw(): void;
  historyChanged(): void;
  ink(): string;
  status(message: string): void;
  /** A PDF dropped on the board becomes pages, not an image. */
  insertPdf(file: File): void;
  /** Ctrl/⌘+V: pastes copied board objects; false leaves the paste to the image handler. */
  pasteObjects(data: DataTransfer | null): boolean;
}
export function createContentTool(options: ContentToolOptions) {
  const { canvas, button } = options;
  const picker = document.createElement('div');
  picker.id = 'objectPicker';
  picker.className = 'shape-picker object-picker';
  picker.hidden = true;
  picker.setAttribute('role', 'dialog');
  button.setAttribute('aria-controls', picker.id);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const icons = { text: IconText, image: IconImage, table: IconTable, video: IconVideo };
  let choice: keyof typeof icons = 'text';
  const choices = Object.entries(icons).map(([kind, icon]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.dataset.object = kind;
    item.innerHTML = `<span class="btn-icon" aria-hidden="true">${icon}</span><span></span>`;
    item.addEventListener('click', () => {
      closePicker();
      if (kind === 'text') {
        choice = 'text';
        labels();
        options.text();
        return;
      }
      if (!options.prepare()) return;
      choice = kind as typeof choice;
      labels();
      if (kind === 'image') chooseFile('image');
      else if (kind === 'table') tablePicker();
      else videoPicker();
    });
    picker.append(item);
    return item;
  });
  document.body.append(picker);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.hidden = true;
  document.body.append(fileInput);
  let fileKind: 'image' | 'video' = 'image';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void insertFile(file, fileKind);
    fileInput.value = '';
  });
  let host: HTMLElement | null = null,
    body: HTMLElement | null = null;
  let tableSession: TableEditorSession | null = null,
    tableOriginal: TableObject | null = null;
  let generation = 0,
    composing = false,
    loading = false;
  let playerUrls: string[] = [];
  let tableModule: Promise<typeof import('./table-editor.ts')> | undefined;

  function labels() {
    picker.setAttribute('aria-label', t('addObject'));
    button.setAttribute('aria-label', t('addObject'));
    button.title = `${t('addObject')} · ${t(choice)}`;
    applyButtonIcon(button, icons[choice]);
    for (const item of choices) item.lastElementChild!.textContent = t(item.dataset.object!);
    host
      ?.querySelectorAll<HTMLElement>('[data-content-label]')
      .forEach((element) => (element.textContent = t(element.dataset.contentLabel!)));
    tableSession?.configure(getLang(), isDarkTheme());
  }
  function position() {
    if (!picker.hidden) {
      const anchor = button.getBoundingClientRect();
      picker.style.left = `${anchor.left}px`;
      picker.style.top = `${anchor.bottom + 4}px`;
      constrainPopup(picker);
    }
    if (!host) return;
    const area = panelArea(),
      width = Math.min(host.classList.contains('board-table-editor') ? 900 : 640, area.width);
    host.style.width = `${width}px`;
    host.style.maxHeight = `${area.height}px`;
    host.style.left = `${area.left + (area.width - width) / 2}px`;
    host.style.top = `${area.top + Math.max(0, (area.height - host.getBoundingClientRect().height) / 2)}px`;
  }
  function closePicker(focus = false) {
    picker.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    options.selection.paint();
    if (focus) button.focus({ preventScroll: true });
  }
  function closePanel() {
    generation++;
    loading = false;
    composing = false;
    tableSession?.destroy();
    tableSession = null;
    tableOriginal = null;
    host?.querySelector('video')?.pause();
    host?.querySelector('iframe')?.remove();
    host?.remove();
    host = body = null;
    for (const url of playerUrls) URL.revokeObjectURL(url);
    playerUrls = [];
    options.historyChanged();
    options.selection.paint();
  }
  function cancel() {
    if (composing) return;
    closePanel();
    options.redraw();
    canvas.focus({ preventScroll: true });
  }
  function label(element: HTMLElement, key: string) {
    element.dataset.contentLabel = key;
    element.textContent = t(key);
    return element;
  }
  function action(key: string, run: () => void) {
    const control = document.createElement('button');
    control.type = 'button';
    label(control, key);
    control.addEventListener('click', run);
    return control;
  }
  function panel(title: string, table = false) {
    closePanel();
    closePicker();
    host = document.createElement('section');
    host.className = `board-content-panel ${table ? 'board-table-editor' : ''}`;
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-labelledby', 'contentPanelTitle');
    const heading = label(document.createElement('h2'), title);
    heading.id = 'contentPanelTitle';
    body = document.createElement('div');
    body.className = 'board-content-body';
    const actions = document.createElement('div');
    actions.className = 'content-panel-actions';
    host.append(heading, body, actions);
    document.body.append(host);
    host.addEventListener('compositionstart', () => (composing = true));
    host.addEventListener('compositionend', () => (composing = false));
    actions.append(action('cancelText', cancel));
    position();
    options.historyChanged();
    options.selection.paint();
    return { host, body, actions };
  }
  function center(bounds: { width: number; height: number }, at?: Point) {
    const point = at ?? options.view().center;
    return { x: point.x - bounds.width / 2, y: point.y - bounds.height / 2 };
  }
  function commit(object: ContentObject) {
    void options.commit({ type: 'content-set', object }).then((ok) => {
      if (!ok) options.status(t('objectSaveFailed'));
    });
    options.selection.select({ kind: object.kind, id: object.id });
    options.redraw();
    canvas.focus({ preventScroll: true });
  }
  function chooseFile(kind: 'image' | 'video') {
    fileKind = kind;
    fileInput.accept = (kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES).join(',');
    fileInput.value = '';
    fileInput.click();
  }
  async function insertFile(file: File, kind: 'image' | 'video', at?: Point) {
    if (!options.ready() || !options.prepare()) return;
    const { body: area } = panel(kind);
    label(area, 'importingMedia');
    loading = true;
    const ticket = generation;
    const boardId = options.boardId();
    let id: string | null = null;
    try {
      const asset = await (kind === 'image' ? importImage(file) : importVideo(file));
      if (generation !== ticket) return;
      id = await saveAsset(boardId, asset);
      if (generation !== ticket) {
        await discardAsset(id);
        return;
      }
      const rect = canvas.getBoundingClientRect(),
        zoom = options.view().zoom;
      const scale = Math.min(
        1,
        640 / asset.width,
        (rect.width * 0.8) / (asset.width * zoom),
        (rect.height * 0.75) / (asset.height * zoom)
      );
      const width = Math.max(1, asset.width * scale),
        height = Math.max(1, asset.height * scale);
      const box = {
        id: crypto.randomUUID(),
        position: center({ width, height }, at),
        width,
        height,
        title: file.name.slice(0, 500),
      };
      closePanel();
      commit(
        kind === 'image'
          ? { ...box, kind: 'image', assetId: id }
          : { ...box, kind: 'video', source: { kind: 'local', assetId: id } }
      );
    } catch (error) {
      if (id) await discardAsset(id);
      if (generation !== ticket) return;
      closePanel();
      const code = error instanceof Error ? error.message : '';
      options.status(
        t(
          ['assetStorageFailed', 'imageTooLarge', 'videoTooLarge'].includes(code)
            ? code
            : 'unsupportedMedia'
        )
      );
      canvas.focus({ preventScroll: true });
    }
  }
  function tablePicker() {
    const { body: area, actions } = panel('table');
    const form = document.createElement('form');
    form.className = 'content-form';
    const fields = [
      ['tableRows', MAX_TABLE_ROWS],
      ['tableColumns', MAX_TABLE_COLUMNS],
    ] as const;
    const inputs = fields.map(([key, max]) => {
      const wrapper = label(document.createElement('label'), key),
        input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = String(max);
      input.value = '3';
      input.required = true;
      wrapper.append(input);
      form.append(wrapper);
      return input;
    });
    const create = action('insertObject', () => form.requestSubmit());
    actions.prepend(create);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const columns = Number(inputs[1].value),
        rows = Number(inputs[0].value);
      const width = Math.max(
        60,
        Math.min(160, (canvas.getBoundingClientRect().width * 0.8) / options.view().zoom / columns)
      );
      const object: TableObject = {
        kind: 'table',
        id: crypto.randomUUID(),
        position: { x: 0, y: 0 },
        borderRaw: options.ink(),
        columnWidths: Array(columns).fill(width),
        rows: Array.from({ length: rows }, () => ({
          minHeight: 48,
          cells: Array.from({ length: columns }, () => [
            {
              align: 'left',
              runs: [{ text: '', fontSize: 24, inkRaw: options.ink(), bold: false, italic: false }],
            },
          ]),
        })),
      };
      const ctx = canvas.getContext('2d')!;
      object.position = center(contentBounds(ctx, object));
      void editTable(object, null);
    });
    area.append(form);
    position();
    inputs[0].focus({ preventScroll: true });
  }
  async function editTable(object: TableObject, original: TableObject | null) {
    const { body: area, actions } = panel('table', true);
    label(area, 'loadingText');
    loading = true;
    const ticket = generation;
    const done = action('doneText', () => {
      finish();
    });
    done.disabled = true;
    actions.prepend(done);
    try {
      tableModule ??= import('./table-editor.ts').catch((error) => {
        tableModule = undefined;
        throw error;
      });
      const module = await tableModule;
      if (ticket !== generation) return;
      const session = await module.openTableEditor(
        cloneContentObject(object),
        options.ink(),
        getLang(),
        isDarkTheme(),
        () => {
          options.historyChanged();
          position();
        },
        options.status
      );
      if (ticket !== generation) {
        session.destroy();
        return;
      }
      tableSession = session;
      tableOriginal = original;
      loading = false;
      done.disabled = false;
      delete area.dataset.contentLabel;
      area.replaceChildren(session.element);
      position();
      session.focus();
      options.historyChanged();
    } catch {
      if (ticket !== generation) return;
      closePanel();
      options.status(t('tableLoadFailed'));
      canvas.focus({ preventScroll: true });
    }
  }
  function finish(): boolean {
    if (composing) return false;
    if (tableSession) {
      try {
        const object = tableSession.read(),
          original = tableOriginal;
        closePanel();
        if (object && JSON.stringify(object) !== JSON.stringify(original)) commit(object);
        else if (!object && original) {
          void options.commit({ type: 'content-delete', ids: [original.id] });
          options.selection.clear();
          options.redraw();
        }
      } catch {
        options.status(t('invalidTable'));
        return false;
      }
    } else if (host) closePanel();
    return true;
  }
  function videoPicker() {
    const { body: area, actions } = panel('video');
    const local = action('chooseVideoFile', () => chooseFile('video'));
    const hint = label(document.createElement('p'), 'videoHint');
    const form = document.createElement('form');
    form.className = 'content-form';
    const wrapper = label(document.createElement('label'), 'videoUrl'),
      input = document.createElement('input');
    input.type = 'url';
    input.required = true;
    input.placeholder = 'https://…';
    wrapper.append(input);
    form.append(wrapper);
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    actions.prepend(action('insertObject', () => form.requestSubmit()));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const source = parseVideoUrl(input.value);
      if (!source) {
        label(error, 'invalidVideoUrl');
        position();
        return;
      }
      const width = Math.min(
          480,
          (canvas.getBoundingClientRect().width * 0.8) / options.view().zoom
        ),
        height = (width * 9) / 16;
      const object: VideoObject = {
        kind: 'video',
        id: crypto.randomUUID(),
        position: center({ width, height }),
        width,
        height,
        title: source.kind === 'youtube' ? 'YouTube' : 'Vimeo',
        source,
      };
      closePanel();
      commit(object);
    });
    area.append(local, hint, form, error);
    position();
    input.focus({ preventScroll: true });
  }
  async function play(object: VideoObject) {
    const { host: player, body: area, actions } = panel('playVideo');
    player.classList.add('board-video-player');
    actions.replaceChildren(action('close', cancel));
    const title = document.createElement('p');
    title.textContent = object.title;
    area.append(title);
    const ticket = generation;
    if (object.source.kind === 'local') {
      const asset = await readAsset(object.source.assetId);
      if (ticket !== generation) return;
      if (!asset || asset.kind !== 'video') {
        area.append(label(document.createElement('p'), 'missingMedia'));
        position();
        return;
      }
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      const url = URL.createObjectURL(asset.blob);
      playerUrls.push(url);
      video.src = url;
      video.addEventListener('error', () => options.status(t('unsupportedMedia')));
      area.append(video);
    } else {
      area.append(label(document.createElement('p'), 'onlineVideoHint'));
      const frame = document.createElement('iframe');
      frame.title = object.title || t('video');
      frame.allow = 'fullscreen; picture-in-picture; encrypted-media';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.src = videoEmbedUrl(object.source)!;
      area.append(frame);
    }
    position();
    actions.querySelector('button')?.focus({ preventScroll: true });
  }
  function editable(event: Event) {
    return event
      .composedPath()
      .some(
        (node) =>
          node instanceof Element &&
          node.matches('input,textarea,[contenteditable="true"],notectl-editor')
      );
  }
  canvas.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  canvas.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    if (host) return;
    if (event.dataTransfer.files.length > 1) {
      options.status(t('oneFileAtATime'));
      return;
    }
    const file = event.dataTransfer.files[0],
      rect = canvas.getBoundingClientRect();
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      options.insertPdf(file);
      return;
    }
    const point = screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      options.view(),
      rect
    );
    void insertFile(file, file.type.startsWith('video/') ? 'video' : 'image', point);
  });
  document.addEventListener('paste', (event) => {
    if (editable(event) || host || !options.ready()) return;
    if (options.pasteObjects(event.clipboardData)) {
      event.preventDefault();
      return;
    }
    const file = Array.from(event.clipboardData?.files ?? []).find((file) =>
      IMAGE_TYPES.includes(file.type)
    );
    if (file) {
      event.preventDefault();
      void insertFile(file, 'image');
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (
      !picker.hidden &&
      !event.composedPath().includes(picker) &&
      !event.composedPath().includes(button)
    )
      closePicker();
  });
  document.addEventListener('board:layout', position);
  document.addEventListener('i18n:change', () => {
    labels();
    position();
  });
  onThemeChange(labels);
  window.addEventListener('pagehide', () => {
    closePanel();
    closePicker();
  });
  labels();
  return {
    finish,
    position,
    cancel,
    closePicker,
    isPickerOpen: () => !picker.hidden,
    isEditing: () => Boolean(host),
    isBusy: () => Boolean(host) || loading,
    undo: () => {
      tableSession?.undo();
      options.historyChanged();
    },
    redo: () => {
      tableSession?.redo();
      options.historyChanged();
    },
    canUndo: () => Boolean(tableSession?.canUndo()),
    canRedo: () => Boolean(tableSession?.canRedo()),
    togglePicker() {
      if (!picker.hidden) {
        closePicker(true);
        return;
      }
      picker.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      position();
      options.selection.paint();
      choices.find((item) => item.dataset.object === choice)?.focus({ preventScroll: true });
    },
    edit(ref: BoardObjectRef) {
      const object = options.objects().find((object) => object.id === ref.id);
      if (!object || !options.prepare()) return;
      if (object.kind === 'table') void editTable(object, object);
      if (object.kind === 'video') void play(object);
    },
    handleKey(event: KeyboardEvent): boolean {
      if (event.isComposing || composing) return false;
      if (host) {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
          return true;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          finish();
          return true;
        }
        // Native editor keys and playback controls own their keyboard events.
        return true;
      }
      if (!picker.hidden && event.key === 'Escape') {
        event.preventDefault();
        closePicker(true);
        return true;
      }
      return false;
    },
  };
}
