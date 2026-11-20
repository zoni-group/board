import { getAssetRecord, putAssetRecord, deleteAssetRecord } from './storage.ts';
import type { BinaryAsset } from './storage.ts';
import type { ContentObject } from './model.ts';
import { IMAGE_TYPES, VIDEO_TYPES, assetIdFor } from './model.ts';
export { assetIdFor };
export { IMAGE_TYPES, VIDEO_TYPES } from './model.ts';

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export interface BoardAsset {
  kind: 'image' | 'video';
  blob: Blob;
  poster?: Blob;
  width: number;
  height: number;
}
function storedBlob(value: unknown): Blob | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as BinaryAsset;
  return Object.prototype.toString.call(data.bytes) === '[object ArrayBuffer]' &&
    typeof data.type === 'string'
    ? new Blob([data.bytes], { type: data.type })
    : null;
}

export async function readAsset(id: string): Promise<BoardAsset | null> {
  const value = await getAssetRecord(id).catch(() => undefined);
  if (!value || typeof value !== 'object') return null;
  const asset = value;
  const blob = storedBlob(asset.blob),
    poster = storedBlob(asset.poster);
  return (asset.kind === 'image' || asset.kind === 'video') &&
    blob &&
    typeof asset.width === 'number' &&
    typeof asset.height === 'number' &&
    Number.isFinite(asset.width) &&
    asset.width > 0 &&
    Number.isFinite(asset.height) &&
    asset.height > 0
    ? {
        kind: asset.kind,
        blob,
        width: asset.width,
        height: asset.height,
        ...(poster ? { poster } : {}),
      }
    : null;
}
export async function saveAsset(boardId: string, asset: BoardAsset): Promise<string> {
  const id = crypto.randomUUID();
  // Buffers avoid file-backed Blob failures in some IndexedDB implementations.
  // They remain binary local data; object URLs and base64 never enter history or storage.
  const binary = async (blob: Blob): Promise<BinaryAsset> => ({
    bytes: await blob.arrayBuffer(),
    type: blob.type,
  });
  const record = {
    kind: asset.kind,
    width: asset.width,
    height: asset.height,
    id,
    boardId,
    blob: await binary(asset.blob),
    ...(asset.poster ? { poster: await binary(asset.poster) } : {}),
  };
  try {
    await putAssetRecord(record);
  } catch {
    throw new Error('assetStorageFailed');
  }
  return id;
}
export const discardAsset = (id: string) => deleteAssetRecord(id);

export function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob),
      image = new Image();
    const timer = window.setTimeout(() => finish(false), 15000);
    function finish(ok: boolean) {
      window.clearTimeout(timer);
      image.onload = image.onerror = null;
      URL.revokeObjectURL(url);
      if (ok && image.naturalWidth && image.naturalHeight) resolve(image);
      else reject(new Error('unsupportedMedia'));
    }
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('unsupportedMedia'))),
      'image/png'
    )
  );
}
export async function importImage(file: File): Promise<BoardAsset> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('unsupportedMedia');
  if (file.size > IMAGE_MAX_BYTES) throw new Error('imageTooLarge');
  const image = await imageFromBlob(file);
  const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  if (scale === 1) return { kind: 'image', blob: file, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('unsupportedMedia');
  ctx.drawImage(image, 0, 0, width, height);
  return { kind: 'image', blob: await canvasBlob(canvas), width, height };
}
export async function importVideo(file: File): Promise<BoardAsset> {
  if (!VIDEO_TYPES.includes(file.type)) throw new Error('unsupportedMedia');
  if (file.size > VIDEO_MAX_BYTES) throw new Error('videoTooLarge');
  const video = document.createElement('video');
  if (!video.canPlayType(file.type)) throw new Error('unsupportedMedia');
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const asset = await new Promise<BoardAsset>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => finish(true), 12000);
      function finish(error?: boolean) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error || !video.videoWidth || !video.videoHeight) reject(new Error('unsupportedMedia'));
        else
          resolve({
            kind: 'video',
            blob: file,
            width: video.videoWidth,
            height: video.videoHeight,
          });
      }
      video.onerror = () => finish(true);
      video.onloadeddata = () => finish();
      video.src = url;
      video.load();
    });
    if (video.readyState >= 2) {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / Math.max(asset.width, asset.height));
      canvas.width = Math.max(1, Math.round(asset.width * scale));
      canvas.height = Math.max(1, Math.round(asset.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          asset.poster = await canvasBlob(canvas);
        } catch {
          /* Generic card is still usable. */
        }
      }
    }
    return asset;
  } finally {
    video.onloadeddata = video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Decoded images are retained only for live board objects, not their entire undo history. */
export function createAssetCache(changed: () => void) {
  const entries = new Map<string, { image: HTMLImageElement | null; promise: Promise<void> }>();
  function ensure(id: string): Promise<void> {
    const existing = entries.get(id);
    if (existing) return existing.promise;
    const entry = { image: null as HTMLImageElement | null, promise: Promise.resolve() };
    entries.set(id, entry);
    entry.promise = (async () => {
      try {
        const asset = await readAsset(id);
        const blob = asset?.kind === 'image' ? asset.blob : asset?.poster;
        if (blob) entry.image = await imageFromBlob(blob);
      } catch {
        /* Missing assets use the same placeholder on screen and in PNGs. */
      }
      if (entries.get(id) === entry) changed();
    })();
    return entry.promise;
  }
  return {
    image: (id: string) => entries.get(id)?.image ?? null,
    async prepare(objects: readonly ContentObject[]) {
      await Promise.all(
        objects
          .map(assetIdFor)
          .filter((id) => id !== null)
          .map(ensure)
      );
    },
    sync(objects: readonly ContentObject[]) {
      const live = new Set(objects.map(assetIdFor).filter((id) => id !== null));
      for (const id of entries.keys()) if (!live.has(id)) entries.delete(id);
      for (const id of live) void ensure(id);
    },
    clear: () => entries.clear(),
  };
}
