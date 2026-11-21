import { loadText, saveText } from './shared/storage.ts';

/**
 * VatioBoard i18n - Minimal internationalization
 * Supports: English (en), Spanish (es)
 */

export type Language = 'en' | 'es';

const english = {
  boards: 'Boards',
  boardDefaultName: 'Board',
  boardName: 'Board name',
  currentBoard: 'Current board',
  newBoard: 'New board',
  openBoards: 'Open boards…',
  renameBoard: 'Rename',
  deleteBoard: 'Delete board',
  clearDrawing: 'Clear drawing',
  exportBoard: 'Export board',
  exportAllBoards: 'Export all boards',
  importBoards: 'Import boards…',
  deleteBoardQuestion: 'Delete “{name}” and its history? This cannot be undone.',
  boardDeletedStatus: 'Board deleted',
  boardsExported: 'Editable boards exported with history and media',
  boardsImported: 'Boards imported as new copies',
  boardConflict:
    'This board changed in another tab. Export this board to keep your unsaved edits, then reload the page.',
  boardDeleted: 'This board was deleted in another tab. Export to keep your unsaved edits.',
  invalidBoardName: 'Enter a board name between 1 and 100 characters.',
  invalidArchive: 'This board file is incomplete or damaged. No boards were imported.',
  unsupportedArchive: 'This is not a supported ZONI Board file.',
  archiveMissingMedia: 'Some media is missing from this board. Could not create a complete export.',
  archiveTooLarge: 'This backup is too large. Export boards individually.',
  storageUnavailable:
    'Local board storage is unavailable. You can draw and export this board; saved boards could not be opened.',
  invalidLibrary: 'Could not read the saved board library. Your saved data has not been replaced.',
  invalidBoard: 'Could not read this board. Your saved data has not been replaced.',
  boardSaveFailed: 'Could not save this board. Keep it open or export it to preserve your changes.',
  boardOperationFailed:
    'Could not complete this board operation. Your existing boards have not been replaced.',
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
  selectModes: 'Select modes',
  selectOne: 'Select one',
  boxSelect: 'Box',
  lassoSelect: 'Lasso',
  boxSelectHint: 'Drag a box around objects · Drag the selection to move it',
  lassoSelectHint: 'Draw a loop around objects · Drag the selection to move it',
  objectsSelected: '{count} objects selected · Drag to move · Delete removes them',
  settings: 'Settings',
  settingsMenu: 'Settings…',
  boardLabel: 'Board',
  currentBadge: 'Current',
  pageSection: 'Paper',
  addPage: 'Add page',
  pages: 'Pages',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  pageOf: 'Page {page} of {count}',
  pageFile: 'page {page}',
  pageActions: 'Page actions',
  duplicatePage: 'Duplicate page',
  movePageEarlier: 'Move earlier',
  movePageLater: 'Move later',
  deletePage: 'Delete page',
  deletePageQuestion: 'Delete page {page}? Its drawing will be lost.',
  pageDuplicated: 'Page {page} of {count} · duplicated',
  pageMoved: 'Moved to page {page}',
  pageDeleted: 'Page deleted',
  freeUpSpace: 'Free up space',
  freeUpSpaceHint: 'Removes Undo history from before each Clear, and images nothing uses anymore.',
  freeUpSpaceQuestion:
    "Remove Undo history from before each Clear, on all boards? This can't be undone.",
  spaceFreed: 'Freed {size}',
  spaceFreedNone: 'Nothing to free up',
  spaceFreeFailed: "Couldn't free up space",
  appearanceSection: 'Appearance',
  storageSection: 'Storage',
  pattern: 'Pattern',
  patternBlank: 'Blank',
  patternGrid: 'Grid',
  patternLined: 'Lined',
  patternDotted: 'Dotted',
  spacing: 'Spacing',
  spacingSmall: 'Small',
  spacingMedium: 'Medium',
  spacingLarge: 'Large',
  paperColor: 'Color',
  colorAuto: 'Auto (theme)',
  colorWhite: 'White',
  colorCream: 'Cream',
  colorGreen: 'Green chalkboard',
  colorBlack: 'Blackboard',
  theme: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  storageUsage: 'Using {used} of {quota} on this device',
  storageBoards: '{count} boards',
  storageBoardsOne: '1 board',
  storagePersisted: 'Protected from automatic cleanup',
  storagePersist: 'Keep boards on this device',
  storagePersistHint: 'The browser may clear stored boards when space runs low.',
  storagePersistDenied: 'The browser did not allow it. Export boards to keep a copy.',
  storageDetailsUnavailable: 'Storage details are not available in this browser.',
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
  penTypes: 'Pen types',
  highlighter: 'Highlighter',
  laser: 'Laser',
  laserHint: 'Laser · The trail fades and nothing is saved',
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
  insertPdf: 'Insert PDF…',
  importingPdfPage: 'Importing PDF · page {page} of {count}',
  pdfInserted: 'Inserted {count} pages from the PDF',
  pdfInsertedOne: 'Inserted 1 page from the PDF',
  pdfInsertedPartly: 'Inserted {count} of {total} PDF pages · a board holds up to {max} pages',
  pdfUnreadable: 'Could not read this PDF',
  pdfLocked: 'This PDF is password-protected',
  pdfTooLarge: 'PDF is too large (max 50 MB)',
  boardFull: 'A board holds up to {max} pages',
  savePdf: 'Save PDF',
  preparingPdf: 'Preparing PDF · page {page} of {count}',
  downloadedPdf: 'Downloaded PDF',
  downloadedPdfReduced: 'Downloaded PDF · resolution reduced on large pages',
  savePdfFailed: 'Could not prepare the PDF',
  minimumZoomReached: 'Minimum zoom reached. Pan to see the rest of the drawing.',

  // File

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
    boards: 'Pizarras',
    boardDefaultName: 'Pizarra',
    boardName: 'Nombre de la pizarra',
    currentBoard: 'Pizarra actual',
    newBoard: 'Nueva pizarra',
    openBoards: 'Abrir pizarras…',
    renameBoard: 'Renombrar',
    deleteBoard: 'Eliminar pizarra',
    clearDrawing: 'Limpiar dibujo',
    exportBoard: 'Exportar pizarra',
    exportAllBoards: 'Exportar todas las pizarras',
    importBoards: 'Importar pizarras…',
    deleteBoardQuestion: '¿Eliminar «{name}» y su historial? Esta acción no se puede deshacer.',
    boardDeletedStatus: 'Pizarra eliminada',
    boardsExported: 'Pizarras editables exportadas con historial y archivos',
    boardsImported: 'Pizarras importadas como copias nuevas',
    boardConflict:
      'Esta pizarra cambió en otra pestaña. Expórtala para conservar los cambios sin guardar y recarga la página.',
    boardDeleted: 'Esta pizarra se eliminó en otra pestaña. Expórtala para conservar tus cambios.',
    invalidBoardName: 'Introduce un nombre de entre 1 y 100 caracteres.',
    invalidArchive: 'El archivo está incompleto o dañado. No se importó ninguna pizarra.',
    unsupportedArchive: 'Este archivo no es una pizarra ZONI compatible.',
    archiveMissingMedia:
      'Faltan archivos de esta pizarra. No se pudo crear una exportación completa.',
    archiveTooLarge: 'La copia es demasiado grande. Exporta las pizarras por separado.',
    storageUnavailable:
      'El almacenamiento local no está disponible. Puedes dibujar y exportar esta pizarra; no se pudieron abrir las guardadas.',
    invalidLibrary: 'No se pudo leer la biblioteca. Los datos guardados no se han reemplazado.',
    invalidBoard: 'No se pudo leer la pizarra. Los datos guardados no se han reemplazado.',
    boardSaveFailed:
      'No se pudo guardar la pizarra. Mantenla abierta o expórtala para conservar los cambios.',
    boardOperationFailed:
      'No se pudo completar la operación. Las pizarras existentes no se han reemplazado.',
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
    selectModes: 'Modos de selección',
    selectOne: 'Seleccionar uno',
    boxSelect: 'Rectángulo',
    lassoSelect: 'Lazo',
    boxSelectHint: 'Arrastra un rectángulo alrededor · Arrastra la selección para moverla',
    lassoSelectHint: 'Dibuja un lazo alrededor · Arrastra la selección para moverla',
    objectsSelected: '{count} objetos seleccionados · Arrastra para mover · Supr los elimina',
    settings: 'Ajustes',
    settingsMenu: 'Ajustes…',
    boardLabel: 'Pizarra',
    currentBadge: 'Actual',
    pageSection: 'Papel',
    addPage: 'Añadir página',
    pages: 'Páginas',
    previousPage: 'Página anterior',
    nextPage: 'Página siguiente',
    pageOf: 'Página {page} de {count}',
    pageFile: 'página {page}',
    pageActions: 'Acciones de página',
    duplicatePage: 'Duplicar página',
    movePageEarlier: 'Mover antes',
    movePageLater: 'Mover después',
    deletePage: 'Eliminar página',
    deletePageQuestion: '¿Eliminar la página {page}? Se perderá su dibujo.',
    pageDuplicated: 'Página {page} de {count} · duplicada',
    pageMoved: 'Movida a la página {page}',
    pageDeleted: 'Página eliminada',
    freeUpSpace: 'Liberar espacio',
    freeUpSpaceHint:
      'Elimina el historial de Deshacer anterior a cada Borrado y las imágenes que ya no se usan.',
    freeUpSpaceQuestion:
      '¿Eliminar el historial de Deshacer anterior a cada Borrado en todas las pizarras? No se puede deshacer.',
    spaceFreed: 'Se liberaron {size}',
    spaceFreedNone: 'No hay nada que liberar',
    spaceFreeFailed: 'No se pudo liberar espacio',
    appearanceSection: 'Apariencia',
    storageSection: 'Almacenamiento',
    pattern: 'Fondo',
    patternBlank: 'Liso',
    patternGrid: 'Cuadrícula',
    patternLined: 'Rayado',
    patternDotted: 'Puntos',
    spacing: 'Espaciado',
    spacingSmall: 'Pequeño',
    spacingMedium: 'Mediano',
    spacingLarge: 'Grande',
    paperColor: 'Color',
    colorAuto: 'Automático (tema)',
    colorWhite: 'Blanco',
    colorCream: 'Crema',
    colorGreen: 'Pizarra verde',
    colorBlack: 'Pizarra negra',
    theme: 'Tema',
    themeSystem: 'Sistema',
    themeLight: 'Claro',
    themeDark: 'Oscuro',
    storageUsage: 'Usando {used} de {quota} en este dispositivo',
    storageBoards: '{count} pizarras',
    storageBoardsOne: '1 pizarra',
    storagePersisted: 'Protegido contra la limpieza automática',
    storagePersist: 'Conservar las pizarras en este dispositivo',
    storagePersistHint: 'El navegador puede borrar las pizarras guardadas si falta espacio.',
    storagePersistDenied:
      'El navegador no lo permitió. Exporta las pizarras para guardar una copia.',
    storageDetailsUnavailable:
      'Los detalles de almacenamiento no están disponibles en este navegador.',
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
    penTypes: 'Tipos de lápiz',
    highlighter: 'Resaltador',
    laser: 'Láser',
    laserHint: 'Láser · El trazo se desvanece y no se guarda',
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
    insertPdf: 'Insertar PDF…',
    importingPdfPage: 'Importando PDF · página {page} de {count}',
    pdfInserted: 'Se insertaron {count} páginas del PDF',
    pdfInsertedOne: 'Se insertó 1 página del PDF',
    pdfInsertedPartly:
      'Se insertaron {count} de {total} páginas del PDF · una pizarra admite hasta {max} páginas',
    pdfUnreadable: 'No se pudo leer este PDF',
    pdfLocked: 'Este PDF está protegido con contraseña',
    pdfTooLarge: 'El PDF es demasiado grande (máx. 50 MB)',
    boardFull: 'Una pizarra admite hasta {max} páginas',
    savePdf: 'Guardar PDF',
    preparingPdf: 'Preparando PDF · página {page} de {count}',
    downloadedPdf: 'PDF descargado',
    downloadedPdfReduced: 'PDF descargado · resolución reducida en las páginas grandes',
    savePdfFailed: 'No se pudo preparar el PDF',
    minimumZoomReached: 'Zoom mínimo alcanzado. Desplázate para ver el resto del dibujo.',

    // File

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
