export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm'];

/** Board units: one CSS pixel at 100% zoom, independent of device pixel ratio. */
export interface Point {
  x: number;
  y: number;
}

export type StrokeTool = 'pen' | 'eraser';
export type BoardTool = StrokeTool | 'text' | 'hand' | 'shapes' | 'select';

export type BoardObjectRef = {
  kind: 'stroke' | 'text' | 'shape' | ContentObject['kind'];
  id: string;
};

export type ShapeKind =
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'triangle'
  | 'speechBubble'
  | 'numberLine'
  | 'axes';
/** Shapes drawn from a box (opposite corners); the others run from start to end. */
export const BOX_SHAPES: readonly ShapeKind[] = [
  'rectangle',
  'ellipse',
  'triangle',
  'speechBubble',
  'axes',
];
/** Closed shapes that can be filled. */
export const FILLABLE_SHAPES: readonly ShapeKind[] = [
  'rectangle',
  'ellipse',
  'triangle',
  'speechBubble',
];
const SHAPE_KINDS: readonly ShapeKind[] = [...BOX_SHAPES, 'line', 'arrow', 'numberLine'];

/** A closed shape's fill: a colour, or `outline` to follow the outline colour. */
export interface ShapeFill {
  color: string;
  /** Full strength; otherwise a light, see-through tint. */
  solid?: true;
}

/** Boxes use opposite corners; lines retain endpoint order (and arrow direction). */
export interface ShapeObject {
  id: string;
  kind: ShapeKind;
  start: Point;
  end: Point;
  size: number;
  inkRaw: string;
  /** Absent means no fill. Only on closed shapes. */
  fill?: ShapeFill;
  /** Number lines and axes drawn on grid or dot paper: the grid spacing their ticks follow. */
  step?: number;
}

export interface ShapeSetCommand {
  type: 'shape-set';
  object: ShapeObject;
}

export interface ShapeDeleteCommand {
  type: 'shape-delete';
  ids: string[];
}

export interface TextRun {
  text: string;
  fontSize: number;
  inkRaw: string;
  highlightRaw?: string;
  bold: boolean;
  italic: boolean;
}

export interface TextParagraph {
  align: 'left' | 'center' | 'right';
  runs: TextRun[];
}

export interface TextObject {
  id: string;
  position: Point;
  paragraphs: TextParagraph[];
}

interface MediaBox {
  id: string;
  position: Point;
  width: number;
  height: number;
  title: string;
}
export interface ImageObject extends MediaBox {
  kind: 'image';
  assetId: string;
}
export type VideoSource =
  | { kind: 'local'; assetId: string }
  | { kind: 'youtube'; videoId: string }
  | { kind: 'vimeo'; videoId: string; hash?: string };
export interface VideoObject extends MediaBox {
  kind: 'video';
  source: VideoSource;
}
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 20;
export interface TableObject {
  kind: 'table';
  id: string;
  position: Point;
  columnWidths: number[];
  rows: { minHeight: number; cells: TextParagraph[][] }[];
  borderRaw: string;
}
export type ContentObject = ImageObject | VideoObject | TableObject;
/** The stored media record an object shows, if any. */
export function assetIdFor(object: ContentObject): string | null {
  return object.kind === 'image'
    ? object.assetId
    : object.kind === 'video' && object.source.kind === 'local'
      ? object.source.assetId
      : null;
}
export type ContentCommand =
  | { type: 'content-set'; object: ContentObject }
  | { type: 'content-delete'; ids: string[] };

export interface TextSetCommand {
  type: 'text-set';
  object: TextObject;
}

export interface TextDeleteCommand {
  type: 'text-delete';
  ids: string[];
}

