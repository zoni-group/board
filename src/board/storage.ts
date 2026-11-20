import {
  IMAGE_TYPES,
  VIDEO_TYPES,
  assetIdFor,
  expandCommands,
  isFiniteNumber,
  isRecord,
  normalizeCommand,
} from './model.ts';
import type { BoardSnapshot } from './model.ts';
import { normalizeViewport } from './viewport.ts';
import type { BoardViewport } from './viewport.ts';
import { normalizeTextDraft } from './text-draft.ts';
import type { TextDraft } from './text-draft.ts';
import { DEFAULT_BACKGROUND, normalizeBackground } from './background.ts';
import type { BoardBackground } from './background.ts';

export const LIBRARY_DB_NAME = 'zoni-board-library';
export const LIBRARY_VERSION = 1;
export type BoardId = string;
export interface BoardSummary {
  id: BoardId;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
  revision: number;
}
/** One page of a lesson: its own drawing, undo history and view. */
export interface BoardPage extends BoardSnapshot {
  id: string;
  viewport: BoardViewport | null;
}
/**
 * The flat `commands`, `redoCommands` and `viewport` are always the open page, so code that
 * works on "the board" works on the page being shown. `pages` lists every page in order; its
 * entry at `pageIndex` is refreshed from the flat fields whenever the board is normalized.
 */
export interface BoardState extends BoardSnapshot {
  viewport: BoardViewport | null;
  draft: TextDraft | null;
  /** Left out by callers that only change the open page; the stored pages are kept. */
  pages?: BoardPage[];
  pageIndex?: number;
}
export interface BoardDocument extends BoardSummary, BoardState {
  /** 1: one page, stored flat. 2: several pages. Older app versions refuse 2 instead of losing pages. */
  version: 1 | 2;
  /** Paper pattern and color, shared by every page. Optional in stored data; normalized to the default. */
  background: BoardBackground;
  pages: BoardPage[];
  pageIndex: number;
}
export const MAX_PAGES = 200;
const FIRST_PAGE_ID = 'page-1';
export interface BoardLibrary {
  version: 1;
  activeBoardId: BoardId;
  boards: BoardSummary[];
}
export interface BinaryAsset {
  bytes: ArrayBuffer;
  type: string;
}
export interface StoredAsset {
  id: string;
  boardId: BoardId;
  kind: 'image' | 'video';
  width: number;
  height: number;
  blob: BinaryAsset;
  poster?: BinaryAsset;
}
export class BoardStorageError extends Error {}
let connection: Promise<IDBDatabase> | null = null;

function validAsset(value: unknown): value is StoredAsset {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.boardId !== 'string' ||
    !value.boardId ||
    (value.kind !== 'image' && value.kind !== 'video') ||
    !isFiniteNumber(value.width) ||
    value.width <= 0 ||
    value.width > 100000 ||
    !isFiniteNumber(value.height) ||
    value.height <= 0 ||
    value.height > 100000
  )
    return false;
  const binary = (data: unknown, types: readonly string[]) =>
    isRecord(data) &&
    typeof data.type === 'string' &&
    types.includes(data.type) &&
    Object.prototype.toString.call(data.bytes) === '[object ArrayBuffer]' &&
    (data.bytes as ArrayBuffer).byteLength > 0 &&
    (data.bytes as ArrayBuffer).byteLength <= 100 * 1024 * 1024;
  return (
    binary(value.blob, value.kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES) &&
    (value.poster === undefined || (value.kind === 'video' && binary(value.poster, ['image/png'])))
  );
}

