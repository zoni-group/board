import { t } from '../i18n.ts';
import { applyButtonIcon } from '../shared/tools-menu.ts';
import { constrainPopup } from './screen-layout.ts';

interface TypePickerOptions<K extends string> {
  /** Element id of the menu, e.g. `penPicker`. */
  id: string;
  button: HTMLButtonElement;
  icons: Record<K, string>;
  kind: K;
  /** Translation key naming the menu. */
  menuLabel: string;
  /** Text for a menu entry. */
  label(kind: K): string;
  /** Accessible name of the button for the current kind. */
  buttonLabel(kind: K): string;
  choose(kind: K): void;
  /** Where focus returns after the menu closes. */
  focusTarget: HTMLElement;
  /** Open under the button (top toolbar) or over it (bottom navigation strip). */
  placement: 'below' | 'above';
}

export function isKind<K extends string>(kinds: readonly K[], value: unknown): value is K {
  return typeof value === 'string' && (kinds as readonly string[]).includes(value);
}

/**
 * A tool button's type menu (Pen types, Select modes), in the same style as the Shapes menu.
 * The tool decides when to open it; tapping an entry chooses it and closes the menu.
 */
export function createTypePicker<K extends string>(options: TypePickerOptions<K>) {
  const { button } = options;
  const kinds = Object.keys(options.icons) as K[];
  let kind = options.kind;
  const picker = document.createElement('div');
  picker.id = options.id;
  picker.className = `shape-picker type-picker`;
  picker.setAttribute('role', 'dialog');
  picker.hidden = true;
  button.setAttribute('aria-controls', picker.id);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const choices = kinds.map((value) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.dataset.kind = value;
    choice.innerHTML = `<span class="btn-icon" aria-hidden="true">${options.icons[value]}</span><span></span>`;
    choice.addEventListener('click', () => {
      close();
      options.choose(value);
    });
    picker.append(choice);
    return choice;
  });
  document.body.append(picker);

  function labels() {
    picker.setAttribute('aria-label', t(options.menuLabel));
    applyButtonIcon(button, options.icons[kind]);
    // The button is named after the current type; its menu offers the others.
    button.setAttribute('aria-label', options.buttonLabel(kind));
    button.title = `${options.label(kind)} · ${t(options.menuLabel)}`;
    choices.forEach((choice) => {
      const value = choice.dataset.kind as K;
      choice.lastElementChild!.textContent = options.label(value);
      choice.setAttribute('aria-pressed', String(kind === value));
    });
  }
  function position() {
    if (picker.hidden) return;
    const anchor = button.getBoundingClientRect();
    picker.style.left = `${anchor.left}px`;
    picker.style.top =
      options.placement === 'below'
        ? `${anchor.bottom + 4}px`
        : `${anchor.top - picker.getBoundingClientRect().height - 4}px`;
    constrainPopup(picker);
  }
  function close(focus = true) {
    if (picker.hidden) return;
    picker.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) options.focusTarget.focus({ preventScroll: true });
  }
  function open() {
    picker.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    position();
    choices.find((choice) => choice.dataset.kind === kind)?.focus({ preventScroll: true });
  }

  document.addEventListener('pointerdown', (event) => {
    const path = event.composedPath();
    if (!picker.hidden && !path.includes(picker) && !path.includes(button)) close(false);
  });
  document.addEventListener('board:layout', position);
  document.addEventListener('i18n:change', () => {
    labels();
    position();
  });
  labels();

  return {
    close,
    toggle() {
      if (picker.hidden) open();
      else close();
    },
    isOpen: () => !picker.hidden,
    kind: () => kind,
    setKind(next: K) {
      kind = next;
      labels();
    },
    handleKey(event: KeyboardEvent): boolean {
      if (picker.hidden || event.key !== 'Escape') return false;
      event.preventDefault();
      close();
      return true;
    },
  };
}
