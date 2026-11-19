import { getLang, t } from '../i18n.ts';
import { PatternIcons } from '../icons.ts';
import {
  BACKGROUND_COLORS,
  BACKGROUND_PATTERNS,
  BACKGROUND_SPACINGS,
  PAPER_COLORS,
} from './background.ts';
import type {
  BackgroundColor,
  BackgroundPattern,
  BackgroundSpacing,
  BoardBackground,
} from './background.ts';
import { listBoards } from './storage.ts';
import { THEME_CHOICES } from './theme.ts';
import type { ThemeChoice } from './theme.ts';

export interface SettingsOptions {
  name(): string;
  rename(name: string): Promise<void>;
  background(): BoardBackground;
  setBackground(next: BoardBackground): void;
  theme(): ThemeChoice;
  setTheme(choice: ThemeChoice): void;
}

const PATTERN_LABELS: Record<BackgroundPattern, string> = {
  blank: 'patternBlank',
  grid: 'patternGrid',
  lined: 'patternLined',
  dotted: 'patternDotted',
};
const SPACING_LABELS: Record<BackgroundSpacing, string> = {
  small: 'spacingSmall',
  medium: 'spacingMedium',
  large: 'spacingLarge',
};
const COLOR_LABELS: Record<BackgroundColor, string> = {
  auto: 'colorAuto',
  white: 'colorWhite',
  cream: 'colorCream',
  green: 'colorGreen',
  black: 'colorBlack',
};
const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  i18n?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (i18n) {
    node.dataset.i18n = i18n;
    node.textContent = t(i18n);
  }
  return node;
}

/** Formats bytes for the storage line, e.g. "12.4 MB" or "2.1 GB", in the current language. */
export function formatBytes(bytes: number, lang = getLang()): string {
  const units: [string, number][] = [
    ['gigabyte', 1e9],
    ['megabyte', 1e6],
    ['kilobyte', 1e3],
  ];
  const [unit, size] = units.find(([, size]) => bytes >= size) ?? ['kilobyte', 1e3];
  return new Intl.NumberFormat(lang, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: bytes / size < 10 ? 1 : 0,
  }).format(bytes / size);
}

/** Choice buttons with `aria-pressed`; one is pressed at a time. */
function choiceGroup<K extends string>(
  labelKey: string,
  values: readonly K[],
  labels: Record<K, string>,
  current: () => K,
  choose: (value: K) => void,
  decorate?: (button: HTMLButtonElement, value: K) => void
) {
  const group = element('div', 'settings-choices');
  group.setAttribute('role', 'group');
  group.dataset.i18nAria = labelKey;
  group.setAttribute('aria-label', t(labelKey));
  const buttons = values.map((value) => {
    const button = element('button', 'settings-choice');
    button.type = 'button';
    button.dataset.value = value;
    const text = element('span', '', labels[value]);
    if (decorate) decorate(button, value);
    button.append(text);
    button.addEventListener('click', () => {
      choose(value);
      sync();
    });
    group.append(button);
    return button;
  });
  function sync() {
    const selected = current();
    for (const button of buttons)
      button.setAttribute('aria-pressed', String(button.dataset.value === selected));
  }
  sync();
  return { group, buttons, sync };
}

function field(labelKey: string, control: HTMLElement) {
  const row = element('div', 'settings-field');
  const label = element('span', 'settings-label', labelKey);
  row.append(label, control);
  return row;
}

function section(titleKey: string, ...children: HTMLElement[]) {
  const node = element('section', 'settings-section');
  node.append(element('h3', '', titleKey), ...children);
  return node;
}