export function normalizeSnapshot(value: unknown): BoardSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.commands) || !Array.isArray(value.redoCommands))
    return null;
  const commands = value.commands.map((command) => normalizeCommand(command));
  const redoCommands = value.redoCommands.map((command) => normalizeCommand(command));
  if (commands.some((c) => c === null) || redoCommands.some((c) => c === null)) return null;
  return {
    commands: commands as BoardSnapshot['commands'],
    redoCommands: redoCommands as BoardSnapshot['redoCommands'],
  };
}
function normalizePages(
  value: Record<string, unknown>,
  open: BoardPage
): { pages: BoardPage[]; pageIndex: number } | null {
  // In-memory documents carry `pages` whatever their version; flat v1 records have none.
  if (value.version === 1 && !Array.isArray(value.pages)) return { pages: [open], pageIndex: 0 };
  const list = value.pages;
  if (!Array.isArray(list) || !list.length || list.length > MAX_PAGES) return null;
  const pageIndex = Number.isSafeInteger(value.pageIndex)
    ? Math.min(Math.max(value.pageIndex as number, 0), list.length - 1)
    : 0;
  const pages: BoardPage[] = [];
  for (const [index, page] of list.entries()) {
    if (!isRecord(page) || typeof page.id !== 'string' || !page.id) return null;
    if (index === pageIndex) {
      pages.push({ ...open, id: page.id });
      continue;
    }
    const snapshot = normalizeSnapshot(page);
    const viewport = page.viewport == null ? null : normalizeViewport(page.viewport);
    if (!snapshot || (page.viewport != null && !viewport)) return null;
    pages.push({ id: page.id, ...snapshot, viewport });
  }
  if (new Set(pages.map((page) => page.id)).size !== pages.length) return null;
  return { pages, pageIndex };
}
export function normalizeBoardDocument(value: unknown): BoardDocument | null {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 100 ||
    !isFiniteNumber(value.createdAtMs) ||
    value.createdAtMs < 0 ||
    !isFiniteNumber(value.updatedAtMs) ||
    value.updatedAtMs < 0 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    return null;
  const snapshot = normalizeSnapshot(value);
  const viewport = value.viewport === null ? null : normalizeViewport(value.viewport);
  const draft = value.draft === null ? null : normalizeTextDraft(value.draft);
  if (!snapshot || (value.viewport !== null && !viewport) || (value.draft !== null && !draft))
    return null;
  const paging = normalizePages(value, { id: FIRST_PAGE_ID, ...snapshot, viewport });
  if (!paging) return null;
  return {
    version: paging.pages.length > 1 ? 2 : 1,
    id: value.id,
    name: value.name.trim(),
    createdAtMs: value.createdAtMs,
    updatedAtMs: value.updatedAtMs,
    revision: value.revision as number,
    ...snapshot,
    viewport,
    draft,
    background: normalizeBackground(value.background),
    ...paging,
  };
}
/**
 * The record written to the database and to archives. A one-page board keeps the original flat
 * format; with several pages, the open page's entry holds only its id because the flat fields
 * already store it.
 */
export function toStoredBoard(board: BoardDocument): Record<string, unknown> {
  const { pages, pageIndex, ...rest } = board;
  if (pages.length <= 1) return { ...rest, version: 1 };
  return {
    ...rest,
    version: 2,
    pageIndex,
    pages: pages.map((page, index) => (index === pageIndex ? { id: page.id } : page)),
  };
}
/** Every page's commands and redo commands, the open page first. */
export function boardPageSnapshots(board: BoardDocument): BoardSnapshot[] {
  return [board, ...board.pages.filter((_, index) => index !== board.pageIndex)];
}
/** Media ids that any page's undo or redo history refers to. */
export function boardAssetIds(board: BoardDocument): Set<string> {
  const ids = new Set<string>();
  for (const page of boardPageSnapshots(board))
    for (const command of expandCommands([...page.commands, ...page.redoCommands]))
      if (command.type === 'content-set') {
        const id = assetIdFor(command.object);
        if (id) ids.add(id);
      }
  return ids;
}
/**
 * Drops the history a page can only reach by undoing its last Clear, and its redo stack.
 * The page looks the same afterwards. Returns null when there is nothing to drop.
 */
