import { beforeEach, describe, expect, it, vi } from 'vitest';

function createPoint(x, y) {
  return { x, y };
}

function createStroke(index) {
  return {
    type: 'stroke',
    tool: index % 7 === 0 ? 'eraser' : 'pen',
    size: 4 + (index % 6),
    inkRaw: index % 2 === 0 ? '#111827' : '#2563eb',
    points: [createPoint(index, index + 1), createPoint(index + 0.5, index + 1.5)],
  };
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createFakeIndexedDb({ shouldFailPut = () => false } = {}) {
  const records = new Map();
  const objectStoreNames = new Set();
  let putCounter = 0;
  let failPut = shouldFailPut;

  function createRequest(executor) {
    const request = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };

    queueMicrotask(() => {
      try {
        executor({
          resolve(value) {
            request.result = cloneJson(value);
            request.onsuccess?.({ target: request });
          },
          reject(error) {
            request.error = error;
            request.onerror?.({ target: request });
          },
        });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
      }
    });

    return request;
  }

  const database = {
    objectStoreNames: {
      contains(name) {
        return objectStoreNames.has(name);
      },
    },
    createObjectStore(name) {
      objectStoreNames.add(name);
      return {};
    },
    transaction() {
      const transaction = {
        onabort: null,
        error: null,
        objectStore() {
          return {
            get(key) {
              return createRequest(({ resolve }) => {
                resolve(records.has(key) ? records.get(key) : undefined);
              });
            },
            put(value, key) {
              return createRequest(({ resolve, reject }) => {
                putCounter += 1;
                if (failPut(key, cloneJson(value), putCounter)) {
                  const error = new Error(`Failed to store ${key}`);
                  transaction.error = error;
                  reject(error);
                  return;
                }

                records.set(key, cloneJson(value));
                resolve(undefined);
              });
            },
            delete(key) {
              return createRequest(({ resolve }) => {
                records.delete(key);
                resolve(undefined);
              });
            },
          };
        },
      };

      return transaction;
    },
  };

  return {
    __records: records,
    open: vi.fn(() => {
      const request = {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        try {
          request.onupgradeneeded?.({ target: request });
          request.onsuccess?.({ target: request });
        } catch (error) {
          request.error = error;
          request.onerror?.({ target: request });
        }
      });

      return request;
    }),
    setShouldFailPut(nextShouldFailPut) {
      failPut = nextShouldFailPut;
    },
  };
}

function createFailingIndexedDb({ blocked = false } = {}) {
  return {
    open: vi.fn(() => {
      const request = {
        result: null,
        error: new Error(blocked ? 'IndexedDB is blocked' : 'IndexedDB open failed'),
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        if (blocked) {
          request.onblocked?.({ target: request });
          return;
        }

        request.onerror?.({ target: request });
      });

      return request;
    }),
  };
}

