export const BOARD_SCHEMA_VERSION = 4;

/** Board units: one CSS pixel at 100% zoom, independent of device pixel ratio. */
export interface Point {
  x: number;
  y: number;
}

export type StrokeTool = 'pen' | 'eraser';
export type BoardTool = StrokeTool | 'text' | 'hand' | 'shapes' | 'select';

export type BoardObjectRef = { kind: 'stroke' | 'text' | 'shape'; id: string };

export type ShapeKind = 'rectangle' | 'ellipse' | 'line' | 'arrow';

/** Boxes use opposite corners; lines retain endpoint order (and arrow direction). */
export interface ShapeObject {
  id: string;
  kind: ShapeKind;
  start: Point;
  end: Point;
  size: number;
  inkRaw: string;
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
export interface PenStrokeCommand extends StrokeData {
  tool: 'pen';
  id: string;
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

export type BoardCommand =
  | StrokeCommand
  | ClearCommand
  | TextSetCommand
  | TextDeleteCommand
  | ShapeSetCommand
  | ShapeDeleteCommand
  | StrokeEditCommand
  | StrokeDeleteCommand;

export interface BoardSnapshot {
  commands: BoardCommand[];
  redoCommands: BoardCommand[];
}

export interface BoardDrawing extends BoardSnapshot {
  version: typeof BOARD_SCHEMA_VERSION;
  updatedAtMs: number;
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
  if (kind !== 'rectangle' && kind !== 'ellipse' && kind !== 'line' && kind !== 'arrow')
    return null;
  const start = normalizePoint(value.start),
    end = normalizePoint(value.end);
  if (!start || !end || !isFiniteNumber(size) || size <= 0 || size > 1000) return null;
  if (typeof inkRaw !== 'string' || !/^#[\da-f]{6}$/i.test(inkRaw)) return null;
  const width = Math.abs(end.x - start.x),
    height = Math.abs(end.y - start.y);
  if (!Number.isFinite(Math.hypot(width, height))) return null;
  if (kind === 'rectangle' || kind === 'ellipse') {
    if (width === 0 || height === 0) return null;
    return {
      id: value.id,
      kind,
      size,
      inkRaw,
      start: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
      end: { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
    };
  }
  return width || height ? { id: value.id, kind, start, end, size, inkRaw } : null;
}

export function cloneShapeObject(object: ShapeObject): ShapeObject {
  return { ...object, start: clonePoint(object.start), end: clonePoint(object.end) };
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

export function normalizeCommand(command: unknown, legacyStrokeId?: string): BoardCommand | null {
  if (!isRecord(command)) return null;
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

  const points = Array.isArray(command.points)
    ? command.points.map(normalizePoint).filter((point) => point !== null)
    : [];
  if (points.length === 0) return null;

  const base = {
    type: 'stroke',
    size: isFiniteNumber(command.size) && command.size > 0 ? command.size : 6,
    inkRaw: typeof command.inkRaw === 'string' ? command.inkRaw : '#111827',
    points,
  } as const;
  if (command.tool !== 'eraser') {
    const id = typeof command.id === 'string' && command.id ? command.id : legacyStrokeId;
    return id ? { ...base, tool: 'pen', id } : null;
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

export function normalizeCommands(commands: unknown, legacyPrefix?: string): BoardCommand[] {
  if (!Array.isArray(commands)) return [];
  return commands
    .map((command, i) =>
      normalizeCommand(command, legacyPrefix === undefined ? undefined : `${legacyPrefix}-${i}`)
    )
    .filter((command) => command !== null);
}

export function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled board variant: ${JSON.stringify(value)}`);
}

export function cloneCommand(command: BoardCommand): BoardCommand {
  switch (command.type) {
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
        ? { ...command, points: command.points.map(clonePoint) }
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
