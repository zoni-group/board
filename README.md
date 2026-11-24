# ZONI® Board

ZONI® Board is a full-screen local drawing board by [ZONI](https://zoni.edu), deployed at https://board.zoni.edu.
It is optimized for touch screens, with pen/eraser tools, editable rich text, pan and zoom, brush size control, color presets, local autosave, and PNG downloads.

- Production site: https://board.zoni.edu
- Repository: https://github.com/zoni-group/board
- Creator: Oscar Perez | ZONI

## App

`index.html` loads the board from [`src/board/board.ts`](src/board/board.ts).

What it does:

- full-screen drawing canvas with pen types (pen, see-through highlighter, fading laser pointer) and an eraser
- brush size control (while the eraser is selected, the same slider sets the eraser's own, larger size), preset swatches, and an `iro` color picker
- editable, movable text blocks with selected-word formatting
- images, formatted tables, and video cards through the Text button's **Add object** picker
- undo, redo, clear, PNG download, and PDF import/export (one board page per PDF page)
- multiple named boards with local autosave in IndexedDB and portable `.zoniboard` backups
- per-board paper (blank, grid, lined, dotted; paper colors), a Light/Dark/System theme choice, and
  storage details in **Settings**
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
- `npm run test:e2e:offline`: builds, then checks offline loading and editing in Chromium

For browser tests, first run `npx playwright install --with-deps chromium webkit`.

## TypeScript Foundation

Application modules use strict TypeScript; tests and build configs remain JavaScript.
Vite bundles the application, while `npm run typecheck` checks types. Production builds,
including CI and deployment, run the type check before bundling.

`src/board/model.ts` defines the shared drawing commands, snapshots, validation, and cloning.
Storage reads are treated as unknown until validated against the single current format.
The initial library uses version 1; prototype storage is ignored. There are no legacy readers,
migrations, or saved-generation chains.
Each pen stroke receives a stable identity, including strokes in redo history. Small edit commands
record translation and style changes without duplicating or rewriting the original points.

New command types must be handled explicitly in cloning and rendering. Keep drawing points
in board coordinates (CSS pixels at 100% zoom): zoom transforms input and rendering rather
than rewrite saved points. TypeScript dependencies are development-only; drawing and storage
remain local to the browser.

## Pen Types

The Pen button doubles as the pen-type menu, so the toolbar keeps its size. The first tap selects
the pen with its last type. Tapping the active Pen again opens **Pen**, **Highlighter**, and
**Laser**. Escape or a tap outside closes the menu. The button shows the current type, and the
choice is remembered on this device.

- **Pen:** regular ink, unchanged.
- **Highlighter:** a see-through marker for text, images, tables, and worksheets. Highlights
  always render under pen ink and text, so marked content stays readable. They keep their bright
  color instead of the pen's contrast adjustment. Pen and Highlighter each remember their own
  color and size (the highlighter starts amber at 18). Highlights select, move, restyle, erase,
  undo, autosave, and export like any other stroke. On a stroke, only `pen: "highlighter"` is
  stored. Strokes without it are regular ink, so existing boards and `.zoniboard` files need no
  migration.
- **Laser:** a glowing red trail for pointing during explanations. Its width is fixed on screen.
  The trail fades about one second after lifting, and older parts disappear while pointing. It
  is drawn on its own overlay and never creates a board command. Undo, autosave, and PNG export
  never see it. A second finger cancels it, like any unfinished stroke.

## Selecting and Editing Objects

Choose **Select** (the pointer beside Hand), or press **V** with the board focused. Click or tap
one pen stroke, text block, shape, image, table, or video card to select it. Drag the object to move it; clicking empty
space deselects. Text is picked above shapes, and shapes above ink, following the drawing's
visible layer order. Images, tables, and video cards sit beneath ink in their creation order.
Each pen-down/up gesture is one object; freehand drawings with several
strokes are edited one stroke at a time.

Use **Delete** or Delete/Backspace to remove the selected object. **Done** or Escape deselects;
Escape during movement or resizing cancels that unfinished change. Arrow keys move by one board
unit; Shift moves by ten. Existing shape handles and Shift/Alt+arrow resizing work in Select too.
Selection itself and clicks without movement do not add undo entries. **Clear** still removes the
whole board, with undo available.

The existing color picker and width slider change a selected pen stroke or shape without leaving
Select. A continuous adjustment commits one undoable edit. For text, choose **Edit**, press Enter,
or double-click to use the existing rich-text editor. The brush controls are disabled for text in
Select; text formatting stays in its editor. Finishing or cancelling the editor returns to Select.

Partial erasing stays with each pen stroke when it moves. Erasing after movement also follows the
stroke on later moves; other strokes are not affected by that object's masks. Picking tests nearby
visible ink, so an erased gap does not select an invisible stroke. Fully erased ink can remain in
history until Clear; Fit bounds remain conservative, as with the existing pixel eraser.

Text's Move/Edit shortcuts and Shapes' drawing/editing interactions remain available through the
same selection controller. Two-finger navigation cancels unfinished object movement, including
movement begun with Text's Move handle. Stylus palm rejection, fixed-size controls, local saving,
undo/redo, Fit and whole-board PNG export apply to all object edits. Selection outlines and handles
are temporary and never saved or exported.

### Select modes: Select one, Box, Lasso

Tapping the active **Select** button opens its modes, the same way the Pen button opens pen types.
The menu opens above the navigation strip, the button shows the current mode, and the choice is
remembered on this device.

- **Select one** (default) is the behavior described above. Dragging on empty space only
  clears the selection.
- **Box** drags a dashed rectangle on empty space, and **Lasso** draws a freeform loop. A stroke
  is caught when at least 75% of its points are inside, so a loose loop still catches a whole
  handwritten word. Shapes, text, and media are caught when their center and at least three
  corners are inside.
- Catching one object makes a normal single selection with its handles and actions. Catching
  two or more makes a **group** with one outline and **Delete**/**Done** actions. An empty or
  tiny region clears the selection. Tapping an object still selects only that object in every
  mode.
- Drag inside a group's outline, or use the arrow keys (Shift: ten units), to move every member.
  Delete/Backspace removes them, and Escape clears the selection or cancels an unfinished move or
  region. The color and size controls restyle every stroke and shape in the group. They stay
  disabled when the group holds only text and media.
- Each group move, delete, or restyle is a single `batch` command, so one Undo reverts it.
  Batches contain ordinary object commands, are never nested, and never contain Clear.
  `expandCommands` in `model.ts` is the only reader that needs to know about them. Same-kind
  deletes are stored as one plain delete command.
- A second finger, pan, or zoom cancels an unfinished region or group move. Switching tools
  clears the group.

Resizing or rotating a group, Shift-tap to add objects, copy/duplicate, pen/text geometry
resizing, rotation, and new fill/opacity attributes are outside this version's scope. No remote
storage is added.

## Images, Tables, and Videos

The former Text button is now **Add object**, with four choices: **Text**, **Image**, **Table**,
and **Video**. Shapes retain their separate button. The object button displays the last choice;
opening it always shows all four options.

- **Image:** choose PNG, JPEG, or WebP (up to 10 MiB), drop one file onto the board, or paste an
  image while the board has focus. Images larger than 4096 pixels on their longest side are
  reduced before saving. Images preserve their proportions when resized with selection handles.
- **Table:** choose an initial row/column count (3 × 3 by default). The lazy-loaded notectl editor
  supports bold/italic text, sizes, colors, highlights, alignment, row/column insertion and deletion,
  border colors, column widths, and minimum row heights. Text wraps and rows grow to fit. Use
  **Done** or Ctrl/⌘+Enter to save one board operation, or **Cancel**/Escape to discard the session.
  Edit a selected table with **Edit**, Enter, or double-click. Tables support up to 50 rows and
  20 columns; merged/nested cells, formulas, and media inside cells are outside this version.
- **Video:** import MP4/WebM (up to 100 MiB, depending on browser codec support), or enter an HTTPS
  YouTube/Vimeo video URL. Select the card and choose **Play video**, press Enter, or double-click
  to open a focused player. Playback uses native controls or the provider's player. Closing the
  player stops playback. Hosted videos require a connection; provider requests start only when
  the player is opened. No remote thumbnails or metadata are fetched during insertion.

Images and videos live in the library's IndexedDB asset store and belong to their board. Binary
media never enters command history or `localStorage`; commands contain asset IDs and metadata.
Asset saving must complete before insertion. Imports report unavailable/full storage without
adding broken objects. Clear retains media for Undo/Redo; deleting a board removes its owned
media. Clearing browser site data removes the entire locally saved library.

Select moves and deletes all three object types. Images/video cards have corner resize handles;
table dimensions are adjusted in its editor. Erasing annotations preserves underlying media and
tables. Fit and PNG export include every object, including those beyond the current view. PNGs
contain image pixels, formatted tables, and video poster/title cards. Missing assets remain as
identifiable placeholders. Dialogs scroll internally and keep the navigation strip visible.

## Text Tool

Open **Add object** (the former Text button), choose **Text**, then click or tap the board to type. The editor supports selected-word bold,
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

## Shapes Tool

Select **Shapes**, then choose **Rectangle**, **Ellipse**, **Line**, or **Arrow**. Drag to draw
with a live preview. Hold Shift for a square/circle or line angles in 45-degree
increments. The current color and width controls apply to new shapes. Interiors stay transparent.

While Shapes is active, tap a shape to select it, drag its body to move it, and drag a corner
handle to resize a rectangle/ellipse. Lines and arrows have two endpoint handles; their direction
is preserved. Hold Shift while resizing for the same constraints. Change color or width to restyle
the selection. **Delete** removes it; **Done**, Escape, or changing tools dismisses the selection.
Choosing a shape kind also dismisses selection, so the next drag can draw inside or across
existing shapes. A tap selects an existing shape; a drag moves it once it is selected.
On the focused board, arrow keys move the selection by one board unit (Shift: ten);
Alt+arrows resize by moving its end corner/endpoint. Delete/Backspace removes it.

Each drawing, move, resize, or style gesture is one undoable edit. Clicks without a drag do not
create tiny shapes. Escape, pointer cancellation, capture loss, or a second touch cancels an
unfinished shape or transform. Two-finger pan/zoom and stylus palm rejection use the same routing
as freehand drawing. Handles and controls keep their screen size while shapes zoom with the board.

The eraser removes a whole shape when it touches the outline; crossing an empty interior alone
does not remove it. A single eraser gesture can remove several shapes and text blocks along with
ink, and undo restores them together. Shapes remain editable after local autosave and reload.
They render above freehand ink and below text, in shape creation order; editing retains that order.
Fit and whole-board PNG export include shapes and arrowheads, including offscreen content.
Selection outlines, handles, and previews are excluded from exports.

Shapes use the existing Canvas renderer and strict TypeScript command model, with no new runtime
dependencies. Their viewport-sized transparent layer avoids allocating a canvas as large as the
workspace. Grouping, rotation, fills, and connected diagram editing are outside this tool's scope.

## Offline Use

After one online visit, the board opens and every tool works without a connection. This
includes the lazily loaded text, table and board-file editors. A build step
(`build/offline-plugin.js`) emits `/sw.js` from `src/offline/service-worker.js` and precaches
every built file plus the app icons. Boards and media were already stored locally.

- Updates are silent: a new deploy installs in the background and is used on the next launch
  or reload. The page is never reloaded mid-lesson. The previous version's cache is kept, so an
  older open page can still load its own chunks.
- Hosted YouTube/Vimeo videos still need a connection; local video files work offline.
- The service worker is only registered in production builds, never in `npm run dev`.
- Test locally with `npm run build && npm run preview`, or run `npm run test:e2e:offline`.
- To remove it from production, deploy a `sw.js` that calls `self.registration.unregister()`.

## Moving and Zooming

The workspace has no visible edges. Pan to reveal more space; drawing content moves and scales
while the tools stay at their normal screen size. The navigation strip stays in the lower-right corner:

- **Hand**: drag with a mouse or one finger to move the view. Choose a drawing tool to resume drawing.
- **− / +**: zoom out or in around the center. Zoom ranges from 50% to 400%, keeping the smallest brush at least one screen pixel wide.
- **Percentage**: reset to 100% while keeping the current center.
- **Fit drawing**: center the drawing with padding, between 50% and 100% zoom. If the entire drawing cannot fit at 50%, pan to see the rest. On an empty board it restores the initial view.

With a drawing tool selected, one finger draws or taps to place text. Two fingers move the view
and pinch to zoom. Adding a second finger cancels the unfinished touch stroke or eraser gesture;
the remaining finger cannot accidentally draw until all fingers lift. Touches are ignored while
a stylus is drawing.

On desktop, Space+drag or middle-button drag temporarily pans without changing tools. Wheel or
trackpad scrolling pans; Ctrl/Cmd+wheel or trackpad pinch zooms around the pointer. With the board
focused, use **+**, **−**, **0**, or **F** for zoom in, zoom out, 100%, or Fit. Arrow keys pan with
Hand selected (Shift moves farther). These shortcuts do not interrupt typing.

The last position and zoom save locally, separately from drawing history. Navigation does not
change undo/redo. Resizing preserves the view center; Clear preserves the current view.
Older saved views below 50% reopen at 50% while keeping their center.
The app fits the visible screen without page scrolling, including short landscape views and
the space remaining above a mobile keyboard. Navigation stays visible at its normal size;
long text and color/formatting popovers can scroll internally, with their actions kept reachable.
Text blocks move freely beyond the screen edges. Their editor stays at a readable screen size;
finishing an edit places the text back at the board's zoom level. Starting navigation finishes an
active text edit, except while composing text with an input method.

**Save PNG** includes the whole drawing, including offscreen content, with a 32-unit margin,
independently of the current zoom. It renders at one pixel per board unit and reduces resolution
uniformly above 4096 pixels per side or 8 megapixels; the status message reports this reduction.
The image keeps the board background, erasing, shapes, text, and highlighting. Conservative stroke bounds
can leave whitespace after pixel erasing. An empty drawing exports a viewport-sized blank image.

## Boards and Portable Backups

**Boards** replaces the separate Clear and Save PNG toolbar buttons. The primary toolbar has
seven buttons; navigation remains separate and visible.

- **New board** opens an automatically named blank board. **Open boards…** lists saved boards,
  most recently updated first. Open a board by name, rename it inline, or delete it after confirming
  its name. Deleting the last board creates a fresh blank one.
- The last active board reopens on startup. Each board keeps its own history, viewport, and text
  draft. Switching finishes text/table edits, cancels unfinished gestures/imports, and saves before
  replacing the open board. If saving fails, switching stops and the current work remains available.
- **Clear drawing** is undoable. **Delete board** removes its history and media permanently after
  confirmation. These are separate operations.
- **Export board** downloads an editable `.zoniboard` file. **Export all boards** downloads a single
  library backup. Both include full Undo/Redo history, media referenced by earlier edits, and camera
  positions. Hosted videos remain provider links; no remote media is downloaded.
- **Import boards…** adds independent copies with new IDs, retaining the originals. Duplicate names
  receive numbered suffixes. After importing, the exported active board opens.
- **Save PNG** exports the current board as an image named after the board. Editable exports keep
  objects and history; PNGs are flattened images.
- **Save PDF** exports every page of the board, in order, as one PDF named after the board. Each PDF
  page is the page's whole drawing, like Save PNG, at twice the resolution for print, and prints
  at the size it is drawn (96 board units per inch).

## Pages

A board can hold a lesson as a series of pages. **Boards → Add page** adds a blank page after the
current one. Once a board has two or more pages, a small **‹ 2 / 5 ›** control appears at the
bottom left (one row above the zoom bar on phones); **PageUp**/**PageDown** also change pages, so
presenter clickers work. Tap the page number for the **Page menu**:

- **Add page** and **Duplicate page** insert after the current page and open it. A duplicate copies
  the drawing, its Undo history and the view.
- **Move earlier** / **Move later** swap the page with its neighbor.
- **Delete page** removes the page at once when it is empty and asks first when it has drawing or
  history. With one page left, the control hides again.

Each page has its own drawing, Undo history and view; the board name and paper are shared. Page
actions are not Undo steps. **Save PNG** exports the current page; **Save PDF** and board exports
include every page.

### PDF worksheets

**Boards → Insert PDF…**, or dropping a PDF on the board, turns each PDF page into a new board page
after the current one, with the PDF page as an image to write on. The progress panel shows the page
being read and can be cancelled; nothing is added until every page is ready. PDFs up to 50 MB are
accepted. When the board has room for fewer pages than the PDF has (a board holds up to 200), the
first pages that fit are inserted and the status line says so. Pages arrive as images, so their text
can't be selected or edited. Password-protected PDFs aren't supported. The PDF reader
([pdf.js](https://mozilla.github.io/pdf.js/)) loads only when first used and is cached for offline
use.

## Presenting

- **Full screen**: the last button in the zoom bar hides the browser bars on a projector or
  interactive whiteboard; press it again or Esc to leave. It is hidden where the browser can't go
  full screen, such as Safari on iPhone (adding the board to the Home Screen fills the screen
  instead).
- **Boards → Lock board** protects the board on a shared screen. The editing toolbar, the Board menu
  and the Page menu are replaced by a **Locked** pill. Moving, zooming, Fit, the page arrows,
  PageUp/PageDown and Full screen keep working; drawing, objects, Undo/Redo, Clear, paste and drop
  don't. **Press and hold Locked for a second** to unlock; a tap only shows a hint. The lock is
  kept on this device, so reloading the page doesn't unlock it.

## Settings

**Boards → Settings…** opens one panel; it adds no toolbar buttons. Every change applies at once.

- **Board:** rename the open board (Enter, leaving the field, or Done saves it).
- **Paper:** pattern (**Blank**, **Grid**, **Lined**, **Dotted**), spacing (**Small**, **Medium**,
  **Large**: 16, 32, 64 board units) and paper color (**Auto** follows the theme; **White**,
  **Cream**, **Green chalkboard**, **Blackboard**). The paper is saved per board, travels in
  `.zoniboard` exports, pans and zooms with the drawing, and is included in **Save PNG**. It is a
  board setting, not an Undo step. When zoomed out, lines thin out so they stay at least 8 px apart.
  On dark paper the ink presets switch to their light variants; ink contrast adapts as before.
- **Appearance:** **System**, **Light** or **Dark** for the whole app, remembered on this device.
- **Storage:** how much browser storage the app uses (`navigator.storage.estimate()`), the number
  of boards, and **Keep boards on this device**, which asks the browser not to clear the boards when
  space runs low (`navigator.storage.persist()`). Browsers decide whether to grant it; exporting
  remains the reliable backup. **Free up space** asks first, then removes the Undo history from
  before each page's last Clear and the Redo stacks on every board, deletes the images and videos
  nothing uses anymore, and reports how much space was freed. The drawings stay as they are.

Transfer a `.zoniboard` file to another computer/browser and choose Import boards there. Exports
are snapshots: later edits continue saving in the browser, so export again to update the file.
Import/export shows progress and can be cancelled. Invalid files, missing media, unsupported
versions, and storage failures leave existing boards intact. Unsaved in-memory work can still
be exported when local saving fails. Concurrent edits to the same board in another tab are
rejected; export unsaved work before reloading that tab.

The only new runtime package is lazy-loaded `fflate` for ZIP import/export. Version 1 archives use
uncompressed entries, binary assets, and SHA-256 payload checksums. They accept only the current
ZONI Board format, with a 32 MiB manifest limit and the classic ZIP size limit (under 4 GiB).
Large libraries can be exported one board at a time.

## Persistence Model

- One database, `zoni-board-library` version 1, has `boards`, `assets`, and `meta` stores.
- Each board document stores its metadata, drawing/redo commands, viewport, recoverable text
  draft, and paper background. The open page uses the flat drawing fields; boards with several
  pages also store the others in `pages` with `pageIndex` and are written as document version 2,
  while one-page boards keep the version 1 layout.
- Images and videos are separate `assets` records tagged with their board. A record stays while any
  page's Undo or Redo history refers to it, so Clear and Undo can always bring it back. A moment
  after a page is deleted, after new drawing replaces a Redo stack that held media, and when a
  board opens, the app deletes that board's media that no history refers to anymore. It decides
  from the saved board and never during a media insert. **Settings → Storage → Free up space**
  also frees media kept only by history from before a Clear. A missing or invalid background loads as blank paper with Auto color. The catalog lists board summaries without loading complete drawings.
- Atomic transactions update board documents and catalog entries together; a failed transaction
  preserves the last successful save. Imports publish boards and assets in one transaction.
- Each board has its own save queue and revision; stale or deleted-board writes are rejected.
- Media ownership makes deleting a board independent of other boards. Imported copies get their
  own media identities. Unreferenced media retained by an editing session is removed with its board.
- IndexedDB is required for durable board storage. `localStorage` holds only shared UI preferences
  such as language, theme, and ink color; there is no drawing fallback or compatibility layer.
- Prototype single-board databases and keys are ignored. Only the current library/archive format
  is supported; older or newer format versions are not converted.

## Automation

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm ci`, `npm run lint`, `npm test`, `npm run build`, and Playwright browser tests on pushes and pull requests
- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds `dist/` with Node 24 and deploys GitHub Pages on pushes to `main` or manual dispatch
- custom-domain deploys still require the repository's GitHub Pages custom domain setting and a DNS `CNAME` for `board.zoni.edu`
