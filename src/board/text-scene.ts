import { assertNever } from './model.ts';
import type { BoardCommand, TextObject } from './model.ts';

/** Resolve objects from applied history; replacements retain their stacking order. */
export function resolveTextObjects(commands: readonly BoardCommand[]): TextObject[] {
  const objects = new Map<string, TextObject>();
  for (const command of commands) {
    switch (command.type) {
      case 'clear':
        objects.clear();
        break;
      case 'text-set':
        objects.set(command.object.id, command.object);
        break;
      case 'text-delete':
        command.ids.forEach((id) => objects.delete(id));
        break;
      case 'stroke':
        if (command.tool === 'eraser') command.erasedTextIds?.forEach((id) => objects.delete(id));
        break;
      default:
        assertNever(command);
    }
  }
  return [...objects.values()];
}
