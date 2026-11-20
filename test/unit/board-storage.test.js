import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { freshLibrary, rawDatabase } from '../helpers/library-db.js';
import {
  initializeLibrary,
  getBoardLibrary,
  createBoard,
  deleteBoard,
  renameBoard,
  setActiveBoard,
  loadBoardDrawing,
  saveBoardDrawing,
  createBoardSession,
  putAssetRecord,
  getAssetRecord,
  importBoardRecords,
  emptyBoard,
  closeLibraryDatabase,
  updateBoardBackground,
  normalizeBoardDocument,
  toStoredBoard,
} from '../../src/board/storage.ts';
import { textObject } from '../helpers/text-fixture.js';
let first;
beforeEach(async () => {
  first = await freshLibrary();
});
afterEach(async () => {
  await closeLibraryDatabase();
  vi.unstubAllGlobals();
});
const state = (extra = {}) => ({
  commands: [],
  redoCommands: [],
  viewport: null,
  draft: null,
  ...extra,
});
const stroke = {
  type: 'stroke',
  tool: 'pen',
  id: 's',
  size: 6,
  inkRaw: '#111827',
  points: [{ x: 20, y: 30 }],
};

describe('fresh board library', () => {
  it('preserves full-length names and keeps generated duplicate names within the limit', async () => {
    const name = 'n'.repeat(100),
      original = await createBoard(name),
      copy = await createBoard(name);
    expect(original.name).toBe(name);
    expect(copy.name).toHaveLength(100);
    expect(copy.name.endsWith(' (2)')).toBe(true);
  });
  it('does not advance revisions for unchanged sessions or invalidate another tab unnecessarily', async () => {
    const error = vi.fn(),
      a = createBoardSession(first, error),
      b = createBoardSession(first, error);
    expect(await a.save()).toBe(true);
    expect((await loadBoardDrawing(first.id)).revision).toBe(0);
    b.update(state({ commands: [stroke] }));
    expect(await b.save()).toBe(true);
    expect(await a.save()).toBe(true);
    expect(error).not.toHaveBeenCalled();
    a.update(state({ commands: [{ ...stroke, id: 'other' }] }));
    expect(await a.save()).toBe(false);
    expect((await loadBoardDrawing(first.id)).commands).toEqual([stroke]);
  });
  it('creates one blank current board and reopens it without migration', async () => {
    localStorage.setItem('vatio_board_drawing_v5', JSON.stringify({ commands: [stroke] }));
    expect((await initializeLibrary()).id).toBe(first.id);
    expect(first).toMatchObject({ name: 'Board 1', commands: [], redoCommands: [], revision: 0 });
    expect((await getBoardLibrary()).boards).toHaveLength(1);
  });
  it('creates, renames and reopens independent boards and their full state', async () => {
    const draft = { token: 'draft', object: textObject(), original: null };
    const saved = await saveBoardDrawing(
      first.id,
      state({
        commands: [stroke],
        redoCommands: [{ type: 'clear' }],
        viewport: { center: { x: -30, y: 50 }, zoom: 2 },
        draft,
      }),
      0
    );
    const second = await createBoard();
    expect(second.name).toBe('Board 2');
    expect(second.commands).toEqual([]);
    await renameBoard(first.id, '  Lesson A  ');
    await setActiveBoard(first.id);
    expect(await initializeLibrary()).toEqual({ ...saved, name: 'Lesson A' });
    expect((await loadBoardDrawing(second.id)).commands).toEqual([]);
  });
  it('keeps a page background per board without advancing the drawing revision', async () => {
    expect(first.background).toEqual({ pattern: 'blank', spacing: 'medium', color: 'auto' });
    const grid = { pattern: 'grid', spacing: 'small', color: 'cream' };
    expect(await updateBoardBackground(first.id, grid)).toEqual(grid);
    const loaded = await loadBoardDrawing(first.id);
    expect(loaded.background).toEqual(grid);
    expect(loaded.revision).toBe(first.revision);
    // A drawing save from an open session keeps the stored background.
    const saved = await saveBoardDrawing(first.id, state({ commands: [stroke] }), 0);
    expect(saved.background).toEqual(grid);
    const second = await createBoard();
    expect(second.background.pattern).toBe('blank');
    await expect(updateBoardBackground('missing', grid)).rejects.toThrow('boardDeleted');
  });
  it('loads boards stored without a background, or with an invalid one, using the default', () => {
    const { background, ...stored } = emptyBoard('Old');
    expect(background.pattern).toBe('blank');
    expect(normalizeBoardDocument(stored).background).toEqual({
      pattern: 'blank',
      spacing: 'medium',
      color: 'auto',
    });
    expect(
      normalizeBoardDocument({ ...stored, background: { pattern: 'stripes', color: 'black' } })
        .background
    ).toEqual({ pattern: 'blank', spacing: 'medium', color: 'black' });
  });
  it('serializes concurrent catalog updates rather than losing newly created boards', async () => {
    const boards = await Promise.all([createBoard(), createBoard(), createBoard()]);
    expect(new Set(boards.map((b) => b.name)).size).toBe(3);
    expect((await getBoardLibrary()).boards).toHaveLength(4);
  });
  it('rejects stale writes and cannot resurrect a deleted board', async () => {
    await saveBoardDrawing(first.id, state({ commands: [stroke] }), 0);
    await expect(saveBoardDrawing(first.id, state(), 0)).rejects.toThrow('boardConflict');
    expect((await loadBoardDrawing(first.id)).commands).toEqual([stroke]);
    await deleteBoard(first.id);
    await expect(saveBoardDrawing(first.id, state(), 1)).rejects.toThrow('boardDeleted');
    expect((await getBoardLibrary()).boards[0].id).not.toBe(first.id);
  });
  it('uses atomic rollback when a save fails after another record was written', async () => {
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      if (this.name === 'meta') throw new DOMException('Full', 'QuotaExceededError');
      return original.apply(this, args);
    });
    await expect(saveBoardDrawing(first.id, state({ commands: [stroke] }), 0)).rejects.toThrow();
    expect((await loadBoardDrawing(first.id)).commands).toEqual([]);
    expect((await getBoardLibrary()).boards[0].revision).toBe(0);
  });
  it('reports transaction aborts after a write request succeeds', async () => {
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      const request = original.apply(this, args);
      if (this.name === 'boards')
        request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(saveBoardDrawing(first.id, state({ commands: [stroke] }), 0)).rejects.toThrow();
    expect((await loadBoardDrawing(first.id)).commands).toEqual([]);
  });
  it('deletes only the target board and its owned media, creating a blank board when necessary', async () => {
    const second = await createBoard();
    for (const [id, boardId] of [
      ['a', first.id],
      ['b', second.id],
    ])
      await putAssetRecord({
        id,
        boardId,
        kind: 'image',
        width: 1,
        height: 1,
        blob: { bytes: new ArrayBuffer(1), type: 'image/png' },
      });
    await deleteBoard(first.id);
    expect(await getAssetRecord('a')).toBeUndefined();
    expect(await getAssetRecord('b')).toBeDefined();
    expect((await initializeLibrary()).id).toBe(second.id);
    const replacement = await deleteBoard(second.id);
    expect(replacement.id).not.toBe(second.id);
    expect(replacement.commands).toEqual([]);
    expect((await getBoardLibrary()).boards).toHaveLength(1);
    await expect(
      putAssetRecord({
        id: 'late',
        boardId: second.id,
        kind: 'image',
        width: 1,
        height: 1,
        blob: { bytes: new ArrayBuffer(1), type: 'image/png' },
      })
    ).rejects.toThrow('boardDeleted');
  });
  it('does not replace malformed documents or accept another document version', async () => {
    const db = await rawDatabase();
    await new Promise((resolve) => {
      const tx = db.transaction('boards', 'readwrite');
      tx.objectStore('boards').put({ ...first, version: 3 });
      tx.oncomplete = resolve;
    });
    db.close();
    await expect(initializeLibrary()).rejects.toThrow('invalidLibrary');
    expect((await getBoardLibrary()).boards).toHaveLength(1);
  });
  it('commits imported boards and media together and rolls back on failure or cancellation', async () => {
    const imported = emptyBoard('Board 1'),
      asset = {
        id: 'imported',
        boardId: imported.id,
        kind: 'image',
        width: 1,
        height: 1,
        blob: { bytes: new ArrayBuffer(1), type: 'image/png' },
      };
    const original = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (...args) {
      if (this.name === 'assets') throw new Error('Full');
      return original.apply(this, args);
    });
    await expect(importBoardRecords([imported], [asset], imported.id)).rejects.toThrow();
    expect((await getBoardLibrary()).boards).toHaveLength(1);
    expect(await getAssetRecord(asset.id)).toBeUndefined();
    spy.mockRestore();
    const controller = new AbortController();
    controller.abort();
    await expect(
      importBoardRecords([imported], [asset], imported.id, controller.signal)
    ).rejects.toThrow();
    await importBoardRecords([imported], [asset], imported.id);
    expect((await initializeLibrary()).name).toBe('Board 1 (2)');
    expect(await getAssetRecord(asset.id)).toBeDefined();
  });
  it('keeps separate queues and preserves newer pending state while a save is in progress', async () => {
    const second = await createBoard(),
      a = createBoardSession(first, () => {}),
      b = createBoardSession(second, () => {});
    a.update(state({ commands: [stroke] }));
    const saving = a.save();
    a.update({ commands: [stroke, { type: 'clear' }] });
    const later = a.save();
    b.update(state({ commands: [{ type: 'text-set', object: textObject() }] }));
    expect(await b.save()).toBe(true);
    expect(await saving).toBe(true);
    expect(await later).toBe(true);
    await a.flush();
    expect((await loadBoardDrawing(first.id)).commands).toEqual([stroke, { type: 'clear' }]);
    expect((await loadBoardDrawing(second.id)).commands[0].type).toBe('text-set');
  });
});

