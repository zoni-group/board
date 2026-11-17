import { Blob as BinaryBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ records: new Map(), available: true }));
vi.mock('../../src/shared/indexed-storage.ts', () => ({
  createIndexedJsonKeyValueStore: () => ({
    getValue: async (id) => mock.records.get(id),
    setValue: async (id, value) => {
      if (!mock.available) return false;
      mock.records.set(id, structuredClone(value));
      return true;
    },
    deleteValue: async (id) => {
      mock.records.delete(id);
      return true;
    },
  }),
}));
import {
  saveAsset,
  readAsset,
  discardAsset,
  importImage,
  importVideo,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
} from '../../src/board/assets.ts';

beforeEach(() => {
  mock.records.clear();
  mock.available = true;
  vi.stubGlobal('Blob', BinaryBlob);
});
afterEach(() => vi.unstubAllGlobals());
describe('binary local assets', () => {
  it('stores binary payloads durably and reconstructs the media and poster without URL data', async () => {
    const asset = {
      kind: 'video',
      width: 160,
      height: 90,
      blob: new Blob(['movie'], { type: 'video/mp4' }),
      poster: new Blob(['poster'], { type: 'image/png' }),
    };
    const id = await saveAsset(asset),
      record = mock.records.get(id);
    expect(Object.prototype.toString.call(record.blob.bytes)).toBe('[object ArrayBuffer]');
    expect(record.blob).not.toBeInstanceOf(Blob);
    const restored = await readAsset(id);
    expect(await restored.blob.text()).toBe('movie');
    expect(restored.blob.type).toBe('video/mp4');
    expect(await restored.poster.text()).toBe('poster');
    await discardAsset(id);
    expect(await readAsset(id)).toBeNull();
  });
  it('reports a failed write rather than returning an unusable asset identity', async () => {
    mock.available = false;
    await expect(
      saveAsset({
        kind: 'image',
        blob: new Blob(['image'], { type: 'image/png' }),
        width: 100,
        height: 100,
      })
    ).rejects.toThrow('assetStorageFailed');
    expect(mock.records.size).toBe(0);
  });
  it('rejects malformed records and accepts existing Blob records', async () => {
    mock.records.set('bad', {
      kind: 'image',
      width: 100,
      height: 100,
      blob: { bytes: 'not binary', type: 'image/png' },
    });
    expect(await readAsset('bad')).toBeNull();
    mock.records.set('blob', {
      kind: 'image',
      width: 100,
      height: 100,
      blob: new Blob(['image'], { type: 'image/png' }),
    });
    expect(await (await readAsset('blob')).blob.text()).toBe('image');
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
