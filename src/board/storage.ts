import { createIndexedJsonKeyValueStore } from '../shared/indexed-storage.ts';
import { loadJson, removeStoredValue, saveJson } from '../shared/storage.ts';

import { BOARD_SCHEMA_VERSION, isFiniteNumber, isRecord, normalizeCommands } from './model.ts';
import type { BoardCommand, BoardDrawing, BoardSnapshot } from './model.ts';

export { BOARD_SCHEMA_VERSION } from './model.ts';
export const BOARD_DRAWING_KEY = 'vatio_board_drawing_v5';
export const OBJECTS_BOARD_DRAWING_KEY = 'vatio_board_drawing_v4';
export const SHAPES_BOARD_DRAWING_KEY = 'vatio_board_drawing_v3';
export const PREVIOUS_BOARD_DRAWING_KEY = 'vatio_board_drawing_v2';
export const LEGACY_BOARD_DRAWING_KEY = 'vatio_board_drawing_v1';
export const BOARD_PERSIST_CHUNK_SIZE = 100;

const BOARD_DB_NAME = 'vatio-board-storage';
const BOARD_DB_VERSION = 1;
const BOARD_DB_STORE = 'boardRecords';
const BOARD_HISTORY_SECTION = 'history';
const BOARD_REDO_SECTION = 'redo';
export const BOARD_CHUNK_KEY_PREFIX = 'boardChunk:v5:';

const boardStore = createIndexedJsonKeyValueStore({
  dbName: BOARD_DB_NAME,
  dbVersion: BOARD_DB_VERSION,
  storeName: BOARD_DB_STORE,
});

interface SnapshotReference {
  generation: string;
  commandCount: number;
  redoCount: number;
  chunkCount: number;
  redoChunkCount: number;
}

interface StoredBoardDocument extends BoardDrawing, SnapshotReference {
  previousGeneration: string;
  previousCommandCount: number;
  previousRedoCount: number;
  previousChunkCount: number;
  previousRedoChunkCount: number;
}

type HistorySection = 'history' | 'redo';

let boardMigrationPromise: Promise<void> | null = null;
let legacyMigrationDrawing: BoardDrawing | null = null;
let pendingSaveDocument: BoardDrawing | null = null;
let saveLoopRunning = false;
let pendingSaveResolvers: ((ok: boolean) => void)[] = [];
let generationCounter = 0;

function normalizePositiveInteger(value: unknown, fallback = 0): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function createStoredDocument(value: unknown, legacyPrefix?: string): StoredBoardDocument {
  const document = isRecord(value) ? value : {};
  const commands = normalizeCommands(document.commands, legacyPrefix && `${legacyPrefix}-history`);
  const redoCommands = normalizeCommands(
    document.redoCommands,
    legacyPrefix && `${legacyPrefix}-redo`
  );

  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalizePositiveInteger(document.updatedAtMs, Date.now()),
    generation: typeof document.generation === 'string' ? document.generation : '',
    commandCount: normalizePositiveInteger(document.commandCount, commands.length),
    redoCount: normalizePositiveInteger(document.redoCount, redoCommands.length),
    chunkCount: normalizePositiveInteger(document.chunkCount, 0),
    redoChunkCount: normalizePositiveInteger(document.redoChunkCount, 0),
    previousGeneration:
      typeof document.previousGeneration === 'string' ? document.previousGeneration : '',
    previousCommandCount: normalizePositiveInteger(document.previousCommandCount, 0),
    previousRedoCount: normalizePositiveInteger(document.previousRedoCount, 0),
    previousChunkCount: normalizePositiveInteger(document.previousChunkCount, 0),
    previousRedoChunkCount: normalizePositiveInteger(document.previousRedoChunkCount, 0),
    commands,
    redoCommands,
  };
}

export function createEmptyBoardDrawing(): BoardDrawing {
  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: 0,
    commands: [],
    redoCommands: [],
  };
}

function toBoardDrawing(document: unknown): BoardDrawing {
  const normalized = createStoredDocument(document);
  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalized.updatedAtMs,
    commands: normalized.commands,
    redoCommands: normalized.redoCommands,
  };
}

