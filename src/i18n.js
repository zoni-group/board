import { loadText, saveText } from './shared/storage.js';

/**
 * VatioBoard i18n - Minimal internationalization
 * Supports: English (en), Spanish (es)
 */

const translations = {
  en: {
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
  },

  es: {
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
};

const LANG_KEY = 'vatio_board_lang';

const storedLang = loadText(LANG_KEY, null);
const detectedLang =
  storedLang || window.__lang || (navigator.language?.startsWith('es') ? 'es' : 'en');

// Current language (can be changed later for manual switching)
let currentLang = detectedLang;

/**
 * Get translation by key
 * @param {string} key - Translation key
 * @returns {string} - Translated string or key if not found
 */
export function t(key, params) {
  const text = translations[currentLang]?.[key] ?? translations.en[key] ?? key;
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
export function getLang() {
  return currentLang;
}

/**
 * Set language manually and persist to localStorage
 * @param {string} lang - Language code ('en' or 'es')
 */
export function setLang(lang) {
  if (translations[lang]) {
    currentLang = lang;
    saveText(LANG_KEY, lang);
    document.documentElement.lang = lang;
  }
}

/**
 * Toggle between 'en' and 'es', persist, and re-apply translations
 * @returns {string} - New language code
 */
export function toggleLang() {
  const newLang = currentLang === 'en' ? 'es' : 'en';
  setLang(newLang);
  applyTranslations();
  document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: newLang } }));
  return newLang;
}

/**
 * Apply translations to DOM elements with data-i18n attribute
 */
export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    el.setAttribute('aria-label', t(key));
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    el.setAttribute('title', t(key));
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.setAttribute('placeholder', t(key));
  });
}

export { translations, detectedLang };