interface StrokeData {
  type: 'stroke';
  size: number;
  inkRaw: string;
  points: Point[];
}
/** Pen types offered by the Pen button. Only the highlighter is stored on strokes; the laser is never saved. */
export type PenKind = 'pen' | 'highlighter' | 'laser';
/** Select button modes: tap one object, drag a box, or draw a lasso. */
export type SelectMode = 'one' | 'box' | 'lasso';
export interface PenStrokeCommand extends StrokeData {
  tool: 'pen';
  id: string;
  /** Absent for regular ink. */
  pen?: 'highlighter';
  /** Stylus pressure (0–1), one value per point; absent for mouse, touch and highlighter. */
  pressure?: number[];
  /**
   * Parts already erased when the stroke was made, in the stroke's own coordinates. Only a
   * duplicated or pasted stroke has them, so the copy looks like the original.
   */
  erasures?: StrokeMask[];
}
/** An eraser path that hides part of a pen stroke. */
export interface StrokeMask {
  size: number;
  points: Point[];
}
export interface EraserStrokeCommand extends StrokeData {
  tool: 'eraser';
  erasedTextIds?: string[];
  erasedShapeIds?: string[];
}
export type StrokeCommand = PenStrokeCommand | EraserStrokeCommand;
export interface StrokeEditCommand {
  type: 'stroke-edit';
  id: string;
  translate?: Point;
  size?: number;
  inkRaw?: string;
}
export interface StrokeDeleteCommand {
  type: 'stroke-delete';
  ids: string[];
}

export interface ClearCommand {
  type: 'clear';
}

/** One object change. Batches group several of these into a single undo step. */
export type AtomicCommand =
  | ContentCommand
  | StrokeCommand
  | TextSetCommand
  | TextDeleteCommand
  | ShapeSetCommand
  | ShapeDeleteCommand
  | StrokeEditCommand
  | StrokeDeleteCommand;
/** Several object changes made together (for example moving a selected group). Never nested. */
export interface BatchCommand {
  type: 'batch';
  commands: AtomicCommand[];
}
export type BoardCommand = AtomicCommand | ClearCommand | BatchCommand;
/** What resolvers see after batches are expanded. */
export type ResolvedCommand = AtomicCommand | ClearCommand;

/** Flattens batches in order. The only place outside validation that needs to know about them. */
export function* expandCommands(commands: Iterable<BoardCommand>): Generator<ResolvedCommand> {
  for (const command of commands) {
    if (command.type === 'batch') yield* command.commands;
    else yield command;
  }
}

