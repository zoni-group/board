import { t } from '../i18n.ts';
import { PenIcons } from '../icons.ts';
import { applyButtonIcon } from '../shared/tools-menu.ts';
import type { PenKind } from './model.ts';
import { constrainPopup } from './screen-layout.ts';

interface PenPickerOptions {
  button: HTMLButtonElement;
  kind: PenKind;
  choose(kind: PenKind): void;
  /** Where focus returns after the picker closes. */
  focusTarget: HTMLElement;
}

export const PEN_KINDS = Object.keys(PenIcons) as PenKind[];

export function isPenKind(value: unknown): value is PenKind {
  return typeof value === 'string' && (PEN_KINDS as string[]).includes(value);
}

/** The Pen button's type menu, in the same style as the Shapes menu. */
export function createPenPicker(options: PenPickerOptions) {
  const { button } = options;
  let kind = options.kind;
  const picker = document.createElement('div');
  picker.id = 'penPicker';
  picker.className = 'shape-picker pen-picker';
  picker.setAttribute('role', 'dialog');
  picker.hidden = true;
  button.setAttribute('aria-controls', picker.id);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const choices = PEN_KINDS.map((value) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.dataset.pen = value;
    choice.innerHTML = `<span class="btn-icon" aria-hidden="true">${PenIcons[value]}</span><span></span>`;
    choice.addEventListener('click', () => {
      close();
      options.choose(value);
    });
    picker.append(choice);
    return choice;
  });
  document.body.append(picker);

  function labels() {
    picker.setAttribute('aria-label', t('penTypes'));
    applyButtonIcon(button, PenIcons[kind]);
    // The button is named after the current type; its menu offers the others.
    button.title = `${t(kind)} · ${t('penTypes')}`;
    button.setAttribute('aria-label', t(kind));
    choices.forEach((choice) => {
      const value = choice.dataset.pen as PenKind;
      choice.lastElementChild!.textContent = t(value);
      choice.setAttribute('aria-pressed', String(kind === value));
    });
  }
  function position() {
    if (picker.hidden) return;
    const anchor = button.getBoundingClientRect();
    picker.style.left = `${anchor.left}px`;
    picker.style.top = `${anchor.bottom + 4}px`;
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
    choices.find((choice) => choice.dataset.pen === kind)?.focus({ preventScroll: true });
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
    setKind(next: PenKind) {
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