async function fillStorage(target: HTMLElement) {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.estimate) {
    target.replaceChildren(element('p', 'settings-note', 'storageDetailsUnavailable'));
    return;
  }
  const [estimate, boards, persisted] = await Promise.all([
    storage.estimate().catch(() => null),
    listBoards().catch(() => null),
    storage.persisted ? storage.persisted().catch(() => false) : Promise.resolve(false),
  ]);
  if (!target.isConnected) return;
  const nodes: HTMLElement[] = [];
  if (estimate && estimate.quota) {
    const used = estimate.usage ?? 0;
    const usage = element('p', 'settings-usage');
    usage.textContent = t('storageUsage', {
      used: formatBytes(used),
      quota: formatBytes(estimate.quota),
    });
    const meter = element('meter', 'settings-meter');
    meter.min = 0;
    meter.max = estimate.quota;
    meter.value = used;
    meter.high = estimate.quota * 0.8;
    meter.setAttribute('aria-label', usage.textContent);
    nodes.push(usage, meter);
  } else nodes.push(element('p', 'settings-note', 'storageDetailsUnavailable'));
  if (boards) {
    const count = element('p', 'settings-note');
    count.textContent =
      boards.length === 1 ? t('storageBoardsOne') : t('storageBoards', { count: boards.length });
    nodes.push(count);
  }
  const keep = element('div', 'settings-persist');
  if (persisted) keep.append(element('p', 'settings-note settings-ok', 'storagePersisted'));
  else if (storage.persist) {
    const request = element('button', 'settings-action', 'storagePersist');
    request.type = 'button';
    request.id = 'persistStorage';
    request.addEventListener('click', () => {
      request.disabled = true;
      void storage
        .persist()
        .catch(() => false)
        .then((granted) => {
          keep.replaceChildren(
            element(
              'p',
              granted ? 'settings-note settings-ok' : 'settings-note',
              granted ? 'storagePersisted' : 'storagePersistDenied'
            )
          );
        });
    });
    keep.append(element('p', 'settings-note', 'storagePersistHint'), request);
  }
  nodes.push(keep);
  target.replaceChildren(...nodes);
}

/**
 * Fills the Settings panel. Every change applies at once; the board name is saved on Enter,
 * on blur and when the panel closes (`commit`).
 */
export function renderSettings(body: HTMLElement, options: SettingsOptions) {
  body.classList.add('settings-body');

  const name = element('input', 'settings-input');
  name.type = 'text';
  name.id = 'settingsBoardName';
  name.maxLength = 100;
  name.value = options.name();
  name.dataset.i18nAria = 'boardName';
  name.setAttribute('aria-label', t('boardName'));
  name.autocomplete = 'off';
  let saving: Promise<void> | null = null;
  async function commit() {
    const value = name.value.trim();
    if (!value || value === options.name()) {
      name.value = options.name();
      return;
    }
    saving ??= options.rename(value).finally(() => {
      saving = null;
      name.value = options.name();
    });
    await saving;
  }
  name.addEventListener('keydown', (event) => {
    if (event.isComposing || event.key !== 'Enter') return;
    event.preventDefault();
    void commit();
  });
  name.addEventListener('blur', () => void commit());

  const update = (patch: Partial<BoardBackground>) =>
    options.setBackground({ ...options.background(), ...patch });
  const pattern = choiceGroup(
    'pattern',
    BACKGROUND_PATTERNS,
    PATTERN_LABELS,
    () => options.background().pattern,
    (value) => {
      update({ pattern: value });
      syncSpacing();
    },
    (button, value) => {
      const icon = element('span', 'settings-choice-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = PatternIcons[value];
      button.append(icon);
    }
  );
  pattern.group.classList.add('settings-patterns');
  const spacing = choiceGroup(
    'spacing',
    BACKGROUND_SPACINGS,
    SPACING_LABELS,
    () => options.background().spacing,
    (value) => update({ spacing: value })
  );
  function syncSpacing() {
    const blank = options.background().pattern === 'blank';
    spacing.buttons.forEach((button) => (button.disabled = blank));
  }
  syncSpacing();
  const colors = choiceGroup(
    'paperColor',
    BACKGROUND_COLORS,
    COLOR_LABELS,
    () => options.background().color,
    (value) => update({ color: value }),
    (button, value) => {
      const swatch = element('span', `settings-swatch settings-swatch-${value}`);
      swatch.setAttribute('aria-hidden', 'true');
      if (value !== 'auto') swatch.style.background = PAPER_COLORS[value];
      button.append(swatch);
      button.dataset.i18nTitle = COLOR_LABELS[value];
      button.title = t(COLOR_LABELS[value]);
    }
  );
  colors.group.classList.add('settings-swatches');
  const theme = choiceGroup('theme', THEME_CHOICES, THEME_LABELS, options.theme, options.setTheme);

  const storage = element('div', 'settings-storage');
  storage.setAttribute('aria-live', 'polite');
  void fillStorage(storage);

  body.replaceChildren(
    section('boardLabel', field('boardName', name)),
    section(
      'pageSection',
      field('pattern', pattern.group),
      field('spacing', spacing.group),
      field('paperColor', colors.group)
    ),
    section('appearanceSection', field('theme', theme.group)),
    section('storageSection', storage)
  );
  return {
    commit,
    focus() {
      name.focus({ preventScroll: true });
    },
  };
}
