import { loadJson, removeStoredValue, saveJson } from '../shared/storage.ts';
import { cloneTextObject, isRecord, normalizeTextObject } from './model.ts';
import type { BoardCommand, TextObject } from './model.ts';

export const TEXT_DRAFT_KEY = 'vatio_board_text_draft_v1';
export interface TextDraft {
  token: string;
  object: TextObject;
  original: TextObject | null;
  committing?: boolean;
}

export function loadTextDraft(): TextDraft | null {
  const value = loadJson(TEXT_DRAFT_KEY);
  if (!isRecord(value) || value.version !== 1 || typeof value.token !== 'string') return null;
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
export function saveTextDraft(draft: TextDraft): boolean {
  return saveJson(TEXT_DRAFT_KEY, { version: 1, ...draft });
}
export function clearTextDraft(token: string): void {
  if (loadTextDraft()?.token === token) removeStoredValue(TEXT_DRAFT_KEY);
}
export function recoverTextDraft(
  objects: readonly TextObject[],
  history: readonly BoardCommand[] = []
): TextDraft | null {
  const draft = loadTextDraft();
  if (!draft) return null;
  if (
    draft.committing &&
    history.some(
      (command) =>
        (command.type === 'text-set' &&
          JSON.stringify(command.object) === JSON.stringify(draft.object)) ||
        (command.type === 'text-delete' && command.ids.includes(draft.object.id))
    )
  ) {
    clearTextDraft(draft.token);
    return null;
  }
  const current = objects.find((object) => object.id === draft.object.id);
  if (JSON.stringify(current) === JSON.stringify(draft.object)) {
    clearTextDraft(draft.token);
    return null;
  }
  if (draft.original && JSON.stringify(current) !== JSON.stringify(draft.original)) {
    const object = cloneTextObject(draft.object);
    object.id = crypto.randomUUID();
    return { ...draft, object, original: null };
  }
  return draft;
}