function createEmbeddedBoardDrawing(document: BoardDrawing) {
  const normalized = toBoardDrawing(document);
  return {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalized.updatedAtMs || Date.now(),
    generation: '',
    commandCount: normalized.commands.length,
    redoCount: normalized.redoCommands.length,
    chunkCount: 0,
    redoChunkCount: 0,
    commands: normalized.commands,
    redoCommands: normalized.redoCommands,
  };
}

function getBoardChunkKey(
  generation: string,
  section: HistorySection,
  chunkIndex: number,
  prefix = BOARD_CHUNK_KEY_PREFIX
): string {
  return `${prefix}${generation}:${section}:${String(chunkIndex)}`;
}

function createGenerationId(): string {
  generationCounter += 1;
  return `board-${Date.now()}-${generationCounter}`;
}

async function openBoardDatabase(): Promise<IDBDatabase | null> {
  if (!boardStore.hasSupport()) return null;

  try {
    return await boardStore.openDatabase();
  } catch {
    return null;
  }
}

function createSnapshotReference(
  document: StoredBoardDocument,
  { previous = false } = {}
): SnapshotReference {
  const normalized = createStoredDocument(document);

  return previous
    ? {
        generation: normalized.previousGeneration,
        commandCount: normalized.previousCommandCount,
        redoCount: normalized.previousRedoCount,
        chunkCount: normalized.previousChunkCount,
        redoChunkCount: normalized.previousRedoChunkCount,
      }
    : {
        generation: normalized.generation,
        commandCount: normalized.commandCount,
        redoCount: normalized.redoCount,
        chunkCount: normalized.chunkCount,
        redoChunkCount: normalized.redoChunkCount,
      };
}

function hasPersistedSnapshot(snapshot: SnapshotReference): boolean {
  return Boolean(snapshot?.generation) || snapshot?.chunkCount > 0 || snapshot?.redoChunkCount > 0;
}

async function deleteChunkRange(
  generation: string,
  section: HistorySection,
  chunkCount: number
): Promise<void> {
  if (!boardStore.hasSupport() || !generation) return;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    await boardStore.deleteValue(getBoardChunkKey(generation, section, chunkIndex));
  }
}

async function deleteSnapshotReference(snapshot: SnapshotReference): Promise<void> {
  if (!snapshot?.generation) return;
  await deleteChunkRange(snapshot.generation, BOARD_HISTORY_SECTION, snapshot.chunkCount ?? 0);
  await deleteChunkRange(snapshot.generation, BOARD_REDO_SECTION, snapshot.redoChunkCount ?? 0);
}

async function saveCommandChunks(
  generation: string,
  section: HistorySection,
  commands: BoardCommand[]
): Promise<{ ok: boolean; chunkCount: number }> {
  let chunkIndex = 0;

  for (let index = 0; index < commands.length; index += BOARD_PERSIST_CHUNK_SIZE) {
    const chunk = commands.slice(index, index + BOARD_PERSIST_CHUNK_SIZE);
    const stored = await boardStore.setValue(
      getBoardChunkKey(generation, section, chunkIndex),
      chunk
    );
    if (!stored) {
      return {
        ok: false,
        chunkCount: chunkIndex,
      };
    }
    chunkIndex += 1;
  }

  return {
    ok: true,
    chunkCount: chunkIndex,
  };
}

async function loadCommandChunks(
  generation: string,
  section: HistorySection,
  chunkCount: number,
  expectedCount: number,
  prefix = BOARD_CHUNK_KEY_PREFIX
): Promise<{ ok: boolean; commands: BoardCommand[] }> {
  if (chunkCount === 0) {
    return {
      ok: expectedCount === 0,
      commands: [],
    };
  }

  if (!generation) {
    return {
      ok: false,
      commands: [],
    };
  }

  const commands: BoardCommand[] = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunk = await boardStore.getValue(
      getBoardChunkKey(generation, section, chunkIndex, prefix)
    );
    if (!Array.isArray(chunk) || chunk.length === 0) {
      return {
        ok: false,
        commands: [],
      };
    }

    const normalizedChunk = normalizeCommands(
      chunk,
      prefix === BOARD_CHUNK_KEY_PREFIX
        ? undefined
        : `legacy-${prefix}${generation}-${section}-${chunkIndex}`
    );
    if (normalizedChunk.length !== chunk.length) {
      return {
        ok: false,
        commands: [],
      };
    }

    commands.push(...normalizedChunk);
  }

  return {
    ok: commands.length === expectedCount,
    commands,
  };
}