export interface BoardSnapshot {
  commands: BoardCommand[];
  redoCommands: BoardCommand[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizePoint(point: unknown): Point | null {
  if (!isRecord(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
  return { x: point.x, y: point.y };
}

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
}

export function normalizeShapeObject(value: unknown): ShapeObject | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  const { kind, size, inkRaw } = value;
  if (!SHAPE_KINDS.includes(kind as ShapeKind)) return null;
  const start = normalizePoint(value.start),
    end = normalizePoint(value.end);
  if (!start || !end || !isFiniteNumber(size) || size <= 0 || size > 1000) return null;
  if (typeof inkRaw !== 'string' || !/^#[\da-f]{6}$/i.test(inkRaw)) return null;
  const width = Math.abs(end.x - start.x),
    height = Math.abs(end.y - start.y);
  if (!Number.isFinite(Math.hypot(width, height))) return null;
  const shapeKind = kind as ShapeKind;
  if (BOX_SHAPES.includes(shapeKind)) {
    if (width === 0 || height === 0) return null;
    const fill = FILLABLE_SHAPES.includes(shapeKind) ? normalizeShapeFill(value.fill) : null;
    return {
      id: value.id,
      kind: shapeKind,
      size,
      inkRaw,
      start: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
      end: { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
      ...(fill ? { fill } : {}),
      ...(shapeKind === 'axes' && normalizeStep(value.step)
        ? { step: normalizeStep(value.step)! }
        : {}),
    };
  }
  if (!width && !height) return null;
  const step = normalizeStep(value.step);
  return {
    id: value.id,
    kind: shapeKind,
    start,
    end,
    size,
    inkRaw,
    ...(step && shapeKind === 'numberLine' ? { step } : {}),
  };
}

function normalizeStep(value: unknown): number | null {
  return isFiniteNumber(value) && value >= 4 && value <= 1000 ? value : null;
}

export function normalizeShapeFill(value: unknown): ShapeFill | null {
  if (!isRecord(value) || typeof value.color !== 'string') return null;
  const color = value.color === 'outline' ? 'outline' : value.color.toLowerCase();
  if (color !== 'outline' && !/^#[\da-f]{6}$/.test(color)) return null;
  return value.solid === true ? { color, solid: true } : { color };
}

export function cloneShapeObject(object: ShapeObject): ShapeObject {
  return {
    ...object,
    start: clonePoint(object.start),
    end: clonePoint(object.end),
    ...(object.fill ? { fill: { ...object.fill } } : {}),
  };
}

export function normalizeTextObject(value: unknown): TextObject | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  const position = normalizePoint(value.position);
  if (!position || !Array.isArray(value.paragraphs) || value.paragraphs.length === 0) return null;
  const paragraphs: TextParagraph[] = [];
  for (const paragraph of value.paragraphs) {
    if (!isRecord(paragraph) || !Array.isArray(paragraph.runs)) return null;
    if (paragraph.align !== 'left' && paragraph.align !== 'center' && paragraph.align !== 'right')
      return null;
    const runs: TextRun[] = [];
    for (const run of paragraph.runs) {
      if (!isRecord(run) || typeof run.text !== 'string' || /[\r\n]/.test(run.text)) return null;
      if (!isFiniteNumber(run.fontSize) || run.fontSize <= 0 || run.fontSize > 1000) return null;
      if (typeof run.inkRaw !== 'string' || !/^#[\da-f]{6}$/i.test(run.inkRaw)) return null;
      if (
        run.highlightRaw !== undefined &&
        (typeof run.highlightRaw !== 'string' || !/^#[\da-f]{6}$/i.test(run.highlightRaw))
      )
        return null;
      if (typeof run.bold !== 'boolean' || typeof run.italic !== 'boolean') return null;
      runs.push({
        text: run.text,
        fontSize: run.fontSize,
        inkRaw: run.inkRaw,
        ...(run.highlightRaw !== undefined ? { highlightRaw: run.highlightRaw } : {}),
        bold: run.bold,
        italic: run.italic,
      });
    }
    const align =
      paragraph.align === 'center' ? 'center' : paragraph.align === 'right' ? 'right' : 'left';
    paragraphs.push({ align, runs });
  }
  return { id: value.id, position, paragraphs };
}

export function cloneTextObject(object: TextObject): TextObject {
  return {
    id: object.id,
    position: clonePoint(object.position),
    paragraphs: object.paragraphs.map((p) => ({
      align: p.align,
      runs: p.runs.map((run) => ({ ...run })),
    })),
  };
}

export function isEmptyText(object: TextObject): boolean {
  return object.paragraphs.every((p) => p.runs.every((run) => run.text.trim() === ''));
}

export function normalizeVideoSource(value: unknown): VideoSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'local')
    return typeof value.assetId === 'string' && value.assetId.length > 0
      ? { kind: 'local', assetId: value.assetId }
      : null;
  if (
    value.kind === 'youtube' &&
    typeof value.videoId === 'string' &&
    /^[\w-]{11}$/.test(value.videoId)
  )
    return { kind: 'youtube', videoId: value.videoId };
  if (
    value.kind === 'vimeo' &&
    typeof value.videoId === 'string' &&
    /^\d{1,12}$/.test(value.videoId)
  ) {
    if (
      value.hash !== undefined &&
      (typeof value.hash !== 'string' || !/^[a-z\d]{1,64}$/i.test(value.hash))
    )
      return null;
    return { kind: 'vimeo', videoId: value.videoId, ...(value.hash ? { hash: value.hash } : {}) };
  }
  return null;
}

export function normalizeContentObject(value: unknown): ContentObject | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  const position = normalizePoint(value.position);
  if (!position) return null;
  if (value.kind === 'table') {
    if (
      !Array.isArray(value.columnWidths) ||
      !value.columnWidths.length ||
      value.columnWidths.length > MAX_TABLE_COLUMNS ||
      !value.columnWidths.every((n) => isFiniteNumber(n) && n >= 60 && n <= 10000) ||
      !Array.isArray(value.rows) ||
      !value.rows.length ||
      value.rows.length > MAX_TABLE_ROWS ||
      typeof value.borderRaw !== 'string' ||
      (value.borderRaw !== 'none' && !/^#[\da-f]{6}$/i.test(value.borderRaw))
    )
      return null;
    const rows: TableObject['rows'] = [];
    for (const row of value.rows) {
      if (
        !isRecord(row) ||
        !isFiniteNumber(row.minHeight) ||
        row.minHeight < 24 ||
        row.minHeight > 10000 ||
        !Array.isArray(row.cells) ||
        row.cells.length !== value.columnWidths.length
      )
        return null;
      const cells: TextParagraph[][] = [];
      for (const cell of row.cells) {
        const text = normalizeTextObject({ id: value.id, position, paragraphs: cell });
        if (!text) return null;
        cells.push(text.paragraphs);
      }
      rows.push({ minHeight: row.minHeight, cells });
    }
    return {
      kind: 'table',
      id: value.id,
      position,
      columnWidths: [...value.columnWidths] as number[],
      rows,
      borderRaw: value.borderRaw,
    };
  }
  if (
    (value.kind !== 'image' && value.kind !== 'video') ||
    !isFiniteNumber(value.width) ||
    value.width <= 0 ||
    value.width > 100000 ||
    !isFiniteNumber(value.height) ||
    value.height <= 0 ||
    value.height > 100000 ||
    typeof value.title !== 'string' ||
    value.title.length > 500
  )
    return null;
  const box = {
    id: value.id,
    position,
    width: value.width,
    height: value.height,
    title: value.title,
  };
  if (value.kind === 'image')
    return typeof value.assetId === 'string' && value.assetId
      ? { ...box, kind: 'image', assetId: value.assetId }
      : null;
  const source = normalizeVideoSource(value.source);
  return source ? { ...box, kind: 'video', source } : null;
}

export function cloneContentObject<T extends ContentObject>(object: T): T {
  return structuredClone(object);
}

export function normalizeCommand(command: unknown): BoardCommand | null {
  if (!isRecord(command)) return null;
  if (command.type === 'batch') {
    if (!Array.isArray(command.commands)) return null;
    const commands = command.commands
      .map((inner) => normalizeCommand(inner))
      .filter(
        (inner): inner is AtomicCommand =>
          inner !== null && inner.type !== 'batch' && inner.type !== 'clear'
      );
    return commands.length ? { type: 'batch', commands } : null;
  }
  if (command.type === 'content-set') {
    const object = normalizeContentObject(command.object);
    return object ? { type: 'content-set', object } : null;
  }
  if (command.type === 'content-delete') {
    const ids = normalizeIds(command.ids);
    return ids.length ? { type: 'content-delete', ids } : null;
  }
  if (command.type === 'clear') return { type: 'clear' };
  if (command.type === 'stroke-delete') {
    const ids = normalizeIds(command.ids);
    return ids.length ? { type: 'stroke-delete', ids } : null;
  }
  if (command.type === 'stroke-edit') {
    if (typeof command.id !== 'string' || !command.id) return null;
    const translate =
      command.translate === undefined ? undefined : normalizePoint(command.translate);
    if (translate === null) return null;
    if (
      command.size !== undefined &&
      (!isFiniteNumber(command.size) || command.size <= 0 || command.size > 1000)
    )
      return null;
    if (
      command.inkRaw !== undefined &&
      (typeof command.inkRaw !== 'string' || !/^#[\da-f]{6}$/i.test(command.inkRaw))
    )
      return null;
    if (!translate && command.size === undefined && command.inkRaw === undefined) return null;
    return {
      type: 'stroke-edit',
      id: command.id,
      ...(translate ? { translate } : {}),
      ...(command.size !== undefined ? { size: command.size as number } : {}),
      ...(command.inkRaw !== undefined ? { inkRaw: command.inkRaw as string } : {}),
    };
  }
  if (command.type === 'shape-set') {
    const object = normalizeShapeObject(command.object);
    return object ? { type: 'shape-set', object } : null;
  }
  if (command.type === 'shape-delete') {
    const ids = normalizeIds(command.ids);
    return ids.length ? { type: 'shape-delete', ids } : null;
  }
  if (command.type === 'text-set') {
    const object = normalizeTextObject(command.object);
    return object && !isEmptyText(object) ? { type: 'text-set', object } : null;
  }
  if (command.type === 'text-delete') {
    const ids = normalizeIds(command.ids);
    return ids.length ? { type: 'text-delete', ids } : null;
  }
  if (command.type !== 'stroke') return null;

  if (command.tool !== 'pen' && command.tool !== 'eraser') return null;
  if (
    !isFiniteNumber(command.size) ||
    command.size <= 0 ||
    command.size > 1000 ||
    typeof command.inkRaw !== 'string' ||
    !/^#[\da-f]{6}$/i.test(command.inkRaw)
  )
    return null;
  if (!Array.isArray(command.points) || !command.points.length) return null;
  const points = command.points.map(normalizePoint);
  if (points.some((point) => point === null)) return null;
  const base = {
    type: 'stroke',
    size: command.size,
    inkRaw: command.inkRaw,
    points: points as Point[],
  } as const;
  if (command.tool !== 'eraser') {
    const id = typeof command.id === 'string' && command.id ? command.id : null;
    if (!id) return null;
    const pressure = normalizePressure(command.pressure, points.length);
    const erasures = normalizeMasks(command.erasures);
    return {
      ...base,
      tool: 'pen',
      id,
      ...(command.pen === 'highlighter' ? { pen: 'highlighter' } : pressure ? { pressure } : {}),
      ...(erasures.length ? { erasures } : {}),
    };
  }
  return {
    ...base,
    tool: 'eraser',
    ...(command.tool === 'eraser' && normalizeIds(command.erasedTextIds).length
      ? { erasedTextIds: normalizeIds(command.erasedTextIds) }
      : {}),
    ...(command.tool === 'eraser' && normalizeIds(command.erasedShapeIds).length
      ? { erasedShapeIds: normalizeIds(command.erasedShapeIds) }
      : {}),
  };
}

export function normalizeCommands(commands: unknown): BoardCommand[] {
  if (!Array.isArray(commands)) return [];
  return commands.map((command) => normalizeCommand(command)).filter((command) => command !== null);
}

/** Erasure masks with a valid size and points; anything else is dropped. */
function normalizeMasks(value: unknown): StrokeMask[] {
  if (!Array.isArray(value)) return [];
  const masks: StrokeMask[] = [];
  for (const mask of value.slice(0, 1000)) {
    if (!mask || typeof mask !== 'object') continue;
    const { size, points } = mask as Record<string, unknown>;
    if (!isFiniteNumber(size) || size <= 0 || size > 1000) continue;
    if (!Array.isArray(points) || !points.length) continue;
    const normalized = points.map(normalizePoint);
    if (normalized.every((point) => point !== null)) masks.push({ size, points: normalized });
  }
  return masks;
}

/** Pressure is kept only when it matches the points; otherwise the stroke draws at an even width. */
function normalizePressure(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  if (!value.every((p) => isFiniteNumber(p) && p >= 0 && p <= 1)) return null;
  return value as number[];
}

export function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled board variant: ${JSON.stringify(value)}`);
}

export function cloneCommand<T extends BoardCommand>(command: T): T;
export function cloneCommand(command: BoardCommand): BoardCommand {
  switch (command.type) {
    case 'batch':
      return { type: 'batch', commands: command.commands.map(cloneCommand) };
    case 'content-set':
      return { type: 'content-set', object: cloneContentObject(command.object) };
    case 'content-delete':
      return { type: 'content-delete', ids: [...command.ids] };
    case 'clear':
      return { type: 'clear' };
    case 'shape-set':
      return { type: 'shape-set', object: cloneShapeObject(command.object) };
    case 'shape-delete':
      return { type: 'shape-delete', ids: [...command.ids] };
    case 'stroke-edit':
      return {
        ...command,
        ...(command.translate ? { translate: clonePoint(command.translate) } : {}),
      };
    case 'stroke-delete':
      return { type: 'stroke-delete', ids: [...command.ids] };
    case 'text-set':
      return { type: 'text-set', object: cloneTextObject(command.object) };
    case 'text-delete':
      return { type: 'text-delete', ids: [...command.ids] };
    case 'stroke':
      return command.tool === 'pen'
        ? {
            ...command,
            points: command.points.map(clonePoint),
            ...(command.pressure ? { pressure: [...command.pressure] } : {}),
            ...(command.erasures
              ? {
                  erasures: command.erasures.map((mask) => ({
                    size: mask.size,
                    points: mask.points.map(clonePoint),
                  })),
                }
              : {}),
          }
        : {
            ...command,
            points: command.points.map(clonePoint),
            ...(command.erasedTextIds ? { erasedTextIds: [...command.erasedTextIds] } : {}),
            ...(command.erasedShapeIds ? { erasedShapeIds: [...command.erasedShapeIds] } : {}),
          };
    default:
      return assertNever(command);
  }
}
