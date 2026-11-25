import { t } from '../i18n.ts';
import { IconBringForward, IconBringToFront, IconSendBackward, IconSendToBack } from '../icons.ts';
import { constrainPopup } from './screen-layout.ts';
import type { OrderAction } from './stacking.ts';

const ACTIONS: { action: OrderAction; label: string; icon: string }[] = [
  { action: 'front', label: 'bringToFront', icon: IconBringToFront },
  { action: 'forward', label: 'bringForward', icon: IconBringForward },
  { action: 'backward', label: 'sendBackward', icon: IconSendBackward },
  { action: 'back', label: 'sendToBack', icon: IconSendToBack },
];

/**
 * The Order menu of a selection: Bring to front, Bring forward, Send backward, Send to back.
 * It opens under the Order button; items that would change nothing are disabled.
 */
export function createOrderMenu() {
  const menu = document.createElement('div');
  menu.id = 'orderMenu';
  menu.className = 'board-menu order-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  let anchor: HTMLElement | null = null,
    choose: (action: OrderAction) => void = () => {};
  const items = ACTIONS.map(({ action, icon }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.dataset.order = action;
    item.setAttribute('role', 'menuitem');
    item.innerHTML = `<span class="btn-icon" aria-hidden="true">${icon}</span><span></span>`;
    item.addEventListener('click', () => {
      close(true);
      choose(action);
    });
    menu.append(item);
    return item;
  });
  document.body.append(menu);

  function labels() {
    menu.setAttribute('aria-label', t('order'));
    ACTIONS.forEach(({ label }, i) => (items[i].lastElementChild!.textContent = t(label)));
  }
  function enabled() {
    return items.filter((item) => !item.disabled);
  }
  function position() {
    if (menu.hidden || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    constrainPopup(menu);
  }
  function close(focus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    anchor?.setAttribute('aria-expanded', 'false');
    if (focus) anchor?.focus({ preventScroll: true });
    anchor = null;
  }

  menu.addEventListener('keydown', (event) => {
    const list = enabled();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => {
      event.preventDefault();
      list[(i + list.length) % list.length]?.focus({ preventScroll: true });
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown') focus(at + 1);
    else if (event.key === 'ArrowUp') focus(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(-1);
  });
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return;
    const path = event.composedPath();
    if (!path.includes(menu) && !(anchor && path.includes(anchor))) close();
  });
  document.addEventListener('board:layout', position);
  document.addEventListener('i18n:change', labels);
  labels();

  return {
    /**
     * Opens under `button`, or closes when already open there. `can` tells which actions would
     * change the stack; `run` applies the one chosen.
     */
    toggle(button: HTMLElement, can: (action: OrderAction) => boolean, run: typeof choose) {
      if (!menu.hidden && anchor === button) {
        close(true);
        return;
      }
      close();
      anchor = button;
      choose = run;
      ACTIONS.forEach(({ action }, i) => (items[i].disabled = !can(action)));
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      position();
      (enabled()[0] ?? items[0]).focus({ preventScroll: true });
    },
    close,
    isOpen: () => !menu.hidden,
  };
}

export type OrderMenu = ReturnType<typeof createOrderMenu>;
