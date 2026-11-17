import { loadText, saveText } from './shared/storage.ts';

/**
 * VatioBoard i18n - Minimal internationalization
 * Supports: English (en), Spanish (es)
 */

export type Language = 'en' | 'es';

const english = {
  addObject: 'Add object',
  image: 'Image',
  table: 'Table',
  video: 'Video',
  tableRows: 'Rows',
  tableColumns: 'Columns',
  insertObject: 'Insert',
  playVideo: 'Play video',
  chooseVideoFile: 'Choose video file',
  videoUrl: 'YouTube or Vimeo URL',
  videoHint: 'MP4 or WebM up to 100 MiB, or a YouTube/Vimeo link.',
  onlineVideoHint: 'An internet connection is needed to play this video.',
  invalidVideoUrl: 'Enter a valid HTTPS YouTube or Vimeo video URL.',
  importingMedia: 'Saving media on this device…',
  oneFileAtATime: 'Drop one image or video at a time.',
  unsupportedMedia:
    'This file could not be opened. Choose PNG, JPEG, WebP, or a video this browser can play (MP4/WebM).',
  imageTooLarge: 'Choose an image smaller than 10 MiB.',
  videoTooLarge: 'Choose a video smaller than 100 MiB.',
  assetStorageFailed:
    'Could not save this file. Local media needs available browser storage on this device.',
  missingImage: 'Image unavailable',
  missingMedia: 'This media file is unavailable on this device.',
  tableLoadFailed: 'Could not open the table editor. Please try again.',
  invalidTable: 'Could not save the table. Use a rectangular table with text cells.',
  tableLimits: 'Edit inside this table. Up to 50 rows and 20 columns are supported.',
  select: 'Select',
  selectHint: 'Tap to select · Drag to move · Delete to remove',
  selectedObject: 'Selected object. Drag to move or use arrow keys; Delete removes.',
  objectSaveFailed: 'Could not save the change on this device. Keep this page open to retry.',
  shapes: 'Shapes',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  shapeHint: 'Drag to draw · Shift for equal sides or 45° · Tap a shape to select',
  selectedShape: 'Selected shape · Drag to move · Handles resize',
  shapeSaveFailed: 'Could not save shapes on this device. Keep this page open to retry.',
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
  hand: 'Hand',
  navigation: 'Board navigation',
  navigationHint: 'Drag with Hand to move. Use two fingers to move or zoom.',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom to 100%',
  fitDrawing: 'Fit drawing',
  downloadedPngReduced: 'Downloaded PNG · resolution reduced to fit the whole drawing',

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
  minimumZoomReached: 'Minimum zoom reached. Pan to see the rest of the drawing.',

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
    addObject: 'Añadir objeto',
    image: 'Imagen',
    table: 'Tabla',
    video: 'Vídeo',
    tableRows: 'Filas',
    tableColumns: 'Columnas',
    insertObject: 'Insertar',
    playVideo: 'Reproducir vídeo',
    chooseVideoFile: 'Elegir archivo de vídeo',
    videoUrl: 'URL de YouTube o Vimeo',
    videoHint: 'MP4 o WebM de hasta 100 MiB, o un enlace de YouTube/Vimeo.',
    onlineVideoHint: 'Se necesita conexión a internet para reproducir este vídeo.',
    invalidVideoUrl: 'Introduce una URL HTTPS válida de un vídeo de YouTube o Vimeo.',
    importingMedia: 'Guardando el archivo en este dispositivo…',
    oneFileAtATime: 'Arrastra una imagen o un vídeo a la vez.',
    unsupportedMedia:
      'No se pudo abrir el archivo. Elige PNG, JPEG, WebP o un vídeo compatible con este navegador (MP4/WebM).',
    imageTooLarge: 'Elige una imagen de menos de 10 MiB.',
    videoTooLarge: 'Elige un vídeo de menos de 100 MiB.',
    assetStorageFailed:
      'No se pudo guardar el archivo. Se necesita espacio disponible en el almacenamiento local del navegador.',
    missingImage: 'Imagen no disponible',
    missingMedia: 'Este archivo no está disponible en el dispositivo.',
    tableLoadFailed: 'No se pudo abrir el editor de tablas. Inténtalo de nuevo.',
    invalidTable: 'No se pudo guardar la tabla. Usa una tabla rectangular con celdas de texto.',
    tableLimits: 'Edita dentro de esta tabla. Se admiten hasta 50 filas y 20 columnas.',
    select: 'Seleccionar',
    selectHint: 'Toca para seleccionar · Arrastra para mover · Supr para eliminar',
    selectedObject:
      'Objeto seleccionado. Arrastra o usa las flechas para mover; Supr para eliminar.',
    objectSaveFailed: 'No se pudo guardar el cambio. Mantén esta página abierta para reintentar.',
    shapes: 'Formas',
    rectangle: 'Rectángulo',
    ellipse: 'Elipse',
    line: 'Línea',
    arrow: 'Flecha',
    shapeHint: 'Arrastra para dibujar · Mayús para lados iguales o 45° · Toca para seleccionar',
    selectedShape:
      'Forma seleccionada · Arrastra para mover · Usa los controles para redimensionar',
    shapeSaveFailed:
      'No se pudieron guardar las formas. Mantén esta página abierta para reintentar.',
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
    hand: 'Mano',
    navigation: 'Navegación de la pizarra',
    navigationHint: 'Arrastra con Mano para mover. Usa dos dedos para mover o ampliar.',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    resetZoom: 'Restablecer zoom al 100%',
    fitDrawing: 'Ver todo el dibujo',
    downloadedPngReduced: 'PNG descargado · resolución reducida para incluir todo el dibujo',

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
    minimumZoomReached: 'Zoom mínimo alcanzado. Desplázate para ver el resto del dibujo.',

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
