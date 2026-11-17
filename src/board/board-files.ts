import { Unzip, Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { assetIdFor, IMAGE_TYPES, VIDEO_TYPES } from './assets.ts';
import { cloneCommand, isRecord } from './model.ts';
import { getAssetRecord, importBoardRecords, normalizeBoardDocument } from './storage.ts';
import type { BoardDocument, StoredAsset, BinaryAsset } from './storage.ts';

const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_BYTES = 0xffffffff;
interface Payload {
  path: string;
  type: string;
  size: number;
  sha256: string;
}
interface AssetManifest extends Omit<StoredAsset, 'blob' | 'poster'> {
  blob: Payload;
  poster?: Payload;
}
interface Manifest {
  format: 'zoniboard';
  version: 1;
  activeBoardId: string;
  boards: BoardDocument[];
  assets: AssetManifest[];
}
export interface TransferOptions {
  signal?: AbortSignal;
  progress?(done: number, total: number): void;
}
function check(options: TransferOptions) {
  if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}
function fail(): never {
  throw new Error('invalidArchive');
}
function safeId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,128}$/.test(id);
}
async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
export function referencedAssets(board: BoardDocument): Map<string, 'image' | 'video'> {
  const ids = new Map<string, 'image' | 'video'>();
  for (const command of [...board.commands, ...board.redoCommands])
    if (command.type === 'content-set') {
      const id = assetIdFor(command.object);
      if (id) {
        const kind = command.object.kind === 'image' ? 'image' : 'video';
        if (ids.has(id) && ids.get(id) !== kind) fail();
        ids.set(id, kind);
      }
    }
  return ids;
}
export async function exportBoards(
  boards: readonly BoardDocument[],
  activeId: string,
  options: TransferOptions = {}
): Promise<Blob> {
  check(options);
  const manifest: Manifest = {
    format: 'zoniboard',
    version: 1,
    activeBoardId: activeId,
    boards: boards.map((b) => ({ ...structuredClone(b), draft: null })),
    assets: [],
  };
  if (!boards.length || !boards.some((b) => b.id === activeId)) fail();
  const references = new Map<string, { boardId: string; kind: 'image' | 'video' }>();
  for (const board of boards)
    for (const [id, kind] of referencedAssets(board)) {
      const previous = references.get(id);
      if (previous && previous.boardId !== board.id) fail();
      references.set(id, { boardId: board.id, kind });
    }
  const parts: BlobPart[] = [];
  let zipError: Error | null = null,
    size = 0;
  const zip = new Zip((error, data) => {
    if (error) {
      zipError = error;
      return;
    }
    size += data.length;
    if (size > MAX_ZIP_BYTES) {
      zipError = new Error('archiveTooLarge');
      return;
    }
    parts.push(new Uint8Array(data).buffer);
  });
  const add = (name: string, bytes: Uint8Array) => {
    check(options);
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(bytes, true);
    if (zipError) throw zipError;
  };
  try {
    let done = 0;
    options.progress?.(0, references.size + 1);
    for (const [id, reference] of references) {
      check(options);
      const asset = await getAssetRecord(id);
      if (!asset || asset.boardId !== reference.boardId || asset.kind !== reference.kind)
        throw new Error('archiveMissingMedia');
      const payload = async (value: BinaryAsset, path: string): Promise<Payload> => {
        const bytes = new Uint8Array(value.bytes),
          sha256 = await hash(bytes);
        add(path, bytes);
        return { path, type: value.type, size: bytes.length, sha256 };
      };
      const blob = await payload(asset.blob, `assets/${id}/source`);
      const poster = asset.poster ? await payload(asset.poster, `assets/${id}/poster`) : undefined;
      manifest.assets.push({
        id,
        boardId: asset.boardId,
        kind: asset.kind,
        width: asset.width,
        height: asset.height,
        blob,
        ...(poster ? { poster } : {}),
      });
      options.progress?.(++done, references.size + 1);
    }
    const json = strToU8(JSON.stringify(manifest));
    if (json.length > MAX_MANIFEST_BYTES) throw new Error('archiveTooLarge');
    add('manifest.json', json);
    add('manifest.sha256', strToU8(await hash(json)));
    zip.end();
    if (zipError) throw zipError;
    options.progress?.(references.size + 1, references.size + 1);
    return new Blob(parts, { type: 'application/zip' });
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

export async function readBoardArchive(
  file: Blob,
  options: TransferOptions = {}
): Promise<{ boards: BoardDocument[]; assets: StoredAsset[]; activeId: string }> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('archiveTooLarge');
  check(options);
  if (file.size < 22) fail();
  const end = new DataView(await file.slice(-22).arrayBuffer());
  if (
    end.getUint32(0, true) !== 0x06054b50 ||
    end.getUint16(4, true) !== 0 ||
    end.getUint16(6, true) !== 0 ||
    end.getUint16(20, true) !== 0 ||
    end.getUint32(12, true) + end.getUint32(16, true) !== file.size - 22
  )
    fail();
  const entries = new Map<string, Uint8Array>();
  let failure: unknown = null,
    total = 0,
    count = 0;
  const unzip = new Unzip((entry) => {
    if (
      ++count > 65535 ||
      entry.compression !== 0 ||
      entries.has(entry.name) ||
      (!['manifest.json', 'manifest.sha256'].includes(entry.name) &&
        !/^assets\/[\w-]{1,128}\/(source|poster)$/.test(entry.name))
    ) {
      failure = new Error('invalidArchive');
      return;
    }
    // Reserve names immediately so duplicate entries cannot overwrite each other.
    entries.set(entry.name, new Uint8Array());
    const chunks: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        return;
      }
      total += data.length;
      size += data.length;
      if (
        total > file.size ||
        (entry.name === 'manifest.json' && size > MAX_MANIFEST_BYTES) ||
        (entry.name === 'manifest.sha256' && size > 64)
      ) {
        failure = new Error('archiveTooLarge');
        return;
      }
      chunks.push(data);
      if (final) {
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.length;
        }
        entries.set(entry.name, bytes);
      }
    };
    entry.start();
  });
  const reader = file.stream().getReader();
  let consumed = 0;
  try {
    while (true) {
      check(options);
      const { done, value } = await reader.read();
      if (done) break;
      consumed += value.length;
      unzip.push(value, false);
      if (failure) throw failure;
      options.progress?.(consumed, file.size);
    }
    unzip.push(new Uint8Array(), true);
    if (failure) throw failure;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  check(options);
  if (count !== end.getUint16(10, true) || count !== end.getUint16(8, true)) fail();
  const manifestBytes = entries.get('manifest.json'),
    checksum = entries.get('manifest.sha256');
  if (!manifestBytes || !checksum || strFromU8(checksum) !== (await hash(manifestBytes))) fail();
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(manifestBytes));
  } catch {
    fail();
  }
  if (!isRecord(raw) || raw.format !== 'zoniboard' || raw.version !== 1)
    throw new Error('unsupportedArchive');
  if (
    !Array.isArray(raw.boards) ||
    !raw.boards.length ||
    !Array.isArray(raw.assets) ||
    !safeId(raw.activeBoardId)
  )
    fail();
  const boards: BoardDocument[] = [],
    boardIds = new Map<string, string>();
  for (const value of raw.boards) {
    const board = normalizeBoardDocument(value);
    if (!board || !safeId(board.id) || board.draft !== null || boardIds.has(board.id)) fail();
    boardIds.set(board.id, crypto.randomUUID());
    boards.push(board);
  }
  if (!boardIds.has(raw.activeBoardId)) fail();
  const expected = new Map<string, { boardId: string; kind: 'image' | 'video' }>();
  for (const board of boards)
    for (const [id, kind] of referencedAssets(board)) {
      if (!safeId(id) || (expected.has(id) && expected.get(id)!.boardId !== board.id)) fail();
      expected.set(id, { boardId: board.id, kind });
    }
  const assets: StoredAsset[] = [],
    assetIds = new Map<string, string>(),
    allowed = new Set(['manifest.json', 'manifest.sha256']);
  for (const value of raw.assets) {
    check(options);
    if (
      !isRecord(value) ||
      !safeId(value.id) ||
      !safeId(value.boardId) ||
      assetIds.has(value.id) ||
      expected.get(value.id)?.boardId !== value.boardId ||
      expected.get(value.id)?.kind !== value.kind ||
      typeof value.width !== 'number' ||
      !Number.isFinite(value.width) ||
      value.width <= 0 ||
      value.width > 100000 ||
      typeof value.height !== 'number' ||
      !Number.isFinite(value.height) ||
      value.height <= 0 ||
      value.height > 100000
    )
      fail();
    const kind = value.kind as 'image' | 'video';
    const payload = async (
      input: unknown,
      path: string,
      types: readonly string[]
    ): Promise<BinaryAsset> => {
      if (
        !isRecord(input) ||
        input.path !== path ||
        typeof input.type !== 'string' ||
        !types.includes(input.type) ||
        typeof input.sha256 !== 'string'
      )
        fail();
      const bytes = entries.get(path);
      if (!bytes || bytes.length !== input.size || (await hash(bytes)) !== input.sha256) fail();
      allowed.add(path);
      return { type: input.type, bytes: new Uint8Array(bytes).buffer };
    };
    const blob = await payload(
      value.blob,
      `assets/${value.id}/source`,
      kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES
    );
    const poster =
      value.poster === undefined
        ? undefined
        : await payload(value.poster, `assets/${value.id}/poster`, ['image/png']);
    const id = crypto.randomUUID();
    assetIds.set(value.id, id);
    assets.push({
      id,
      boardId: boardIds.get(value.boardId)!,
      kind,
      width: value.width,
      height: value.height,
      blob,
      ...(poster ? { poster } : {}),
    });
  }
  if (assetIds.size !== expected.size || entries.size !== allowed.size) fail();
  for (const board of boards) {
    board.id = boardIds.get(board.id)!;
    board.revision = 0;
    const remap = (command: BoardDocument['commands'][number]) => {
      const copy = cloneCommand(command);
      if (copy.type === 'content-set') {
        if (copy.object.kind === 'image') copy.object.assetId = assetIds.get(copy.object.assetId)!;
        if (copy.object.kind === 'video' && copy.object.source.kind === 'local')
          copy.object.source.assetId = assetIds.get(copy.object.source.assetId)!;
      }
      return copy;
    };
    board.commands = board.commands.map(remap);
    board.redoCommands = board.redoCommands.map(remap);
  }
  check(options);
  return { boards, assets, activeId: boardIds.get(raw.activeBoardId)! };
}
export async function importBoards(
  file: Blob,
  options: TransferOptions = {}
): Promise<BoardDocument> {
  const prepared = await readBoardArchive(file, options);
  check(options);
  return importBoardRecords(prepared.boards, prepared.assets, prepared.activeId, options.signal);
}
