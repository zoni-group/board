export const BOARD_SCHEMA_VERSION = 2;

/** Board units: one CSS pixel at 100% zoom, independent of device pixel ratio. */
export interface Point {
  x: number;
  y: number;
}

export type StrokeTool = 'pen' | 'eraser';
export type BoardTool = StrokeTool | 'text' | 'hand';

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

export interface StrokeCommand {
  type: 'stroke';
  tool: StrokeTool;
  size: number;
  inkRaw: string;
  points: Point[];
  erasedTextIds?: string[];
}

export interface ClearCommand {
  type: 'clear';
}

export type BoardCommand = StrokeCommand | ClearCommand | TextSetCommand | TextDeleteCommand;

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

export function normalizeCommand(command: unknown): BoardCommand | null {
  if (!isRecord(command)) return null;
  if (command.type === 'clear') return { type: 'clear' };
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

  return {
    type: 'stroke',
    tool: command.tool === 'eraser' ? 'eraser' : 'pen',
    size: isFiniteNumber(command.size) && command.size > 0 ? command.size : 6,
    inkRaw: typeof command.inkRaw === 'string' ? command.inkRaw : '#111827',
    points,
    ...(command.tool === 'eraser' && normalizeIds(command.erasedTextIds).length
      ? { erasedTextIds: normalizeIds(command.erasedTextIds) }
      : {}),
  };
}

export function normalizeCommands(commands: unknown): BoardCommand[] {
  if (!Array.isArray(commands)) return [];
  return commands.map(normalizeCommand).filter((command) => command !== null);
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
    case 'text-set':
      return { type: 'text-set', object: cloneTextObject(command.object) };
    case 'text-delete':
      return { type: 'text-delete', ids: [...command.ids] };
    case 'stroke':
      return {
        type: 'stroke',
        tool: command.tool,
        size: command.size,
        inkRaw: command.inkRaw,
        points: command.points.map(clonePoint),
        ...(command.erasedTextIds ? { erasedTextIds: [...command.erasedTextIds] } : {}),
      };
    default:
      return assertNever(command);
  }
}
