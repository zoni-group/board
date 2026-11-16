# ZONI® Board

ZONI® Board is a full-screen local drawing board by [ZONI](https://zoni.edu), deployed at https://board.zoni.edu.
It is optimized for touch screens, with pen/eraser tools, brush size control, color presets, local autosave, and PNG downloads.

- Production site: https://board.zoni.edu
- Repository: https://github.com/zoni-group/board
- Creator: Oscar Perez | ZONI

## App

`index.html` loads the board from [`src/board/board.ts`](src/board/board.ts).

What it does:

- full-screen drawing canvas with pen and eraser tools
- brush size control, preset swatches, and an `iro` color picker
- undo, redo, clear, and PNG download
- local autosave of drawing history using IndexedDB with `localStorage` fallback
- English/Spanish language toggle

## Stack

- Vite 7 single-page build
- Vanilla TypeScript ES modules with strict type checking
- LESS for styling
- `@jaames/iro` for the color picker
- Vitest + jsdom for unit and smoke tests
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

## TypeScript Foundation

Application modules use strict TypeScript; tests and build configs remain JavaScript.
Vite bundles the application, while `npm run typecheck` checks types. Production builds,
including CI and deployment, run the type check before bundling.

`src/board/model.ts` defines the shared drawing commands, snapshots, validation, and cloning.
Storage reads are treated as unknown until normalized. Existing version 1 drawings, storage
keys, chunking, and recovery behavior remain compatible.

New command types must be handled explicitly in cloning and rendering. Keep drawing points
in board coordinates (CSS pixels): future zoom should transform input and rendering rather
than rewrite saved points. TypeScript dependencies are development-only; drawing and storage
remain local to the browser.

## Persistence Model

- board drawings are stored in IndexedDB when available, with `localStorage` fallback/migration helpers
- color, language, and related UI preferences use browser storage

## Automation

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm ci`, `npm run lint`, `npm test`, and `npm run build` on pushes and pull requests
- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds `dist/` with Node 24 and deploys GitHub Pages on pushes to `main` or manual dispatch
- custom-domain deploys still require the repository's GitHub Pages custom domain setting and a DNS `CNAME` for `board.zoni.edu`