async function persistBoardDocument(document: BoardSnapshot): Promise<boolean> {
  const normalized = toBoardDrawing({
    ...document,
    updatedAtMs: Date.now(),
  });

  const database = await openBoardDatabase();
  if (!database) {
    return saveJson(BOARD_DRAWING_KEY, createEmbeddedBoardDrawing(normalized));
  }

  const previousDocument = createStoredDocument(await boardStore.getValue(BOARD_DRAWING_KEY));
  const previousSnapshot = createSnapshotReference(previousDocument);
  const previousBackupSnapshot = createSnapshotReference(previousDocument, { previous: true });
  const nextGeneration =
    normalized.commands.length > 0 || normalized.redoCommands.length > 0
      ? createGenerationId()
      : '';

  const historySave = await saveCommandChunks(
    nextGeneration,
    BOARD_HISTORY_SECTION,
    normalized.commands
  );
  if (!historySave.ok) {
    await deleteChunkRange(nextGeneration, BOARD_HISTORY_SECTION, historySave.chunkCount);
    return false;
  }

  const redoSave = await saveCommandChunks(
    nextGeneration,
    BOARD_REDO_SECTION,
    normalized.redoCommands
  );
  if (!redoSave.ok) {
    await deleteChunkRange(nextGeneration, BOARD_HISTORY_SECTION, historySave.chunkCount);
    await deleteChunkRange(nextGeneration, BOARD_REDO_SECTION, redoSave.chunkCount);
    return false;
  }

  const stored = await boardStore.setValue(BOARD_DRAWING_KEY, {
    version: BOARD_SCHEMA_VERSION,
    updatedAtMs: normalized.updatedAtMs,
    generation: nextGeneration,
    commandCount: normalized.commands.length,
    redoCount: normalized.redoCommands.length,
    chunkCount: historySave.chunkCount,
    redoChunkCount: redoSave.chunkCount,
    previousGeneration: previousSnapshot.generation,
    previousCommandCount: previousSnapshot.commandCount,
    previousRedoCount: previousSnapshot.redoCount,
    previousChunkCount: previousSnapshot.chunkCount,
    previousRedoChunkCount: previousSnapshot.redoChunkCount,
    commands: [],
    redoCommands: [],
  });

  if (!stored) {
    await deleteChunkRange(nextGeneration, BOARD_HISTORY_SECTION, historySave.chunkCount);
    await deleteChunkRange(nextGeneration, BOARD_REDO_SECTION, redoSave.chunkCount);
    return false;
  }

  removeStoredValue(BOARD_DRAWING_KEY);
  if (
    previousBackupSnapshot.generation &&
    previousBackupSnapshot.generation !== previousSnapshot.generation &&
    previousBackupSnapshot.generation !== nextGeneration
  ) {
    await deleteSnapshotReference(previousBackupSnapshot);
  }
  return true;
}

async function migrateLegacyBoardStorage(): Promise<void> {
  if (!boardMigrationPromise) {
    boardMigrationPromise = (async () => {
      const database = await openBoardDatabase();
      if (database && (await boardStore.getValue(BOARD_DRAWING_KEY)) !== undefined) return;
      const localCurrent = loadJson(BOARD_DRAWING_KEY);
      if (isRecord(localCurrent)) {
        if (database) await persistBoardDocument(toBoardDrawing(localCurrent));
        return;
      }
      for (const [key, prefix] of [
        [OBJECTS_BOARD_DRAWING_KEY, 'boardChunk:v4:'],
        [SHAPES_BOARD_DRAWING_KEY, 'boardChunk:v3:'],
        [PREVIOUS_BOARD_DRAWING_KEY, 'boardChunk:v2:'],
        [LEGACY_BOARD_DRAWING_KEY, 'boardChunk:'],
      ]) {
        const indexed = database ? await boardStore.getValue(key) : undefined;
        const indexedDrawing = isRecord(indexed)
          ? await hydrateStoredBoardDrawing(indexed, prefix)
          : null;
        const legacy = indexedDrawing ?? loadJson(key);
        if (isRecord(legacy)) {
          legacyMigrationDrawing = await hydrateStoredBoardDrawing(legacy, prefix);
          if (!legacyMigrationDrawing) continue;
          await persistBoardDocument(legacyMigrationDrawing);
          break;
        }
      }
      // Older metadata and chunks remain intact for old tabs and rollback.
    })();
  }
  return boardMigrationPromise;
}

