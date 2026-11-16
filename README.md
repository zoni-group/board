# ZONI® Board

ZONI® Board is a full-screen local drawing board by [ZONI](https://zoni.edu), deployed at https://board.zoni.edu.
It is optimized for touch screens, with pen/eraser tools, editable rich text, brush size control, color presets, local autosave, and PNG downloads.

- Production site: https://board.zoni.edu
- Repository: https://github.com/zoni-group/board
- Creator: Oscar Perez | ZONI

## App

`index.html` loads the board from [`src/board/board.ts`](src/board/board.ts).

What it does:

- full-screen drawing canvas with pen and eraser tools
- brush size control, preset swatches, and an `iro` color picker
- editable, movable text blocks with selected-word formatting
- undo, redo, clear, and PNG download
- local autosave of drawing history using IndexedDB with `localStorage` fallback
- English/Spanish language toggle

## Stack

- Vite 7 single-page build
- Vanilla TypeScript ES modules with strict type checking
- LESS for styling
- `@jaames/iro` for the color picker
- Lazy-loaded `@notectl/core` for rich text editing
- Vitest + jsdom for unit and smoke tests; Playwright for Chromium/WebKit browser tests
- ESLint + Prettier for code quality

## Project Layout

```txt
.
├─ index.html
├─ public/
│  └─ img/
├─ src/
│  ├─ board/
│  ├─ shared/
│  ├─ styles/
│  ├─ i18n.ts
│  └─ icons.ts
├─ test/
│  ├─ helpers/
│  ├─ setup/
│  ├─ smoke/
│  └─ unit/
├─ tsconfig.json
├─ vite.config.js
└─ vitest.config.js
```

## Getting Started

### Requirements

- Node.js `>=24`
- npm

### Install

```bash
npm install
```

### Start The Dev Server

```bash
npm run dev
```

Local development runs at:

- `http://localhost:5174/`

## Scripts

- `npm run dev`: runs Vite locally
- `npm run typecheck`: checks all application TypeScript without emitting files
- `npm run build`: checks types, then creates a production build
- `npm run preview`: serves the built app locally
- `npm run lint`: runs ESLint
- `npm run lint:fix`: runs ESLint with autofix
- `npm run format`: formats the repo with Prettier
- `npm run format:check`: checks formatting without writing changes
- `npm test`: runs the full Vitest suite
- `npm run test:watch`: runs Vitest in watch mode
- `npm run test:unit`: runs unit tests under `test/unit`
- `npm run test:smoke`: runs smoke tests under `test/smoke`
- `npm run test:e2e`: runs desktop Chromium, desktop WebKit, and mobile WebKit tests

For browser tests, first run `npx playwright install --with-deps chromium webkit`.

## TypeScript Foundation

Application modules use strict TypeScript; tests and build configs remain JavaScript.
Vite bundles the application, while `npm run typecheck` checks types. Production builds,
including CI and deployment, run the type check before bundling.

`src/board/model.ts` defines the shared drawing commands, snapshots, validation, and cloning.
Storage reads are treated as unknown until normalized. Version 1 drawings migrate to isolated
version 2 metadata and chunks; the original version 1 records remain intact.

New command types must be handled explicitly in cloning and rendering. Keep drawing points
in board coordinates (CSS pixels): future zoom should transform input and rendering rather
than rewrite saved points. TypeScript dependencies are development-only; drawing and storage
remain local to the browser.

## Text Tool

Select **Text**, then click or tap the board to type. The editor supports selected-word bold,
italic, text color, highlighting, and font size, with alignment per paragraph. Highlight offers
yellow, green, blue, pink, and orange backgrounds; choose **None** to remove it. Select words
to highlight them, or choose a color at the caret to highlight text as you type. Highlighting
preserves other formatting and stays with the text when saved, recovered, or exported to PNG.
Enter adds a line; text auto-sizes
without wrapping. Pasted content is plain text. A system font keeps text independent of web fonts.

Use **Done**, Ctrl/Cmd+Enter, or click outside to finish. Escape cancels the edit (or closes an
open formatting popup first). While editing, undo/redo operates inside the editor. Finishing an
edit creates one board history entry. Unfinished drafts autosave locally and reopen after reload.

Click a block to select it, use **Edit** or double-click to re-edit, and drag **Move** to reposition.
Arrow keys move selected text by one pixel; Shift moves by ten. Delete removes the selected block.
The eraser removes whole text blocks; each gesture can be undone in one step. Text stays above
freehand drawing and is included in PNG exports; controls and selection outlines are excluded.

Only one editor is mounted at a time. The editor runtime loads when Text is first selected;
committed text uses a separate transparent canvas and a board-owned JSON format. No server,
external fonts, or collaboration service is required.

## Persistence Model

- board drawings are stored in IndexedDB when available, with `localStorage` fallback/migration helpers
- color, language, and related UI preferences use browser storage
- unfinished text drafts use a separate localStorage recovery record; failed board saves retain recovery data
- IndexedDB saves report success after transaction completion; localStorage quota errors report failure

## Automation

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm ci`, `npm run lint`, `npm test`, `npm run build`, and Playwright browser tests on pushes and pull requests
- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds `dist/` with Node 24 and deploys GitHub Pages on pushes to `main` or manual dispatch
- custom-domain deploys still require the repository's GitHub Pages custom domain setting and a DNS `CNAME` for `board.zoni.edu`
