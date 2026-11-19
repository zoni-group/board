import { t } from '../i18n.ts';
import { IconRename, IconTrash } from '../icons.ts';
import type { BoardBackground } from './background.ts';
import { renderSettings } from './settings-panel.ts';
import type { ThemeChoice } from './theme.ts';
import { constrainPopup, panelArea } from './screen-layout.ts';
import {
  createBoard,
  deleteBoard,
  getBoardLibrary,
  listBoards,
  loadBoardDrawing,
  renameBoard,
  setActiveBoard,
} from './storage.ts';
import type { BoardDocument, BoardSummary } from './storage.ts';

interface Options {
  button: HTMLButtonElement;
  menu: HTMLElement;
  current(): BoardDocument;
  prepare(requireSave: boolean): Promise<boolean>;
  activate(board: BoardDocument): Promise<void>;
  renamed(name: string): void;
  beforeMenu(): boolean;
  status(message: string): void;
  background(): BoardBackground;
  setBackground(next: BoardBackground): void;
  theme(): ThemeChoice;
  setTheme(choice: ThemeChoice): void;
}
export function boardFileName(name: string, extension: string): string {
  return `${
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\p{Cc}/gu, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 100) || 'Board'
  }.${extension}`;
}
export function createBoardMenu(options: Options) {
  const { button, menu } = options;
  let panel: HTMLElement | null = null,
    beforeDismiss: (() => Promise<void>) | null = null,
    working = false,
    controller: AbortController | null = null;
  let filesModule: Promise<typeof import('./board-files.ts')> | undefined;
  const files = () =>
    (filesModule ??= import('./board-files.ts').catch((error) => {
      filesModule = undefined;
      throw error;
    }));
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zoniboard';
  input.hidden = true;
  document.body.append(input);
  button.setAttribute('aria-controls', menu.id);
  function closeMenu(focus = false) {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({ preventScroll: true });
  }
  function position() {
    if (!menu.hidden) {
      const r = button.getBoundingClientRect();
      menu.style.left = `${r.left}px`;
      menu.style.top = `${r.bottom + 4}px`;
      constrainPopup(menu);
    }
    if (panel) {
      const a = panelArea(),
        width = Math.min(panel.classList.contains('board-settings-panel') ? 460 : 620, a.width);
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${a.height}px`;
      panel.style.left = `${a.left + (a.width - width) / 2}px`;
      panel.style.top = `${a.top + Math.max(0, (a.height - panel.getBoundingClientRect().height) / 2)}px`;
    }
  }
  function dismiss() {
    if (working) {
      controller?.abort();
      return;
    }
    void beforeDismiss?.();
    beforeDismiss = null;
    panel?.remove();
    panel = null;
    closeMenu();
    button.focus({ preventScroll: true });
  }
  function control(key: string, run: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.i18n = key;
    b.textContent = t(key);
    b.addEventListener('click', run);
    return b;
  }
  /** A small icon button named by its tooltip and accessible label. */
  function iconControl(key: string, icon: string, run: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-control';
    b.dataset.i18nAria = key;
    b.setAttribute('aria-label', t(key));
    b.title = t(key);
    b.innerHTML = `<span class="btn-icon" aria-hidden="true">${icon}</span>`;
    b.addEventListener('click', run);
    return b;
  }
  function createPanel(key: string) {
    beforeDismiss = null;
    panel?.remove();
    closeMenu();
    panel = document.createElement('section');
    panel.className = 'board-content-panel board-library-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'boardPanelTitle');
    const heading = document.createElement('h2');
    heading.id = 'boardPanelTitle';
    heading.dataset.i18n = key;
    heading.textContent = t(key);
    const body = document.createElement('div');
    body.className = 'board-content-body';
    const actions = document.createElement('div');
    actions.className = 'content-panel-actions';
    actions.append(control('cancelText', dismiss));
    panel.append(heading, body, actions);
    document.body.append(panel);
    position();
    return { body, actions };
  }
  function errorMessage(error: unknown) {
    const code = error instanceof Error ? error.message : '';
    return t(
      [
        'boardConflict',
        'boardDeleted',
        'invalidBoardName',
        'invalidArchive',
        'unsupportedArchive',
        'archiveMissingMedia',
        'archiveTooLarge',
        'storageUnavailable',
        'invalidLibrary',
        'invalidBoard',
      ].includes(code)
        ? code
        : 'boardOperationFailed'
    );
  }
  async function run(operation: () => Promise<void>) {
    if (working) return;
    working = true;
    button.disabled = true;
    try {
      await operation();
    } catch (error) {
      if (!controller?.signal.aborted) options.status(errorMessage(error));
    } finally {
      working = false;
      button.disabled = false;
      controller = null;
      position();
    }
  }
  async function newBoard() {
    await run(async () => {
      if (!(await options.prepare(true))) return;
      const board = await createBoard(undefined, t('boardDefaultName'));
      dismissPanel();
      await options.activate(board);
      labels();
    });
  }
  function dismissPanel() {
    beforeDismiss = null;
    panel?.remove();
    panel = null;
    closeMenu();
  }
  async function openBoard(id: string) {
    await run(async () => {
      if (!(await options.prepare(true))) return;
      const board = await loadBoardDrawing(id);
      await setActiveBoard(id);
      dismissPanel();
      await options.activate(board);
      labels();
    });
  }
  function confirmDelete(board: BoardSummary) {
    if (working) return;
    const { body, actions } = createPanel('deleteBoard');
    const text = document.createElement('p');
    text.textContent = t('deleteBoardQuestion', { name: board.name });
    body.append(text);
    const remove = control('deleteBoard', () => {
      let refresh = false;
      void run(async () => {
        // Deletion must remain available to free storage while current edits are unsaved.
        if (!(await options.prepare(false))) return;
        const next = await deleteBoard(board.id, t('boardDefaultName'));
        if (board.id === options.current().id) {
          dismissPanel();
          await options.activate(next);
          labels();
        } else {
          dismissPanel();
          refresh = true;
        }
        options.status(t('boardDeletedStatus'));
      }).then(() => {
        if (refresh) void showLibrary();
      });
    });
    remove.className = 'destructive';
    actions.prepend(remove);
    position();
    if (actions.lastElementChild instanceof HTMLElement)
      actions.lastElementChild.focus({ preventScroll: true });
  }
  async function showLibrary() {
    if (working) return;
    const { body, actions } = createPanel('openBoards');
    actions.prepend(
      control('newBoard', () => {
        void newBoard();
      })
    );
    try {
      const boards = await listBoards();
      if (!body.isConnected) return;
      const list = document.createElement('div');
      list.className = 'board-list';
      for (const board of boards) {
        const row = document.createElement('div');
        row.className = 'board-list-row';
        row.dataset.boardId = board.id;
        const open = control('', () => {
          void openBoard(board.id);
        });
        delete open.dataset.i18n;
        open.className = 'board-list-open';
        open.textContent = board.name;
        open.title = board.name;
        if (board.id === options.current().id) {
          open.setAttribute('aria-current', 'true');
          open.title = `${board.name} · ${t('currentBoard')}`;
          row.classList.add('is-current');
        }
        const info = document.createElement('small');
        info.textContent = new Date(board.updatedAtMs).toLocaleString(
          document.documentElement.lang
        );
        if (board.id === options.current().id) {
          const badge = document.createElement('span');
          badge.className = 'board-list-badge';
          badge.dataset.i18n = 'currentBadge';
          badge.textContent = t('currentBadge');
          info.append(' · ', badge);
        }
        const name = document.createElement('div');
        name.className = 'board-list-name';
        name.append(open, info);
        const rename = iconControl('renameBoard', IconRename, () => {
          if (working || row.querySelector('input')) return;
          const field = document.createElement('input');
          field.type = 'text';
          field.value = board.name;
          field.maxLength = 100;
          field.setAttribute('aria-label', t('boardName'));
          const save = control('doneText', () => {
            void submit();
          });
          const cancel = control('cancelText', () => {
            name.replaceChildren(open, info);
            rename.hidden = false;
            save.remove();
            cancel.remove();
          });
          async function submit() {
            await run(async () => {
              const updated = await renameBoard(board.id, field.value);
              board.name = updated.name;
              open.textContent = updated.name;
              open.title = updated.name;
              if (board.id === options.current().id) options.renamed(updated.name);
              name.replaceChildren(open, info);
              rename.hidden = false;
              save.remove();
              cancel.remove();
              labels();
            });
          }
          field.addEventListener('keydown', (event) => {
            if (event.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancel.click();
            }
          });
          name.replaceChildren(field);
          rename.hidden = true;
          row.append(save, cancel);
          field.focus({ preventScroll: true });
          field.select();
          position();
        });
        const remove = iconControl('deleteBoard', IconTrash, () => confirmDelete(board));
        remove.classList.add('destructive');
        row.append(name, rename, remove);
        list.append(row);
      }
      body.replaceChildren(list);
      position();
      list.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true });
    } catch (error) {
      if (body.isConnected) {
        body.textContent = errorMessage(error);
        position();
      }
    }
  }
  async function renameCurrent(value: string) {
    try {
      const updated = await renameBoard(options.current().id, value);
      options.renamed(updated.name);
      labels();
    } catch (error) {
      options.status(errorMessage(error));
    }
  }
  function showSettings() {
    if (working) return;
    const { body, actions } = createPanel('settings');
    panel!.classList.add('board-settings-panel');
    const settings = renderSettings(body, {
      name: () => options.current().name,
      rename: renameCurrent,
      background: options.background,
      setBackground: options.setBackground,
      theme: options.theme,
      setTheme: options.setTheme,
    });
    beforeDismiss = settings.commit;
    const done = control('doneText', dismiss);
    done.className = 'primary';
    actions.replaceChildren(done);
    position();
    settings.focus();
  }
  function transferPanel(key: string) {
    const { body, actions } = createPanel(key);
    controller = new AbortController();
    const progress = document.createElement('progress');
    progress.max = 1;
    progress.value = 0;
    progress.setAttribute('aria-label', t(key));
    body.append(progress);
    actions.replaceChildren(control('cancelText', () => controller?.abort()));
    const signal = controller.signal;
    return {
      signal,
      progress: (done: number, total: number) => {
        progress.max = Math.max(1, total);
        progress.value = done;
      },
    };
  }
  async function exportFile(all: boolean) {
    await run(async () => {
      if (!(await options.prepare(false))) return;
      const transfer = transferPanel(all ? 'exportAllBoards' : 'exportBoard'),
        current = options.current();
      try {
        const library = all ? await getBoardLibrary() : null;
        const boards = library
          ? await Promise.all(
              library.boards.map((b) =>
                b.id === current.id ? Promise.resolve(current) : loadBoardDrawing(b.id)
              )
            )
          : [current];
        const blob = await (await files()).exportBoards(boards, current.id, transfer);
        if (transfer.signal.aborted) return;
        const url = URL.createObjectURL(blob),
          a = document.createElement('a');
        a.href = url;
        a.download = all
          ? `zoni-boards-${new Date().toISOString().slice(0, 10)}.zoniboard`
          : boardFileName(current.name, 'zoniboard');
        a.rel = 'noopener';
        document.body.append(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        options.status(t('boardsExported'));
      } finally {
        dismissPanel();
      }
    });
  }
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void run(async () => {
      if (!(await options.prepare(true))) return;
      const transfer = transferPanel('importBoards');
      try {
        const board = await (await files()).importBoards(file, transfer);
        dismissPanel();
        await options.activate(board);
        labels();
        options.status(t('boardsImported'));
      } finally {
        dismissPanel();
      }
    });
  });
  function labels() {
    const current = options.current();
    button.dataset.boardId = current.id;
    const name = menu.querySelector<HTMLElement>('[data-board-name]');
    if (name) name.textContent = current.name;
    const displayed = document.getElementById('boardName');
    if (displayed) {
      displayed.textContent = current.name;
      displayed.title = current.name;
    }
    button.title = `${t('boards')} · ${current.name}`;
    button.setAttribute('aria-label', button.title);
    for (const root of [menu, panel]) {
      root
        ?.querySelectorAll<HTMLElement>('[data-i18n]')
        .forEach((element) => (element.textContent = t(element.dataset.i18n!)));
      root?.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((element) => {
        element.setAttribute('aria-label', t(element.dataset.i18nAria!));
        if (element.classList.contains('icon-control'))
          element.title = t(element.dataset.i18nAria!);
      });
      root
        ?.querySelectorAll<HTMLElement>('[data-i18n-title]')
        .forEach((element) => (element.title = t(element.dataset.i18nTitle!)));
    }
    position();
  }
  menu.querySelector('#newBoard')?.addEventListener('click', () => {
    void newBoard();
  });
  menu.querySelector('#openBoards')?.addEventListener('click', () => {
    closeMenu();
    void showLibrary();
  });
  menu.querySelector('#exportBoard')?.addEventListener('click', () => {
    void exportFile(false);
  });
  menu.querySelector('#exportAllBoards')?.addEventListener('click', () => {
    void exportFile(true);
  });
  menu.querySelector('#boardSettings')?.addEventListener('click', () => {
    closeMenu();
    showSettings();
  });
  menu.querySelector('#importBoards')?.addEventListener('click', () => {
    closeMenu();
    input.click();
  });
  for (const id of ['save', 'clear'])
    menu.querySelector(`#${id}`)?.addEventListener('click', () => closeMenu());
  button.addEventListener('click', () => {
    if (working) return;
    if (!menu.hidden) {
      closeMenu(true);
      return;
    }
    if (!options.beforeMenu()) return;
    panel?.remove();
    panel = null;
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    labels();
    menu.querySelector('button')?.focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', (event) => {
    if (
      !menu.hidden &&
      !event.composedPath().includes(menu) &&
      !event.composedPath().includes(button)
    )
      closeMenu();
  });
  /** Tab stays inside the open panel or menu. */
  function trapFocus(event: KeyboardEvent, root: HTMLElement) {
    const items = [
      ...root.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'),
    ].filter((item) => !(item as HTMLButtonElement).disabled && item.offsetParent !== null);
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }
  /** Up/Down/Home/End move between Board menu items. */
  function moveMenuFocus(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button')].filter(
      (item) => !item.disabled
    );
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }
  document.addEventListener('board:layout', position);
  document.addEventListener('i18n:change', labels);
  labels();
  return {
    labels,
    dismiss,
    closeMenu,
    isBusy: () => working || Boolean(panel),
    isWorking: () => working,
    isOpen: () => !menu.hidden || Boolean(panel),
    handleKey(event: KeyboardEvent) {
      if (!menu.hidden || panel) {
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          dismiss();
        } else if (event.key === 'Tab') trapFocus(event, panel ?? menu);
        else if (!panel) moveMenuFocus(event);
        return true;
      }
      return false;
    },
  };
}
