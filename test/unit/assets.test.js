import { Blob as BinaryBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { freshLibrary } from '../helpers/library-db.js';
import { closeLibraryDatabase, getAssetRecord } from '../../src/board/storage.ts';
import {
  saveAsset,
  readAsset,
  discardAsset,
  importImage,
  importVideo,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
} from '../../src/board/assets.ts';
let board;
beforeEach(async () => {
  board = await freshLibrary();
  vi.stubGlobal('Blob', BinaryBlob);
});
afterEach(async () => {
  await closeLibraryDatabase();
  vi.unstubAllGlobals();
});
describe('board-owned binary assets', () => {
  it('rejects malformed binary records rather than treating them as valid media', async () => {
    const { putAssetRecord } = await import('../../src/board/storage.ts');
    await expect(
      putAssetRecord({
        id: 'bad',
        boardId: board.id,
        kind: 'image',
        width: 20,
        height: 20,
        blob: { bytes: 'not binary', type: 'image/png' },
      })
    ).rejects.toThrow('archiveMissingMedia');
    expect(await readAsset('bad')).toBeNull();
  });
  it('round-trips binary media and posters without URL data and records their owner', async () => {
    const asset = {
      kind: 'video',
      width: 160,
      height: 90,
      blob: new Blob(['movie'], { type: 'video/mp4' }),
      poster: new Blob(['poster'], { type: 'image/png' }),
    };
    const id = await saveAsset(board.id, asset),
      record = await getAssetRecord(id);
    expect(record.boardId).toBe(board.id);
    expect(Object.prototype.toString.call(record.blob.bytes)).toBe('[object ArrayBuffer]');
    const restored = await readAsset(id);
    expect(await restored.blob.text()).toBe('movie');
    expect(await restored.poster.text()).toBe('poster');
    await discardAsset(id);
    expect(await readAsset(id)).toBeNull();
  });
  it('reports failed writes without returning an unusable asset identity', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('Quota');
    });
    await expect(
      saveAsset(board.id, {
        kind: 'image',
        blob: new Blob(['image'], { type: 'image/png' }),
        width: 100,
        height: 100,
      })
    ).rejects.toThrow('assetStorageFailed');
  });
  it('rejects unsupported types and oversized files before decoding', async () => {
    await expect(importImage({ type: 'image/svg+xml', size: 1 })).rejects.toThrow(
      'unsupportedMedia'
    );
    await expect(importImage({ type: 'image/png', size: IMAGE_MAX_BYTES + 1 })).rejects.toThrow(
      'imageTooLarge'
    );
    await expect(importVideo({ type: 'video/webm', size: VIDEO_MAX_BYTES + 1 })).rejects.toThrow(
      'videoTooLarge'
    );
  });
});
