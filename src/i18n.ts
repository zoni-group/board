import { loadText, saveText } from './shared/storage.ts';

/**
 * VatioBoard i18n - Minimal internationalization
 * Supports: English (en), Spanish (es)
 */

export type Language = 'en' | 'es';

const english = {
  text: 'Text',
  moveText: 'Move',
  editText: 'Edit',
  deleteText: 'Delete',
  doneText: 'Done',
  cancelText: 'Cancel',
  selectedText: 'Selected text. Use arrow keys to move; Enter to edit.',
  loadingText: 'Loading text editor…',
  editingText: 'Editing text · Ctrl/⌘+Enter to finish',
  textSaveFailed: 'Could not save text on this device. Keep this page open to retry.',
  textLoadFailed: 'Could not open the text editor. Select Text to retry.',

  // UI Controls
  pen: 'Pen',
  eraser: 'Eraser',
  undo: 'Undo',
  redo: 'Redo',
  size: 'Size',
  color: 'Color',
  hex: 'Hex',
  close: 'Close',
  clear: 'Clear',
  savePng: 'Save PNG',

  // Aria labels
  presetColors: 'Preset colors',
  moreColors: 'More colors',
  changeLanguage: 'Change language',

  // Color names
  graphite: 'Graphite',
  slate: 'Slate',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  rose: 'Rose',

  // Status messages
  ready: 'Ready',
  draftUpdated: 'Draft updated',
  cleared: 'Cleared',
  colorUpdated: 'Color updated',
  themeUpdated: 'Theme updated',
  preparingPng: 'Preparing PNG...',
  savePngFailed: 'Could not prepare the PNG',
  downloadedPng: 'Downloaded PNG',

  // File
  drawingFilename: 'drawing.png',

  // Header/Brand
  brand: 'ZONI® Board',
  tagline: 'Simple local drawing board by ZONI',
  localOnly: 'Saved on this device only',
};

export type TranslationKey = keyof typeof english;
type TranslationDictionary = Record<TranslationKey, string>;

function isTranslationKey(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(english, key);
}

const translations = {
  en: english,
  es: {
    text: 'Texto',
    moveText: 'Mover',
    editText: 'Editar',
    deleteText: 'Eliminar',
    doneText: 'Listo',
    cancelText: 'Cancelar',
    selectedText: 'Texto seleccionado. Usa las flechas para mover; Intro para editar.',
    loadingText: 'Cargando editor de texto…',
    editingText: 'Editando texto · Ctrl/⌘+Intro para terminar',
    textSaveFailed: 'No se pudo guardar el texto. Mantén esta página abierta para reintentar.',
    textLoadFailed: 'No se pudo abrir el editor. Selecciona Texto para reintentar.',

    // UI Controls
    pen: 'Lápiz',
    eraser: 'Borrador',
    undo: 'Deshacer',
    redo: 'Rehacer',
    size: 'Tamaño',
    color: 'Color',
    hex: 'Hex',
    close: 'Cerrar',
    clear: 'Limpiar',
    savePng: 'Guardar PNG',

    // Aria labels
    presetColors: 'Colores predefinidos',
    moreColors: 'Más colores',
    changeLanguage: 'Cambiar idioma',

    // Color names
    graphite: 'Grafito',
    slate: 'Pizarra',
    blue: 'Azul',
    green: 'Verde',
    amber: 'Ámbar',
    rose: 'Rosa',

    // Status messages
    ready: 'Listo',
    draftUpdated: 'Borrador actualizado',
    cleared: 'Limpiado',
    colorUpdated: 'Color actualizado',
    themeUpdated: 'Tema actualizado',
    preparingPng: 'Preparando PNG...',
    savePngFailed: 'No se pudo preparar el PNG',
    downloadedPng: 'PNG descargado',

    // File
    drawingFilename: 'dibujo.png',

    // Header/Brand
    brand: 'ZONI® Board',
    tagline: 'Pizarra local simple de ZONI',
    localOnly: 'Guardado solo en este dispositivo',
  },
} satisfies Record<Language, TranslationDictionary>;

const LANG_KEY = 'vatio_board_lang';

const storedLang = loadText(LANG_KEY, null);
function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'es';
}

const detectedLang: Language = isLanguage(storedLang)
  ? storedLang
  : isLanguage(window.__lang)
    ? window.__lang
    : navigator.language?.startsWith('es')
      ? 'es'
      : 'en';

// Current language (can be changed later for manual switching)
let currentLang: Language = detectedLang;

/**
 * Get translation by key
 * @param {string} key - Translation key
 * @returns {string} - Translated string or key if not found
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const text = isTranslationKey(key) ? (translations[currentLang][key] ?? english[key]) : key;
  if (!params) return text;

  return text.replace(/\{(\w+)\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(params, token)) {
      return String(params[token]);
    }
    return match;
  });
}

/**
 * Get current language
 * @returns {string} - Current language code ('en' or 'es')
 */
export function getLang(): Language {
  return currentLang;
}

/**
 * Set language manually and persist to localStorage
 * @param {string} lang - Language code ('en' or 'es')
 */
export function setLang(lang: string): void {
  if (isLanguage(lang)) {
    currentLang = lang;
    saveText(LANG_KEY, lang);
    document.documentElement.lang = lang;
  }
}

/**
 * Toggle between 'en' and 'es', persist, and re-apply translations
 * @returns {string} - New language code
 */
export function toggleLang(): Language {
  const newLang = currentLang === 'en' ? 'es' : 'en';
  setLang(newLang);
  applyTranslations();
  document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: newLang } }));
  return newLang;
}

/**
 * Apply translations to DOM elements with data-i18n attribute
 */
export function applyTranslations(): void {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key !== null) el.textContent = t(key);
  });

  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    if (key !== null) el.setAttribute('aria-label', t(key));
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key !== null) el.setAttribute('title', t(key));
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key !== null) el.setAttribute('placeholder', t(key));
  });
}

export { translations, detectedLang };
