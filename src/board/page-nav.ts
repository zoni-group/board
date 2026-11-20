import { t } from '../i18n.ts';
import {
  IconAddPage,
  IconChevronLeft,
  IconChevronRight,
  IconDuplicate,
  IconMoveEarlier,
  IconMoveLater,
  IconTrash,
} from '../icons.ts';
import { applyButtonIcon } from '../shared/tools-menu.ts';
import { constrainPopup } from './screen-layout.ts';

export interface PageNavOptions {
  nav: HTMLElement;
  go(index: number): void;
  add(): void;
  duplicate(): void;
  move(delta: -1 | 1): void;
  remove(): void;
}

type PageAction = 'add' | 'duplicate' | 'earlier' | 'later' | 'delete';
const ACTIONS: { action: PageAction; id: string; label: string; icon: string }[] = [
  { action: 'add', id: 'addPageAfter', label: 'addPage', icon: IconAddPage },
  { action: 'duplicate', id: 'duplicatePage', label: 'duplicatePage', icon: IconDuplicate },
  { action: 'earlier', id: 'movePageEarlier', label: 'movePageEarlier', icon: IconMoveEarlier },
  { action: 'later', id: 'movePageLater', label: 'movePageLater', icon: IconMoveLater },
  { action: 'delete', id: 'deletePage', label: 'deletePage', icon: IconTrash },
];

/**
 * The ‹ 2 / 5 › control. It stays hidden while a board has a single page. The page number
 * opens the Page menu: add, duplicate, move and delete the page being shown.
 */
export function createPageNav(options: PageNavOptions) {
  const { nav } = options;
  const prev = nav.querySelector<HTMLButtonElement>('#prevPage');
  const next = nav.querySelector<HTMLButtonElement>('#nextPage');
  const button = nav.querySelector<HTMLButtonElement>('#pageMenuButton');
  const live = nav.querySelector<HTMLElement>('#pageLive');
  applyButtonIcon(prev, IconChevronLeft);
  applyButtonIcon(next, IconChevronRight);
  let index = 0,
    total = 1;
  prev?.addEventListener('click', () => options.go(index - 1));
  next?.addEventListener('click', () => options.go(index + 1));

  const menu = document.createElement('div');
  menu.id = 'pageMenu';
  menu.className = 'board-menu page-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const items = new Map<PageAction, HTMLButtonElement>();
  for (const { action, id, label, icon } of ACTIONS) {
    if (action === 'delete') menu.append(document.createElement('hr'));
    const item = document.createElement('button');
    item.type = 'button';
    item.id = id;
    item.className = action === 'delete' ? 'menu-item destructive' : 'menu-item';
    item.setAttribute('role', 'menuitem');
    item.innerHTML = `<span class="btn-icon" aria-hidden="true">${icon}</span><span></span>`;
    item.lastElementChild!.setAttribute('data-i18n', label);
    item.addEventListener('click', () => {
      // Delete may open a dialog, which takes focus itself.
      close(action !== 'delete');
      run(action);
    });
    items.set(action, item);
    menu.append(item);
  }
  document.body.append(menu);

  function run(action: PageAction) {
    if (action === 'add') options.add();
    else if (action === 'duplicate') options.duplicate();
    else if (action === 'earlier') options.move(-1);
    else if (action === 'later') options.move(1);
    else options.remove();
  }
  function enabledItems() {
    return [...items.values()].filter((item) => !item.disabled);
  }
  function position() {
    if (menu.hidden || !button) return;
    const anchor = (nav.hidden ? button : nav).getBoundingClientRect();
    menu.style.left = `${anchor.left}px`;
    menu.style.top = `${anchor.top - menu.getBoundingClientRect().height - 6}px`;
    constrainPopup(menu);
  }
  function open() {
    if (!button) return;
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    position();
    enabledItems()[0]?.focus({ preventScroll: true });
  }
  function close(focus = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
    if (focus && !nav.hidden) button?.focus({ preventScroll: true });
  }
  button?.addEventListener('click', () => (menu.hidden ? open() : close()));
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden || !(event.target instanceof Node)) return;
    if (!menu.contains(event.target) && !button?.contains(event.target)) close(false);
  });
  document.addEventListener('board:layout', position);

  function labels() {
    const spoken = t('pageOf', { page: index + 1, count: total });
    if (live) live.textContent = spoken;
    if (button) {
      button.textContent = `${index + 1} / ${total}`;
      button.setAttribute('aria-label', `${spoken} · ${t('pageActions')}`);
    }
    menu.setAttribute('aria-label', t('pageActions'));
    for (const { action, label } of ACTIONS) {
      const text = items.get(action)?.lastElementChild;
      if (text) text.textContent = t(label);
    }
  }
  function sync(page = index, pages = total) {
    index = page;
    total = pages;
    nav.hidden = total <= 1;
    if (nav.hidden) close(false);
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= total - 1;
    items.get('earlier')!.disabled = index <= 0;
    items.get('later')!.disabled = index >= total - 1;
    labels();
  }
  document.addEventListener('i18n:change', labels);
  sync();

  return {
    sync,
    open,
    close,
    isOpen: () => !menu.hidden,
    /** While the Page menu is open it owns the keyboard, so board shortcuts don't fire. */
    handleKey(event: KeyboardEvent): boolean {
      if (menu.hidden) return false;
      const list = enabledItems();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      const focus = (i: number) => {
        event.preventDefault();
        list[(i + list.length) % list.length]?.focus({ preventScroll: true });
      };
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowDown') focus(at + 1);
      else if (event.key === 'ArrowUp') focus(at < 0 ? -1 : at - 1);
      else if (event.key === 'Home') focus(0);
      else if (event.key === 'End') focus(-1);
      else if (event.key === 'Tab') focus(at + (event.shiftKey ? -1 : 1));
      // Other keys (Enter, Space) act on the focused item; board shortcuts wait until it closes.
      return true;
    },
  };
}