export function compactBoardHistory<T extends BoardSnapshot>(page: T): T | null {
  let lastClear = page.commands.length - 1;
  while (lastClear >= 0 && page.commands[lastClear].type !== 'clear') lastClear--;
  if (lastClear < 0 && !page.redoCommands.length) return null;
  return { ...page, commands: page.commands.slice(lastClear + 1), redoCommands: [] };
}
/** Compacts every page of a board; null when no page changes. */
export function compactBoard(board: BoardDocument): BoardDocument | null {
  const open = compactBoardHistory(board);
  const pages = board.pages.map((page, index) =>
    index === board.pageIndex ? page : (compactBoardHistory(page) ?? page)
  );
  if (!open && pages.every((page, index) => page === board.pages[index])) return null;
  const flat = open ?? board;
  return {
    ...board,
    commands: flat.commands,
    redoCommands: flat.redoCommands,
    pages: pages.map((page, index) =>
      index === board.pageIndex
        ? { ...page, commands: flat.commands, redoCommands: flat.redoCommands }
        : page
    ),
  };
}
function summary(board: BoardDocument): BoardSummary {
  const { id, name, createdAtMs, updatedAtMs, revision } = board;
  return { id, name, createdAtMs, updatedAtMs, revision };
}
function catalog(value: unknown): BoardLibrary {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.activeBoardId !== 'string' ||
    !Array.isArray(value.boards) ||
    !value.boards.length ||
    value.boards.some(
      (b) =>
        !isRecord(b) ||
        typeof b.id !== 'string' ||
        !b.id ||
        typeof b.name !== 'string' ||
        !b.name.trim() ||
        !isFiniteNumber(b.updatedAtMs)
    ) ||
    new Set(value.boards.map((b) => b.id)).size !== value.boards.length ||
    !value.boards.some((b) => b.id === value.activeBoardId)
  )
    throw new BoardStorageError('invalidLibrary');
  return value as unknown as BoardLibrary;
}
export function emptyBoard(name: string): BoardDocument {
  const now = Date.now();
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    createdAtMs: now,
    updatedAtMs: now,
    revision: 0,
    commands: [],
    redoCommands: [],
    viewport: null,
    draft: null,
    background: { ...DEFAULT_BACKGROUND },
    pages: [{ id: FIRST_PAGE_ID, commands: [], redoCommands: [], viewport: null }],
    pageIndex: 0,
  };
}
export function uniqueBoardName(name: string, boards: readonly BoardSummary[]): string {
  const base = name.trim().slice(0, 100) || 'Board';
  let candidate = base,
    index = 2;
  while (boards.some((b) => b.name === candidate)) {
    const suffix = ` (${index++})`;
    candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
  }
  return candidate;
}
function nextName(boards: readonly BoardSummary[], base: string): string {
  let n = 1;
  while (boards.some((b) => b.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}
async function database(): Promise<IDBDatabase> {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new BoardStorageError('storageUnavailable'));
        return;
      }
      const request = indexedDB.open(LIBRARY_DB_NAME, LIBRARY_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('boards', { keyPath: 'id' });
        db.createObjectStore('assets', { keyPath: 'id' }).createIndex('byBoard', 'boardId');
        db.createObjectStore('meta');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
      request.onerror = request.onblocked = () => {
        connection = null;
        reject(new BoardStorageError('storageUnavailable'));
      };
    }).catch((error) => {
      connection = null;
      throw error;
    });
  return connection;
}
export async function closeLibraryDatabase(): Promise<void> {
  try {
    (await connection)?.close();
  } finally {
    connection = null;
  }
}
function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T, failure: unknown;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(failure ?? tx.error ?? new BoardStorageError('storageUnavailable'));
    tx.onerror = () => {
      /* The abort handler reports failure after the transaction rolls back. */
    };
    void operation(tx)
      .then((result) => {
        value = result;
      })
      .catch((error) => {
        failure = error;
        try {
          tx.abort();
        } catch {
          reject(error);
        }
      });
  });
}
export async function initializeLibrary(baseName = 'Board'): Promise<BoardDocument> {
  return transaction(['meta', 'boards'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta'),
      store = tx.objectStore('boards');
    const saved = await read(meta.get('library'));
    if (saved === undefined) {
      const board = emptyBoard(`${baseName} 1`);
      store.put(toStoredBoard(board));
      meta.put({ version: 1, activeBoardId: board.id, boards: [summary(board)] }, 'library');
      return board;
    }
    const library = catalog(saved),
      board = normalizeBoardDocument(await read(store.get(library.activeBoardId)));
    if (!board) throw new BoardStorageError('invalidLibrary');
    return board;
  });
}
export async function getBoardLibrary(): Promise<BoardLibrary> {
  return transaction(['meta'], 'readonly', async (tx) =>
    catalog(await read(tx.objectStore('meta').get('library')))
  );
}
export async function listBoards(): Promise<BoardSummary[]> {
  return (await getBoardLibrary()).boards.sort(
    (a, b) => b.updatedAtMs - a.updatedAtMs || a.name.localeCompare(b.name)
  );
}
export async function loadBoardDrawing(id: BoardId): Promise<BoardDocument> {
  return transaction(['boards'], 'readonly', async (tx) => {
    const value = await read(tx.objectStore('boards').get(id));
    if (value === undefined) throw new BoardStorageError('boardDeleted');
    const board = normalizeBoardDocument(value);
    if (!board) throw new BoardStorageError('invalidBoard');
    return board;
  });
}
export async function setActiveBoard(id: BoardId): Promise<void> {
  return transaction(['meta'], 'readwrite', async (tx) => {
    const store = tx.objectStore('meta'),
      library = catalog(await read(store.get('library')));
    if (!library.boards.some((b) => b.id === id)) throw new BoardStorageError('boardDeleted');
    store.put({ ...library, activeBoardId: id }, 'library');
  });
}
export async function createBoard(name?: string, baseName = 'Board'): Promise<BoardDocument> {
  return transaction(['meta', 'boards'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta'),
      library = catalog(await read(meta.get('library')));
    const board = emptyBoard(
      name ? uniqueBoardName(name, library.boards) : nextName(library.boards, baseName)
    );
    tx.objectStore('boards').put(toStoredBoard(board));
    meta.put(
      { ...library, activeBoardId: board.id, boards: [...library.boards, summary(board)] },
      'library'
    );
    return board;
  });
}
export async function renameBoard(id: BoardId, name: string): Promise<BoardSummary> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new BoardStorageError('invalidBoardName');
  return transaction(['meta', 'boards'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta'),
      store = tx.objectStore('boards'),
      library = catalog(await read(meta.get('library')));
    const board = normalizeBoardDocument(await read(store.get(id)));
    if (!board) throw new BoardStorageError('boardDeleted');
    const next = { ...board, name: trimmed };
    store.put(toStoredBoard(next));
    meta.put(
      { ...library, boards: library.boards.map((b) => (b.id === id ? summary(next) : b)) },
      'library'
    );
    return summary(next);
  });
}
/** Changes a board's page background. Like a rename, it does not bump the drawing revision. */
export async function updateBoardBackground(
  id: BoardId,
  background: BoardBackground
): Promise<BoardBackground> {
  const next = normalizeBackground(background);
  return transaction(['boards'], 'readwrite', async (tx) => {
    const store = tx.objectStore('boards');
    const board = normalizeBoardDocument(await read(store.get(id)));
    if (!board) throw new BoardStorageError('boardDeleted');
    store.put(toStoredBoard({ ...board, background: next }));
    return next;
  });
}
export async function saveBoardDrawing(
  id: BoardId,
  state: BoardState,
  expectedRevision: number
): Promise<BoardDocument> {
  return transaction(['meta', 'boards'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta'),
      store = tx.objectStore('boards'),
      library = catalog(await read(meta.get('library')));
    const previous = normalizeBoardDocument(await read(store.get(id)));
    if (!previous || !library.boards.some((b) => b.id === id))
      throw new BoardStorageError('boardDeleted');
    if (previous.revision !== expectedRevision) throw new BoardStorageError('boardConflict');
    const next = normalizeBoardDocument({
      ...previous,
      commands: state.commands,
      redoCommands: state.redoCommands,
      viewport: state.viewport,
      draft: state.draft,
      ...(state.pages ? { pages: state.pages, pageIndex: state.pageIndex ?? 0 } : {}),
      revision: previous.revision + 1,
      updatedAtMs: Date.now(),
    });
    if (!next) throw new BoardStorageError('invalidBoard');
    store.put(toStoredBoard(next));
    meta.put(
      { ...library, boards: library.boards.map((b) => (b.id === id ? summary(next) : b)) },
      'library'
    );
    return next;
  });
}
export async function deleteBoard(id: BoardId, baseName = 'Board'): Promise<BoardDocument> {
  return transaction(['meta', 'boards', 'assets'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta'),
      store = tx.objectStore('boards'),
      assets = tx.objectStore('assets');
    const library = catalog(await read(meta.get('library')));
    if (!library.boards.some((b) => b.id === id)) throw new BoardStorageError('boardDeleted');
    const keys = await read(assets.index('byBoard').getAllKeys(id));
    for (const key of keys) assets.delete(key);
    store.delete(id);
    const remaining = library.boards
      .filter((b) => b.id !== id)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    let next: BoardDocument;
    if (!remaining.length) {
      next = emptyBoard(`${baseName} 1`);
      store.put(toStoredBoard(next));
      remaining.push(summary(next));
    } else {
      const active = remaining.find((b) => b.id === library.activeBoardId) ?? remaining[0];
      const loaded = normalizeBoardDocument(await read(store.get(active.id)));
      if (!loaded) throw new BoardStorageError('invalidBoard');
      next = loaded;
    }
    meta.put({ ...library, activeBoardId: next.id, boards: remaining }, 'library');
    return next;
  });
}
async function deleteUnusedAssets(
  tx: IDBTransaction,
  board: BoardDocument,
  keep: ReadonlySet<string>
): Promise<number> {
  const used = boardAssetIds(board);
  const assets = tx.objectStore('assets');
  const keys = await read(assets.index('byBoard').getAllKeys(board.id));
  let removed = 0;
  for (const key of keys)
    if (typeof key === 'string' && !used.has(key) && !keep.has(key)) {
      assets.delete(key);
      removed++;
    }
  return removed;
}
/**
 * Deletes a board's media that its saved history no longer refers to. It decides from the
 * stored document, so media a saved board uses are never removed. `keep` protects more ids.
 */
