import { t } from '../i18n.ts';
import type { ShapeFill } from './model.ts';
import { COLOR_PRESETS, presetName } from './presets.ts';
import { constrainPopup } from './screen-layout.ts';

type Change = (fill: ShapeFill | null) => void;

/** A readable name for a fill, e.g. "Blue, light" or "None". */
export function fillName(fill: ShapeFill | null): string {
  if (!fill) return t('noFill');
  const color =
    fill.color === 'outline' ? t('fillOutline') : t(presetName(fill.color) ?? fill.color);
  return `${color}, ${t(fill.solid ? 'fillSolid' : 'fillLight').toLowerCase()}`;
}

/**
 * The small round chip that previews a fill: slashed when empty, a see-through dot for a
 * light fill, a full dot for a solid one. `outlineRaw` is used when the fill follows the outline.
 */
export function renderFillChip(chip: HTMLElement, fill: ShapeFill | null, outlineRaw: string) {
  chip.classList.add('fill-chip');
  chip.dataset.fill = !fill ? 'none' : fill.solid ? 'solid' : 'light';
  chip.style.setProperty(
    '--fill-chip-color',
    !fill ? 'transparent' : fill.color === 'outline' ? outlineRaw : fill.color
  );
}

/**
 * The fill palette shared by the Shapes picker and a selected shape: None, Outline, the
 * preset colours, a custom colour from the device's own picker, and Light or Solid.
 */
export function createFillPalette(options: { dark(): boolean }) {
  const palette = document.createElement('div');
  palette.id = 'fillPalette';
  palette.className = 'fill-palette';
  palette.setAttribute('role', 'dialog');
  palette.hidden = true;

  const none = choice('none'),
    outline = choice('outline');
  const top = document.createElement('div');
  top.className = 'fill-palette-row';
  top.append(none, outline);

  const swatches = document.createElement('div');
  swatches.className = 'fill-palette-swatches';

  const custom = document.createElement('label');
  custom.className = 'fill-palette-custom';
  const customChip = document.createElement('span');
  customChip.setAttribute('aria-hidden', 'true');
  customChip.className = 'fill-chip fill-chip-custom';
  const customText = document.createElement('span');
  const picker = document.createElement('input');
  picker.type = 'color';
  custom.append(customChip, customText, picker);

  const strength = document.createElement('div');
  strength.className = 'fill-palette-strength';
  strength.setAttribute('role', 'group');
  const light = document.createElement('button'),
    solid = document.createElement('button');
  for (const button of [light, solid]) button.type = 'button';
  strength.append(light, solid);

  palette.append(top, swatches, custom, strength);
  document.body.append(palette);

  let current: ShapeFill | null = null,
    outlineRaw = '#111827',
    onChange: Change = () => {},
    anchor: HTMLElement | null = null;

  function choice(kind: 'none' | 'outline') {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.fill = kind;
    const chip = document.createElement('span');
    chip.setAttribute('aria-hidden', 'true');
    button.append(chip, document.createElement('span'));
    return button;
  }
  function apply(next: ShapeFill | null, keepOpen = false) {
    current = next;
    onChange(next);
    if (keepOpen) sync();
    else close();
  }
  function pick(color: string) {
    apply(current?.solid ? { color, solid: true } : { color });
  }
  function sync() {
    renderFillChip(none.firstElementChild as HTMLElement, null, outlineRaw);
    renderFillChip(outline.firstElementChild as HTMLElement, { color: 'outline' }, outlineRaw);
    none.setAttribute('aria-pressed', String(!current));
    outline.setAttribute('aria-pressed', String(current?.color === 'outline'));
    swatches.innerHTML = '';
    const dark = options.dark();
    for (const preset of COLOR_PRESETS) {
      const hex = dark ? preset.dark : preset.light;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.hex = hex;
      button.style.background = hex;
      button.setAttribute('aria-label', t(preset.id));
      button.title = t(preset.id);
      button.setAttribute(
        'aria-pressed',
        String(current?.color === preset.light || current?.color === preset.dark)
      );
      button.addEventListener('click', () => pick(hex));
      swatches.append(button);
    }
    const isCustom = Boolean(current && current.color !== 'outline' && !presetName(current.color));
    custom.classList.toggle('is-active', isCustom);
    customChip.style.setProperty('--fill-chip-color', isCustom ? current!.color : 'transparent');
    if (current && current.color !== 'outline') picker.value = current.color;
    light.disabled = solid.disabled = !current;
    light.setAttribute('aria-pressed', String(Boolean(current && !current.solid)));
    solid.setAttribute('aria-pressed', String(Boolean(current?.solid)));
    labels();
  }
  function labels() {
    palette.setAttribute('aria-label', t('fill'));
    none.lastElementChild!.textContent = t('noFill');
    outline.lastElementChild!.textContent = t('fillOutline');
    customText.textContent = t('customColor');
    picker.setAttribute('aria-label', t('customColor'));
    strength.setAttribute('aria-label', t('fillStrength'));
    light.textContent = t('fillLight');
    solid.textContent = t('fillSolid');
  }
  function position() {
    if (palette.hidden || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    palette.style.left = `${rect.left}px`;
    palette.style.top = `${rect.bottom + 4}px`;
    constrainPopup(palette);
  }
  function close(focus = false) {
    if (palette.hidden) return;
    palette.hidden = true;
    anchor?.setAttribute('aria-expanded', 'false');
    if (focus) anchor?.focus({ preventScroll: true });
    anchor = null;
  }

  none.addEventListener('click', () => apply(null));
  outline.addEventListener('click', () =>
    apply(current?.solid ? { color: 'outline', solid: true } : { color: 'outline' })
  );
  picker.addEventListener('change', () => pick(picker.value.toLowerCase()));
  light.addEventListener('click', () => current && apply({ color: current.color }, true));
  solid.addEventListener(
    'click',
    () => current && apply({ color: current.color, solid: true }, true)
  );
  palette.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  });
  document.addEventListener('pointerdown', (event) => {
    if (palette.hidden) return;
    const path = event.composedPath();
    if (!path.includes(palette) && !(anchor && path.includes(anchor))) close();
  });
  document.addEventListener('board:layout', position);
  document.addEventListener('i18n:change', () => {
    if (!palette.hidden) sync();
  });

  return {
    /** Opens under `button`, or closes when it is already open there. */
    toggle(button: HTMLElement, fill: ShapeFill | null, outlineColor: string, change: Change) {
      if (!palette.hidden && anchor === button) {
        close(true);
        return;
      }
      close();
      anchor = button;
      current = fill;
      outlineRaw = outlineColor;
      onChange = change;
      sync();
      palette.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      position();
      palette
        .querySelector<HTMLButtonElement>('[aria-pressed="true"]:not(:disabled)')
        ?.focus({ preventScroll: true });
    },
    close,
    isOpen: () => !palette.hidden,
    position,
  };
}

export type FillPalette = ReturnType<typeof createFillPalette>;
