import { Blob as BinaryBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshLibrary } from '../helpers/library-db.js';
import { imageObject, tableObject } from '../helpers/content-fixture.js';
import { textObject } from '../helpers/text-fixture.js';
import { exportBoards, readBoardArchive, importBoards } from '../../src/board/board-files.ts';
import { saveAsset } from '../../src/board/assets.ts';
import {
  closeLibraryDatabase,
  createBoard,
  getBoardLibrary,
  getAssetRecord,
  loadBoardDrawing,
  saveBoardDrawing,
  updateBoardBackground,
} from '../../src/board/storage.ts';
let first;
beforeEach(async () => {
  first = await freshLibrary();
  vi.stubGlobal('Blob', BinaryBlob);
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(async () => {
  await closeLibraryDatabase();
  vi.unstubAllGlobals();
});
async function fixture() {
  const imageId = await saveAsset(first.id, {
    kind: 'image',
    width: 200,
    height: 100,
    blob: new Blob(['image pixels'], { type: 'image/png' }),
  });
  const videoId = await saveAsset(first.id, {
    kind: 'video',
    width: 160,
    height: 90,
    blob: new Blob(['movie'], { type: 'video/mp4' }),
    poster: new Blob(['poster'], { type: 'image/png' }),
  });
  const image = { ...imageObject(), assetId: imageId },
    video = {
      ...imageObject(),
      kind: 'video',
      id: 'video-1',
      source: { kind: 'local', assetId: videoId },
    };
  return saveBoardDrawing(
    first.id,
    {
      commands: [
        {
          type: 'stroke',
          tool: 'pen',
          id: 'pen',
          points: [
            { x: 10, y: 20 },
            { x: 100, y: 20 },
          ],
          size: 8,
          inkRaw: '#111827',
        },
        { type: 'stroke', tool: 'eraser', points: [{ x: 50, y: 20 }], size: 20, inkRaw: '#111827' },
        { type: 'stroke-edit', id: 'pen', translate: { x: -50, y: 30 } },
        { type: 'content-set', object: image },
        { type: 'content-set', object: image },
        { type: 'content-set', object: video },
        { type: 'content-set', object: tableObject() },
        { type: 'text-set', object: textObject() },
        {
          type: 'shape-set',
          object: {
            id: 'shape',
            kind: 'arrow',
            start: { x: 0, y: 0 },
            end: { x: 100, y: 100 },
            size: 6,
            inkRaw: '#2563eb',
          },
        },
        { type: 'content-delete', ids: [image.id] },
      ],
      redoCommands: [{ type: 'clear' }],
      viewport: { center: { x: -120, y: 40 }, zoom: 0.75 },
      draft: null,
    },
    0
  );
}
async function altered(blob, mutate) {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  mutate(entries, manifest);
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  entries['manifest.sha256'] = strToU8(
    Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', entries['manifest.json'])))
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
  return new Blob([zipSync(entries, { level: 0 })]);
}

describe('current portable board format', () => {
  it('preserves full editable history, masks, marks, camera, and binary media, deduplicating references', async () => {
    const board = await fixture(),
      blob = await exportBoards([board], board.id);
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(entries)).toHaveLength(5); // source image, video, poster, manifest, checksum
    const prepared = await readBoardArchive(blob),
      copy = prepared.boards[0];
    expect(copy.id).not.toBe(board.id);
    expect(copy.viewport).toEqual(board.viewport);
    expect(copy.redoCommands).toEqual(board.redoCommands);
    expect(copy.commands.slice(0, 3)).toEqual(board.commands.slice(0, 3));
    expect(copy.commands[3].object.assetId).not.toBe(board.commands[3].object.assetId);
    expect(copy.commands[3].object.assetId).toBe(copy.commands[4].object.assetId);
    expect(prepared.assets.every((a) => a.boardId === copy.id)).toBe(true);
    expect(
      new TextDecoder().decode(prepared.assets.find((a) => a.kind === 'video').blob.bytes)
    ).toBe('movie');
    expect((await getBoardLibrary()).boards).toHaveLength(1);
  });
  it('exports every page and remaps media that only a closed page uses', async () => {
    const imageId = await saveAsset(first.id, {
      kind: 'image',
      width: 20,
      height: 10,
      blob: new Blob(['page two'], { type: 'image/png' }),
    });
    const image = { ...imageObject(), assetId: imageId };
    const stroke = {
      type: 'stroke',
      tool: 'pen',
      id: 'one',
      points: [{ x: 1, y: 2 }],
      size: 4,
      inkRaw: '#111827',
    };
    const board = await saveBoardDrawing(
      first.id,
      {
        commands: [stroke],
        redoCommands: [],
        viewport: null,
        draft: null,
        pages: [
          { id: 'page-1', commands: [], redoCommands: [], viewport: null },
          {
            id: 'two',
            commands: [{ type: 'content-set', object: image }],
            redoCommands: [],
            viewport: { center: { x: 5, y: 6 }, zoom: 1.5 },
          },
        ],
        pageIndex: 0,
      },
      0
    );
    const blob = await exportBoards([board], board.id);
    const manifest = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['manifest.json'])
    );
    expect(manifest.boards[0].version).toBe(2);
    expect(manifest.boards[0].pages[0]).toEqual({ id: 'page-1' });
    const prepared = await readBoardArchive(blob),
      copy = prepared.boards[0];
    expect(copy.commands).toEqual([stroke]);
    expect(copy.pages).toHaveLength(2);
    expect(copy.pages[1].viewport).toEqual({ center: { x: 5, y: 6 }, zoom: 1.5 });
    const newId = copy.pages[1].commands[0].object.assetId;
    expect(newId).not.toBe(imageId);
    expect(prepared.assets.map((asset) => asset.id)).toEqual([newId]);
  });
  it('exports media referenced only inside a batch and remaps it on import', async () => {
    const assetId = await saveAsset(first.id, {
      kind: 'image',
      width: 200,
      height: 100,
      blob: new Blob(['grouped pixels'], { type: 'image/png' }),
    });
    const image = { ...imageObject(), assetId };
    const moved = { ...image, position: { x: image.position.x + 40, y: image.position.y } };
    const board = await saveBoardDrawing(
      first.id,
      {
        commands: [
          {
            type: 'batch',
            commands: [
              { type: 'content-set', object: moved },
              { type: 'text-set', object: textObject() },
            ],
          },
        ],
        redoCommands: [],
        viewport: null,
        draft: null,
      },
      0
    );
    const prepared = await readBoardArchive(await exportBoards([board], board.id));
    const [batch] = prepared.boards[0].commands;
    expect(batch.type).toBe('batch');
    expect(batch.commands[0].object.assetId).not.toBe(assetId);
    expect(prepared.assets.map((asset) => asset.id)).toEqual([batch.commands[0].object.assetId]);
    expect(batch.commands[1]).toEqual(board.commands[0].commands[1]);
  });
  it('imports all boards as independent copies and restores the exported active board', async () => {
    const a = await fixture(),
      b = await createBoard('Lesson B'),
      blob = await exportBoards([a, b], b.id);
    const copy = await importBoards(blob);
    expect(copy.name).toBe('Lesson B (2)');
    expect(copy.id).not.toBe(b.id);
    expect((await getBoardLibrary()).boards).toHaveLength(4);
    await importBoards(blob);
    expect((await getBoardLibrary()).boards).toHaveLength(6);
    expect((await loadBoardDrawing(a.id)).commands).toEqual(a.commands);
  });
  it("carries each board's page background through export and import", async () => {
    const lesson = await createBoard('Graph paper');
    const grid = { pattern: 'grid', spacing: 'large', color: 'green' };
    await updateBoardBackground(lesson.id, grid);
    const board = await loadBoardDrawing(lesson.id);
    const prepared = await readBoardArchive(await exportBoards([board], board.id));
    expect(prepared.boards[0].background).toEqual(grid);
    const copy = await importBoards(await exportBoards([board], board.id));
    expect((await loadBoardDrawing(copy.id)).background).toEqual(grid);
  });
  it('rejects corruption, missing entries, unsupported versions, and truncated archives before publication', async () => {
    const board = await fixture(),
      blob = await exportBoards([board], board.id);
    const missing = await altered(blob, (entries) => {
      delete entries[Object.keys(entries).find((k) => k.startsWith('assets/'))];
    });
    const corrupt = await altered(blob, (entries) => {
      const key = Object.keys(entries).find((k) => k.startsWith('assets/'));
      entries[key] = strToU8('corrupt');
    });
    const future = await altered(blob, (_, manifest) => (manifest.version = 2));
    for (const bad of [
      missing,
      corrupt,
      future,
      blob.slice(0, blob.size - 5),
      new Blob(['not zip']),
    ]) {
      await expect(importBoards(bad)).rejects.toThrow();
      expect((await getBoardLibrary()).boards).toHaveLength(1);
    }
  });
  it('aborts cleanly and reports missing local media during export', async () => {
    const board = await fixture(),
      blob = await exportBoards([board], board.id),
      controller = new AbortController();
    controller.abort();
    await expect(importBoards(blob, { signal: controller.signal })).rejects.toThrow('Cancelled');
    const bad = {
      ...board,
      commands: [
        ...board.commands,
        { type: 'content-set', object: { ...imageObject(), id: 'missing', assetId: 'missing' } },
      ],
    };
    await expect(exportBoards([bad], bad.id)).rejects.toThrow('archiveMissingMedia');
    expect(await getAssetRecord('missing')).toBeUndefined();
  });
});
