import { beforeEach, describe, expect, it, vi } from 'vitest';
import { textObject } from '../helpers/text-fixture.js';

function createPoint(x, y) {
  return { x, y };
}

function createStroke(index) {
  return {
    type: 'stroke',
    ...(index % 7 !== 0 ? { id: `pen-${index}` } : {}),
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

function createFakeIndexedDb({
  shouldFailPut = () => false,
  shouldAbortAfterPut = () => false,
} = {}) {
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
        oncomplete: null,
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

                const previous = records.get(key);
                records.set(key, cloneJson(value));
                resolve(undefined);
                queueMicrotask(() => {
                  if (shouldAbortAfterPut(key, value)) {
                    if (previous === undefined) records.delete(key);
                    else records.set(key, previous);
                    transaction.error = new Error('Transaction aborted after request success');
                    transaction.onabort?.();
                  } else transaction.oncomplete?.();
                });
              });
            },
            delete(key) {
              return createRequest(({ resolve }) => {
                records.delete(key);
                resolve(undefined);
                queueMicrotask(() => transaction.oncomplete?.());
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
        expect(restored).toMatchObject({ version: 4, commands: [], redoCommands: [] });
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
      localStorage.setItem(boardStorage.LEGACY_BOARD_DRAWING_KEY, JSON.stringify(legacy));

      const restored = await boardStorage.loadBoardDrawing();
      expect(restored.commands).toEqual(legacy.commands);
      expect(restored.redoCommands).toEqual(legacy.redoCommands);
      expect(restored.version).toBe(4);
      expect(JSON.parse(localStorage.getItem(boardStorage.LEGACY_BOARD_DRAWING_KEY))).toEqual(
        legacy
      );
      expect(fakeIndexedDb.__records.get(boardStorage.BOARD_DRAWING_KEY)).toMatchObject({
        version: 4,
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
      expect(await boardStorage.loadBoardDrawing()).toEqual({ ...legacy, version: 4 });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('migrates ID-less chunked v3 strokes across chunk boundaries and redo without deleting originals', async () => {
    const database = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', database);
    vi.resetModules();
    try {
      const storage = await import('../../src/board/storage.ts');
      const commands = Array.from({ length: 115 }, (_, i) => {
        const stroke = createStroke(i);
        delete stroke.id;
        return stroke;
      });
      const redo = createStroke(200);
      delete redo.id;
      const metadata = {
        version: 3,
        generation: 'v3-original',
        commandCount: 115,
        chunkCount: 2,
        redoCount: 1,
        redoChunkCount: 1,
      };
      database.__records.set(storage.SHAPES_BOARD_DRAWING_KEY, metadata);
      database.__records.set('boardChunk:v3:v3-original:history:0', commands.slice(0, 100));
      database.__records.set('boardChunk:v3:v3-original:history:1', commands.slice(100));
      database.__records.set('boardChunk:v3:v3-original:redo:0', [redo]);
      const first = await storage.loadBoardDrawing();
      expect(first.version).toBe(4);
      expect(first.commands).toHaveLength(115);
      const ids = [...first.commands, ...first.redoCommands]
        .filter((c) => c.tool === 'pen')
        .map((c) => c.id);
      expect(ids.every((id) => typeof id === 'string' && id)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect(first.commands[0].tool).toBe('eraser');
      expect((await storage.loadBoardDrawing()).commands).toEqual(first.commands);
      expect(database.__records.get(storage.SHAPES_BOARD_DRAWING_KEY)).toEqual(metadata);
      expect(database.__records.get('boardChunk:v3:v3-original:history:0')).toEqual(
        commands.slice(0, 100)
      );
      const edit = { type: 'stroke-edit', id: ids[0], translate: { x: 100, y: -20 } };
      await storage.saveBoardDrawing({
        commands: [...first.commands, edit],
        redoCommands: first.redoCommands,
      });
      expect((await storage.loadBoardDrawing()).commands.at(-1)).toEqual(edit);
      expect((await storage.loadBoardDrawing()).redoCommands).toEqual(first.redoCommands);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('loads v3 embedded strokes with stable IDs when there is no room for migration', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.resetModules();
    try {
      const storage = await import('../../src/board/storage.ts');
      const old = createStroke(1);
      delete old.id;
      const legacy = { version: 3, commands: [old], redoCommands: [old] };
      localStorage.setItem(storage.SHAPES_BOARD_DRAWING_KEY, JSON.stringify(legacy));
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      const first = await storage.loadBoardDrawing();
      expect(first.commands[0].id).toBeTruthy();
      expect(first.redoCommands[0].id).not.toBe(first.commands[0].id);
      expect((await storage.loadBoardDrawing()).commands).toEqual(first.commands);
      expect(JSON.parse(localStorage.getItem(storage.SHAPES_BOARD_DRAWING_KEY))).toEqual(legacy);
      spy.mockRestore();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it.each(['local', 'indexed'])(
    'migrates v2 text, highlighted runs and redo from %s storage without changing originals',
    async (source) => {
      const database = createFakeIndexedDb();
      vi.stubGlobal('indexedDB', database);
      vi.resetModules();
      try {
        const storage = await import('../../src/board/storage.ts');
        const object = textObject();
        object.paragraphs[0].runs[0].highlightRaw = '#fff176';
        const commands = [createStroke(1), { type: 'text-set', object }],
          redoCommands = [{ type: 'text-delete', ids: [object.id] }];
        const legacy = { version: 2, commands, redoCommands };
        if (source === 'local')
          localStorage.setItem(storage.PREVIOUS_BOARD_DRAWING_KEY, JSON.stringify(legacy));
        else {
          database.__records.set(storage.PREVIOUS_BOARD_DRAWING_KEY, {
            version: 2,
            generation: 'old-v2',
            commandCount: 2,
            chunkCount: 1,
            redoCount: 1,
            redoChunkCount: 1,
          });
          database.__records.set('boardChunk:v2:old-v2:history:0', commands);
          database.__records.set('boardChunk:v2:old-v2:redo:0', redoCommands);
        }
        const original = cloneJson([...database.__records]);
        expect(await storage.loadBoardDrawing()).toMatchObject({
          version: 4,
          commands,
          redoCommands,
        });
        for (const [key, value] of original) expect(database.__records.get(key)).toEqual(value);
        if (source === 'local')
          expect(JSON.parse(localStorage.getItem(storage.PREVIOUS_BOARD_DRAWING_KEY))).toEqual(
            legacy
          );
        expect(database.__records.get(storage.BOARD_DRAWING_KEY).version).toBe(4);
      } finally {
        vi.unstubAllGlobals();
        vi.resetModules();
      }
    }
  );

  it('retains a v2 drawing in memory when migration cannot be saved', async () => {
    const database = createFakeIndexedDb({ shouldFailPut: () => true });
    vi.stubGlobal('indexedDB', database);
    vi.resetModules();
    try {
      const storage = await import('../../src/board/storage.ts');
      const legacy = {
        version: 2,
        commands: [{ type: 'text-set', object: textObject() }],
        redoCommands: [createStroke(2)],
      };
      database.__records.set(storage.PREVIOUS_BOARD_DRAWING_KEY, legacy);
      expect(await storage.loadBoardDrawing()).toMatchObject({ ...legacy, version: 4 });
      expect(database.__records.get(storage.PREVIOUS_BOARD_DRAWING_KEY)).toEqual(legacy);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it.each([true, false])(
    'round-trips editable shapes and erasure with IndexedDB support = %s',
    async (indexed) => {
      vi.stubGlobal('indexedDB', indexed ? createFakeIndexedDb() : undefined);
      vi.resetModules();
      try {
        const storage = await import('../../src/board/storage.ts');
        const object = {
          id: 'shape-1',
          kind: 'arrow',
          start: { x: -100, y: 200 },
          end: { x: 10, y: -20 },
          size: 2,
          inkRaw: '#2563eb',
        };
        const snapshot = {
          commands: [
            { type: 'shape-set', object },
            { ...createStroke(0), erasedShapeIds: [object.id] },
          ],
          redoCommands: [
            { type: 'shape-set', object },
            { type: 'shape-delete', ids: [object.id] },
          ],
        };
        expect(await storage.saveBoardDrawing(snapshot)).toBe(true);
        expect(await storage.loadBoardDrawing()).toMatchObject(snapshot);
      } finally {
        vi.unstubAllGlobals();
        vi.resetModules();
      }
    }
  );

  it('migrates chunked version 1 records without deleting the legacy generation', async () => {
    const database = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', database);
    vi.resetModules();
    try {
      const storage = await import('../../src/board/storage.ts');
      const legacy = {
        version: 1,
        generation: 'old',
        commandCount: 1,
        redoCount: 1,
        chunkCount: 1,
        redoChunkCount: 1,
        commands: [],
        redoCommands: [],
      };
      database.__records.set(storage.LEGACY_BOARD_DRAWING_KEY, legacy);
      database.__records.set('boardChunk:old:history:0', [createStroke(1)]);
      database.__records.set('boardChunk:old:redo:0', [createStroke(2)]);
      const restored = await storage.loadBoardDrawing();
      expect(restored).toMatchObject({
        version: 4,
        commands: [createStroke(1)],
        redoCommands: [createStroke(2)],
      });
      expect(database.__records.get(storage.LEGACY_BOARD_DRAWING_KEY)).toEqual(legacy);
      expect(database.__records.get('boardChunk:old:history:0')).toEqual([createStroke(1)]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('round-trips plain and highlighted text edits and grouped erasure in history and redo', async () => {
    const database = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', database);
    vi.resetModules();
    try {
      const storage = await import('../../src/board/storage.ts');
      const highlighted = textObject({ id: 'highlighted' });
      highlighted.paragraphs[0].runs[0].highlightRaw = '#fff176';
      const snapshot = {
        commands: [
          { type: 'text-set', object: textObject() },
          { type: 'text-set', object: highlighted },
          { ...createStroke(0), erasedTextIds: ['text-1'] },
        ],
        redoCommands: [
          { type: 'text-delete', ids: ['text-1'] },
          { type: 'text-set', object: highlighted },
        ],
      };
      expect(await storage.saveBoardDrawing(snapshot)).toBe(true);
      expect(await storage.loadBoardDrawing()).toMatchObject(snapshot);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('reports a transaction abort even after the write request succeeds', async () => {
    const database = createFakeIndexedDb({
      shouldAbortAfterPut: (key) => key === 'vatio_board_drawing_v4',
    });
    vi.stubGlobal('indexedDB', database);
    vi.resetModules();
    try {
      const storage = await import('../../src/board/storage.ts');
      expect(
        await storage.saveBoardDrawing({
          commands: [{ type: 'text-set', object: textObject() }],
          redoCommands: [],
        })
      ).toBe(false);
      expect(database.__records.has(storage.BOARD_DRAWING_KEY)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('still loads legacy drawings when there is no space to persist the migrated copy', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.resetModules();
    try {
      const storage = await import('../../src/board/storage.ts');
      localStorage.setItem(
        storage.LEGACY_BOARD_DRAWING_KEY,
        JSON.stringify({ version: 1, commands: [createStroke(1)], redoCommands: [createStroke(2)] })
      );
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      expect(await storage.loadBoardDrawing()).toMatchObject({
        version: 4,
        commands: [createStroke(1)],
        redoCommands: [createStroke(2)],
      });
      expect(localStorage.getItem(storage.LEGACY_BOARD_DRAWING_KEY)).not.toBeNull();
      spy.mockRestore();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('reports localStorage quota failures and never claims a failed save succeeded', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.resetModules();
    try {
      const storage = await import('../../src/board/storage.ts');
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      expect(
        await storage.saveBoardDrawing({
          commands: [{ type: 'text-set', object: textObject() }],
          redoCommands: [],
        })
      ).toBe(false);
      spy.mockRestore();
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
        const chunkKey = `${boardStorage.BOARD_CHUNK_KEY_PREFIX}${metadata.generation}:history:1`;
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
