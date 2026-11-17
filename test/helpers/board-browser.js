import { getBoardLibrary, loadBoardDrawing, saveBoardDrawing } from '../../src/board/storage.ts';
// Wait for the board controls to be enabled before calling this after navigation.
// Page load can finish while IndexedDB restoration still uses a temporary board ID.
export async function activeBoard() {
  return loadBoardDrawing(
    document.querySelector('#boards')?.dataset.boardId ?? (await getBoardLibrary()).activeBoardId
  );
}
export async function seedBoard(state) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const board = await activeBoard();
    try {
      return await saveBoardDrawing(
        board.id,
        { commands: [], redoCommands: [], viewport: null, draft: null, ...state },
        board.revision
      );
    } catch (error) {
      if (error.message !== 'boardConflict') throw error;
    }
  }
  throw new Error('Could not seed a busy board');
}