describe('board storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(['null', '42', '[]', '"invalid"', '{broken', '{"commands":null,"redoCommands":42}'])(
    'loads malformed local records safely: %s',
    async (raw) => {
      vi.stubGlobal('indexedDB', undefined);
      vi.resetModules();
      try {
        const boardStorage = await import('../../src/board/storage.ts');
        localStorage.setItem(boardStorage.BOARD_DRAWING_KEY, raw);
        const restored = await boardStorage.loadBoardDrawing();
        expect(restored).toMatchObject({ version: 1, commands: [], redoCommands: [] });
        expect(Number.isFinite(restored.updatedAtMs)).toBe(true);
      } finally {
        vi.unstubAllGlobals();
        vi.resetModules();
      }
    }
  );

  it('captures an independent snapshot before asynchronous saving', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.resetModules();
    try {
      const boardStorage = await import('../../src/board/storage.ts');
      const stroke = createStroke(1);
      const original = cloneJson(stroke);
      const snapshot = { commands: [stroke], redoCommands: [createStroke(2)] };
      const saving = boardStorage.saveBoardDrawing(snapshot);
      stroke.points[0].x = 999;
      snapshot.commands.push(createStroke(3));
      snapshot.redoCommands.length = 0;
      await saving;

      const restored = await boardStorage.loadBoardDrawing();
      expect(restored.commands).toEqual([original]);
      expect(restored.redoCommands).toEqual([createStroke(2)]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('migrates existing version 1 local drawings and redo history into IndexedDB', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', fakeIndexedDb);
    vi.resetModules();
    try {
      const boardStorage = await import('../../src/board/storage.ts');
      const commands = [
        ...Array.from({ length: 105 }, (_, index) => createStroke(index)),
        { type: 'clear' },
      ];
      const legacy = { version: 1, updatedAtMs: 1, commands, redoCommands: [createStroke(200)] };
      localStorage.setItem(boardStorage.BOARD_DRAWING_KEY, JSON.stringify(legacy));

      const restored = await boardStorage.loadBoardDrawing();
      expect(restored.commands).toEqual(legacy.commands);
      expect(restored.redoCommands).toEqual(legacy.redoCommands);
      expect(restored.version).toBe(1);
      expect(localStorage.getItem(boardStorage.BOARD_DRAWING_KEY)).toBeNull();
      expect(fakeIndexedDb.__records.get(boardStorage.BOARD_DRAWING_KEY)).toMatchObject({
        version: 1,
        commandCount: 106,
        chunkCount: 2,
        redoCount: 1,
      });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('uses the local fallback when indexed metadata has an invalid shape', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', fakeIndexedDb);
    vi.resetModules();
    try {
      const boardStorage = await import('../../src/board/storage.ts');
      fakeIndexedDb.__records.set(boardStorage.BOARD_DRAWING_KEY, 42);
      const legacy = { version: 1, updatedAtMs: 1, commands: [createStroke(1)], redoCommands: [] };
      localStorage.setItem(boardStorage.BOARD_DRAWING_KEY, JSON.stringify(legacy));
      expect(await boardStorage.loadBoardDrawing()).toEqual(legacy);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('preserves large drawings in IndexedDB-backed chunks', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createFakeIndexedDb();

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });
    vi.resetModules();

    try {
      const boardStorage = await import('../../src/board/storage.ts');
      const commands = Array.from(
        { length: boardStorage.BOARD_PERSIST_CHUNK_SIZE + 45 },
        (_, index) => createStroke(index)
      );

      await boardStorage.saveBoardDrawing({
        commands,
        redoCommands: [createStroke(999)],
      });

      const restored = await boardStorage.loadBoardDrawing();

      expect(restored.commands).toHaveLength(commands.length);
      expect(restored.redoCommands).toHaveLength(1);
      expect(restored.commands[0]).toMatchObject({
        type: 'stroke',
        points: [createPoint(0, 1), createPoint(0.5, 1.5)],
      });
      expect(restored.commands[commands.length - 1]).toMatchObject({
        points: [
          createPoint(commands.length - 1, commands.length),
          createPoint(commands.length - 0.5, commands.length + 0.5),
        ],
      });
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });

  it('keeps the last good snapshot when a later chunked save fails', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createFakeIndexedDb();

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: fakeIndexedDb,
    });
    vi.resetModules();

    try {
      const boardStorage = await import('../../src/board/storage.ts');
      const initialCommands = Array.from({ length: 150 }, (_, index) => createStroke(index));
      const updatedCommands = Array.from({ length: 260 }, (_, index) => createStroke(index));

      await boardStorage.saveBoardDrawing({
        commands: initialCommands,
        redoCommands: [],
      });

      fakeIndexedDb.setShouldFailPut((key) => key.includes(':history:1'));

      await boardStorage.saveBoardDrawing({
        commands: updatedCommands,
        redoCommands: [createStroke(1234)],
      });

      const restored = await boardStorage.loadBoardDrawing();

      expect(restored.commands).toHaveLength(initialCommands.length);
      expect(restored.redoCommands).toEqual([]);
      expect(restored.commands[initialCommands.length - 1]).toMatchObject({
        points: [createPoint(149, 150), createPoint(149.5, 150.5)],
      });
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });

  it('falls back to embedded local storage when IndexedDB cannot be opened', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const failingIndexedDb = createFailingIndexedDb();

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: failingIndexedDb,
    });
    vi.resetModules();

    try {
      const boardStorage = await import('../../src/board/storage.ts');
      localStorage.setItem(
        boardStorage.BOARD_DRAWING_KEY,
        JSON.stringify({
          version: boardStorage.BOARD_SCHEMA_VERSION,
          updatedAtMs: 1,
          generation: '',
          commandCount: 1,
          redoCount: 0,
          chunkCount: 0,
          redoChunkCount: 0,
          commands: [createStroke(1)],
          redoCommands: [],
        })
      );

      const restoredLegacy = await boardStorage.loadBoardDrawing();
      expect(restoredLegacy.commands).toHaveLength(1);

      await boardStorage.saveBoardDrawing({
        commands: [createStroke(1), createStroke(2)],
        redoCommands: [createStroke(3)],
      });

      const embeddedSnapshot = JSON.parse(localStorage.getItem(boardStorage.BOARD_DRAWING_KEY));
      expect(embeddedSnapshot.commandCount).toBe(2);
      expect(embeddedSnapshot.redoCount).toBe(1);
      expect(embeddedSnapshot.commands).toHaveLength(2);
      expect(embeddedSnapshot.redoCommands).toHaveLength(1);

      const restored = await boardStorage.loadBoardDrawing();
      expect(restored.commands).toHaveLength(2);
      expect(restored.redoCommands).toHaveLength(1);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      vi.resetModules();
    }
  });

  it.each(['missing', 'malformed'])(
    'falls back to the previous indexed snapshot when the latest chunk is %s',
    async (corruption) => {
      const originalIndexedDb = globalThis.indexedDB;
      const fakeIndexedDb = createFakeIndexedDb();

      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: fakeIndexedDb,
      });
      vi.resetModules();

      try {
        const boardStorage = await import('../../src/board/storage.ts');
        const firstCommands = Array.from({ length: 145 }, (_, index) => createStroke(index));
        const secondCommands = Array.from({ length: 255 }, (_, index) => createStroke(index + 500));

        await boardStorage.saveBoardDrawing({
          commands: firstCommands,
          redoCommands: [createStroke(900)],
        });
        await boardStorage.saveBoardDrawing({
          commands: secondCommands,
          redoCommands: [createStroke(901), createStroke(902)],
        });

        const metadata = fakeIndexedDb.__records.get(boardStorage.BOARD_DRAWING_KEY);
        expect(metadata.previousGeneration).toBeTruthy();
        const chunkKey = `boardChunk:${metadata.generation}:history:1`;
        if (corruption === 'missing') {
          fakeIndexedDb.__records.delete(chunkKey);
        } else {
          fakeIndexedDb.__records.set(chunkKey, [
            { type: 'stroke', points: [{ x: 'invalid', y: 1 }] },
          ]);
        }

        const restored = await boardStorage.loadBoardDrawing();
        expect(restored.commands).toHaveLength(firstCommands.length);
        expect(restored.redoCommands).toHaveLength(1);
        expect(restored.commands[firstCommands.length - 1]).toMatchObject({
          points: [createPoint(144, 145), createPoint(144.5, 145.5)],
        });
        expect(restored.redoCommands[0]).toMatchObject({
          points: [createPoint(900, 901), createPoint(900.5, 901.5)],
        });
      } finally {
        Object.defineProperty(globalThis, 'indexedDB', {
          configurable: true,
          writable: true,
          value: originalIndexedDb,
        });
        vi.resetModules();
      }
    }
  );
});
