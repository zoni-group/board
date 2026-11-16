export const BOARD_SCHEMA_VERSION = 1;

/** Board coordinates in CSS pixels, independent of device pixel ratio. */
export interface Point {
  x: number;
  y: number;
}

export type StrokeTool = 'pen' | 'eraser';

export interface StrokeCommand {
  type: 'stroke';
  tool: StrokeTool;
  size: number;
  inkRaw: string;
  points: Point[];
}

export interface ClearCommand {
  type: 'clear';
}

export type BoardCommand = StrokeCommand | ClearCommand;

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

export function normalizeCommand(command: unknown): BoardCommand | null {
  if (!isRecord(command)) return null;
  if (command.type === 'clear') return { type: 'clear' };
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
    case 'stroke':
      return {
        type: 'stroke',
        tool: command.tool,
        size: command.size,
        inkRaw: command.inkRaw,
        points: command.points.map(clonePoint),
      };
    default:
      return assertNever(command);
  }
}