describe('lesson pages', () => {
  const page = (id, commands = [], viewport = null) => ({
    id,
    commands,
    redoCommands: [],
    viewport,
  });
  async function storedRecord(id) {
    const db = await rawDatabase();
    const value = await new Promise((resolve) => {
      const request = db.transaction('boards').objectStore('boards').get(id);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return value;
  }

  it('loads a flat board as its only page and keeps one-page boards flat', async () => {
    expect(first.pages).toEqual([page('page-1')]);
    expect(first.pageIndex).toBe(0);
    await saveBoardDrawing(first.id, state({ commands: [stroke] }), 0);
    const record = await storedRecord(first.id);
    expect(record.version).toBe(1);
    expect(record.pages).toBeUndefined();
    expect((await loadBoardDrawing(first.id)).pages[0].commands).toEqual([stroke]);
  });

  it('saves several pages as version 2, with the open page only in the flat fields', async () => {
    const other = { ...stroke, id: 'other' };
    const view = { center: { x: 10, y: 20 }, zoom: 2 };
    await saveBoardDrawing(
      first.id,
      state({
        commands: [other],
        pages: [page('page-1', [stroke], view), page('b')],
        pageIndex: 1,
      }),
      0
    );
    const record = await storedRecord(first.id);
    expect(record.version).toBe(2);
    expect(record.pageIndex).toBe(1);
    expect(record.pages).toEqual([page('page-1', [stroke], view), { id: 'b' }]);
    const loaded = await loadBoardDrawing(first.id);
    expect(loaded.commands).toEqual([other]);
    expect(loaded.pages).toEqual([page('page-1', [stroke], view), page('b', [other])]);
  });

  it('keeps the other pages when only the open page is saved', async () => {
    await saveBoardDrawing(
      first.id,
      state({ pages: [page('page-1', [stroke]), page('b')], pageIndex: 1 }),
      0
    );
    const other = { ...stroke, id: 'other' };
    await saveBoardDrawing(first.id, state({ commands: [other] }), 1);
    const loaded = await loadBoardDrawing(first.id);
    expect(loaded.pageIndex).toBe(1);
    expect(loaded.pages.map((p) => p.commands)).toEqual([[stroke], [other]]);
  });

  it('clamps the page index and rejects broken page lists', () => {
    const stored = toStoredBoard({ ...first, pages: [page('page-1'), page('b')], pageIndex: 1 });
    expect(normalizeBoardDocument({ ...stored, pageIndex: 9 }).pageIndex).toBe(1);
    expect(normalizeBoardDocument({ ...stored, pages: [] })).toBeNull();
    expect(normalizeBoardDocument({ ...stored, pages: undefined })).toBeNull();
    expect(normalizeBoardDocument({ ...stored, pages: [page('a'), page('a')] })).toBeNull();
    expect(
      normalizeBoardDocument({ ...stored, pages: [page('a', [{ type: 'nope' }]), { id: 'b' }] })
    ).toBeNull();
  });

  it('a session saves when only the page list changes', async () => {
    const session = createBoardSession(first, () => {});
    session.update({ pages: [page('page-1'), page('b')], pageIndex: 1 });
    expect(await session.save()).toBe(true);
    expect((await loadBoardDrawing(first.id)).pages).toHaveLength(2);
    expect(session.record.version).toBe(2);
  });
});