export async function pruneBoardAssets(
  id: BoardId,
  keep: ReadonlySet<string> = new Set()
): Promise<number> {
  return transaction(['boards', 'assets'], 'readwrite', async (tx) => {
    const board = normalizeBoardDocument(await read(tx.objectStore('boards').get(id)));
    if (!board) throw new BoardStorageError('boardDeleted');
    return deleteUnusedAssets(tx, board, keep);
  });
}
/** Compacts a board that isn't open here and deletes the media it no longer uses. */
export async function compactStoredBoard(id: BoardId): Promise<number> {
  return transaction(['meta', 'boards', 'assets'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta'),
      store = tx.objectStore('boards'),
      library = catalog(await read(meta.get('library')));
    const board = normalizeBoardDocument(await read(store.get(id)));
    if (!board) throw new BoardStorageError('boardDeleted');
    const compacted = compactBoard(board);
    if (compacted) {
      // A new revision makes another tab with this board open reload instead of overwriting it.
      const next = { ...compacted, revision: board.revision + 1, updatedAtMs: Date.now() };
      store.put(toStoredBoard(next));
      meta.put(
        { ...library, boards: library.boards.map((b) => (b.id === id ? summary(next) : b)) },
        'library'
      );
      return deleteUnusedAssets(tx, next, new Set());
    }
    return deleteUnusedAssets(tx, board, new Set());
  });
}
export async function putAssetRecord(asset: StoredAsset): Promise<void> {
  if (!validAsset(asset)) throw new BoardStorageError('archiveMissingMedia');
  return transaction(['boards', 'assets'], 'readwrite', async (tx) => {
    if ((await read(tx.objectStore('boards').getKey(asset.boardId))) === undefined)
      throw new BoardStorageError('boardDeleted');
    tx.objectStore('assets').put(asset);
  });
}
export async function getAssetRecord(id: string): Promise<StoredAsset | undefined> {
  return transaction(['assets'], 'readonly', async (tx) => {
    const value = await read(tx.objectStore('assets').get(id));
    if (value === undefined) return undefined;
    if (!validAsset(value)) throw new BoardStorageError('archiveMissingMedia');
    return value;
  });
}
export async function deleteAssetRecord(id: string): Promise<void> {
  return transaction(['assets'], 'readwrite', async (tx) => {
    tx.objectStore('assets').delete(id);
  });
}
export async function importBoardRecords(
  boards: BoardDocument[],
  assets: StoredAsset[],
  activeId: string,
  signal?: AbortSignal
): Promise<BoardDocument> {
  if (
    !boards.length ||
    boards.some((board) => !normalizeBoardDocument(board)) ||
    assets.some(
      (asset) => !validAsset(asset) || !boards.some((board) => board.id === asset.boardId)
    )
  )
    throw new BoardStorageError('invalidArchive');
  let abort: (() => void) | undefined;
  return transaction(['boards', 'assets', 'meta'], 'readwrite', async (tx) => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    abort = () => {
      try {
        tx.abort();
      } catch {
        /* Transaction already completed. */
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    const meta = tx.objectStore('meta'),
      library = catalog(await read(meta.get('library')));
    const summaries = [...library.boards];
    for (const board of boards) {
      board.name = uniqueBoardName(board.name, summaries);
      tx.objectStore('boards').add(toStoredBoard(board));
      summaries.push(summary(board));
    }
    for (const asset of assets) tx.objectStore('assets').add(asset);
    const active = boards.find((b) => b.id === activeId);
    if (!active) throw new BoardStorageError('invalidArchive');
    meta.put({ ...library, boards: summaries, activeBoardId: active.id }, 'library');
    return active;
  }).finally(() => {
    if (abort) signal?.removeEventListener('abort', abort);
  });
}

/** One coalescing queue belongs to one board, including all callbacks that outlive its view. */
export function createBoardSession(initial: BoardDocument, onError: (error: unknown) => void) {
  let record = structuredClone(initial),
    pending: BoardState | null = null,
    running: Promise<boolean> | null = null;
  let waiters: ((ok: boolean) => void)[] = [];
  const stateKey = (state: BoardState) =>
    JSON.stringify([
      state.commands,
      state.redoCommands,
      state.viewport,
      state.draft,
      state.pageIndex,
      // The open page is already in the flat fields.
      state.pages?.map((page, index) => (index === state.pageIndex ? page.id : page)),
    ]);
  let savedKey = stateKey(initial);
  const session = {
    get record() {
      return record;
    },
    update(state: Partial<BoardState>) {
      record = { ...record, ...state };
    },
    save(): Promise<boolean> {
      if (!running && stateKey(record) === savedKey) return Promise.resolve(true);
      pending = structuredClone(record);
      const result = new Promise<boolean>((resolve) => waiters.push(resolve));
      if (!running)
        running = Promise.resolve().then(async () => {
          let allOk = true;
          while (pending) {
            const state = pending,
              resolvers = waiters;
            pending = null;
            waiters = [];
            try {
              const key = stateKey(state);
              if (key === savedKey) {
                resolvers.forEach((resolve) => resolve(true));
                continue;
              }
              const saved = await saveBoardDrawing(record.id, state, record.revision);
              savedKey = key;
              record = {
                ...record,
                version: saved.version,
                name: saved.name,
                revision: saved.revision,
                updatedAtMs: saved.updatedAtMs,
              };
              resolvers.forEach((resolve) => resolve(true));
            } catch (error) {
              allOk = false;
              onError(error);
              resolvers.forEach((resolve) => resolve(false));
            }
          }
          running = null;
          return allOk;
        });
      return result;
    },
    async flush(): Promise<boolean> {
      let ok = true;
      while (running) ok = (await running) && ok;
      return ok;
    },
    snapshot(): BoardDocument {
      return structuredClone(record);
    },
  };
  return session;
}
export type BoardSession = ReturnType<typeof createBoardSession>;