async function hydratePersistedSnapshot(
  snapshot: SnapshotReference,
  prefix = BOARD_CHUNK_KEY_PREFIX
): Promise<BoardSnapshot & { ok: boolean }> {
  if (!hasPersistedSnapshot(snapshot)) {
    return {
      ok: true,
      commands: [],
      redoCommands: [],
    };
  }

  const commands = await loadCommandChunks(
    snapshot.generation,
    BOARD_HISTORY_SECTION,
    snapshot.chunkCount,
    snapshot.commandCount,
    prefix
  );
  if (!commands.ok) {
    return {
      ok: false,
      commands: [],
      redoCommands: [],
    };
  }

  const redoCommands = await loadCommandChunks(
    snapshot.generation,
    BOARD_REDO_SECTION,
    snapshot.redoChunkCount,
    snapshot.redoCount,
    prefix
  );
  if (!redoCommands.ok) {
    return {
      ok: false,
      commands: [],
      redoCommands: [],
    };
  }

  return {
    ok: true,
    commands: commands.commands,
    redoCommands: redoCommands.commands,
  };
}

async function hydrateStoredBoardDrawing(
  document: unknown,
  prefix = BOARD_CHUNK_KEY_PREFIX
): Promise<BoardDrawing | null> {
  const normalized = createStoredDocument(
    document,
    prefix === BOARD_CHUNK_KEY_PREFIX ? undefined : `legacy-${prefix}embedded`
  );

  if (!hasPersistedSnapshot(createSnapshotReference(normalized))) {
    return toBoardDrawing(normalized);
  }

  const currentSnapshot = await hydratePersistedSnapshot(
    createSnapshotReference(normalized),
    prefix
  );
  if (currentSnapshot.ok) {
    return toBoardDrawing({
      ...normalized,
      commands: currentSnapshot.commands,
      redoCommands: currentSnapshot.redoCommands,
    });
  }

  const backupReference = createSnapshotReference(normalized, { previous: true });
  if (!hasPersistedSnapshot(backupReference)) {
    return null;
  }

  const backupSnapshot = await hydratePersistedSnapshot(backupReference, prefix);
  if (backupSnapshot.ok) {
    return toBoardDrawing({
      ...normalized,
      commands: backupSnapshot.commands,
      redoCommands: backupSnapshot.redoCommands,
    });
  }

  return null;
}

export async function loadBoardDrawing(): Promise<BoardDrawing> {
  await migrateLegacyBoardStorage();

  const database = await openBoardDatabase();
  if (database) {
    const indexedValue = await boardStore.getValue(BOARD_DRAWING_KEY);
    if (isRecord(indexedValue)) {
      const hydrated = await hydrateStoredBoardDrawing(indexedValue);
      if (hydrated) return hydrated;
    }
  }

  return toBoardDrawing(
    loadJson(BOARD_DRAWING_KEY, legacyMigrationDrawing ?? createEmptyBoardDrawing())
  );
}

export function saveBoardDrawing(document: BoardSnapshot): Promise<boolean> {
  pendingSaveDocument = toBoardDrawing(document);
  const result = new Promise<boolean>((resolve) => pendingSaveResolvers.push(resolve));
  if (!saveLoopRunning) {
    saveLoopRunning = true;
    void Promise.resolve().then(async () => {
      while (pendingSaveDocument) {
        const nextDocument = pendingSaveDocument;
        const resolvers = pendingSaveResolvers;
        pendingSaveDocument = null;
        pendingSaveResolvers = [];
        let ok = false;
        try {
          ok = await persistBoardDocument(nextDocument);
        } catch {
          /* Preserve the last good snapshot. */
        }
        resolvers.forEach((resolve) => resolve(ok));
      }
      saveLoopRunning = false;
    });
  }
  return result;
}
