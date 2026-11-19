import { cloneTextObject, expandCommands, isRecord, normalizeTextObject } from './model.ts';
import type { BoardCommand, TextObject } from './model.ts';

export interface TextDraft {
  token: string;
  object: TextObject;
  original: TextObject | null;
  committing?: boolean;
}

export function normalizeTextDraft(value: unknown): TextDraft | null {
  if (!isRecord(value) || typeof value.token !== 'string') return null;
  const object = normalizeTextObject(value.object);
  const original = value.original === null ? null : normalizeTextObject(value.original);
  if (!object || (value.original !== null && !original)) return null;
  return {
    token: value.token,
    object,
    original,
    ...(value.committing === true ? { committing: true } : {}),
  };
}
export function recoverTextDraft(
  draft: TextDraft | null,
  objects: readonly TextObject[],
  history: readonly BoardCommand[] = []
): TextDraft | null {
  if (!draft) return null;
  if (
    draft.committing &&
    [...expandCommands(history)].some(
      (command) =>
        (command.type === 'text-set' &&
          JSON.stringify(command.object) === JSON.stringify(draft.object)) ||
        (command.type === 'text-delete' && command.ids.includes(draft.object.id))
    )
  ) {
    return null;
  }
  const current = objects.find((object) => object.id === draft.object.id);
  if (JSON.stringify(current) === JSON.stringify(draft.object)) {
    return null;
  }
  if (draft.original && JSON.stringify(current) !== JSON.stringify(draft.original)) {
    const object = cloneTextObject(draft.object);
    object.id = crypto.randomUUID();
    return { ...draft, object, original: null };
  }
  return draft;
}
