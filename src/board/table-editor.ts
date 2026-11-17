import {
  createEditor,
  createDocument,
  createBlockNode,
  createTextNode,
  nodeType,
  ThemePreset,
  Locale,
  isTextNode,
  insertTextCommand,
  splitBlockCommand,
} from '@notectl/core';
import type { Document as EditorDocument, BlockNode, Plugin, PluginContext } from '@notectl/core';
import { TablePlugin } from '@notectl/core/plugins/table';
import { TextFormattingPlugin } from '@notectl/core/plugins/text-formatting';
import { FontSizePlugin } from '@notectl/core/plugins/font-size';
import { TextColorPlugin } from '@notectl/core/plugins/text-color';
import { HighlightPlugin } from '@notectl/core/plugins/highlight';
import { AlignmentPlugin } from '@notectl/core/plugins/alignment';
import { ToolbarOverflowBehavior } from '@notectl/core/plugins/toolbar';
import { fromEditorDocument, toEditorDocument } from './text-editor.ts';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, normalizeContentObject } from './model.ts';
import type { TableObject } from './model.ts';
import type { Language } from '../i18n.ts';
import { t } from '../i18n.ts';
import { constrainPopup } from './screen-layout.ts';

export function toTableDocument(object: TableObject): EditorDocument {
  return createDocument([
    createBlockNode(
      nodeType('table'),
      object.rows.map((row) =>
        createBlockNode(
          nodeType('table_row'),
          row.cells.map((paragraphs) =>
            createBlockNode(
              nodeType('table_cell'),
              toEditorDocument({ id: object.id, position: object.position, paragraphs }).children
            )
          ),
          undefined,
          { minHeightPx: row.minHeight }
        )
      ),
      undefined,
      { columnWidthsPx: object.columnWidths, borderColor: object.borderRaw }
    ),
    createBlockNode(nodeType('paragraph'), [createTextNode('')]),
  ]);
}
function blocks(node: BlockNode): BlockNode[] {
  return node.children.filter((child): child is BlockNode => 'id' in child);
}
/** Only one rectangular text table belongs to a board object. Never silently drop content. */
export function isSafeTableDocument(doc: EditorDocument): boolean {
  let tables = 0;
  for (const block of doc.children) {
    if (block.type !== 'table') {
      if (
        block.type !== 'paragraph' ||
        block.children.some((child) => !isTextNode(child) || child.text.trim())
      )
        return false;
      continue;
    }
    if (++tables > 1) return false;
    const rows = blocks(block);
    if (!rows.length || rows.length > MAX_TABLE_ROWS) return false;
    const columns = blocks(rows[0]).length;
    if (!columns || columns > MAX_TABLE_COLUMNS) return false;
    for (const row of rows) {
      if (row.type !== 'table_row' || blocks(row).length !== columns) return false;
      for (const cell of blocks(row)) {
        if (
          cell.type !== 'table_cell' ||
          (cell.attrs?.colspan ?? 1) !== 1 ||
          (cell.attrs?.rowspan ?? 1) !== 1
        )
          return false;
        for (const paragraph of blocks(cell))
          if (
            paragraph.type !== 'paragraph' ||
            paragraph.children.some((child) => !isTextNode(child))
          )
            return false;
      }
    }
  }
  return true;
}
export function fromTableDocument(
  doc: EditorDocument,
  original: TableObject,
  inkRaw: string,
  measuredWidths: number[] = []
): TableObject | null {
  if (!isSafeTableDocument(doc)) throw new Error('invalidTable');
  const table = doc.children.find((block) => block.type === 'table');
  if (!table) return null;
  const rows = blocks(table);
  const rawWidths = table.attrs?.columnWidthsPx;
  const widths = Array.isArray(rawWidths) ? rawWidths : [];
  const columnWidths = blocks(rows[0]).map((_, i) => {
    const width = widths[i] ?? measuredWidths[i] ?? original.columnWidths[i] ?? 160;
    return typeof width === 'number' && Number.isFinite(width)
      ? Math.max(60, Math.min(10000, width))
      : 160;
  });
  const object = normalizeContentObject({
    ...original,
    columnWidths,
    borderRaw: table.attrs?.borderColor ?? original.borderRaw,
    rows: rows.map((row) => ({
      minHeight:
        typeof row.attrs?.minHeightPx === 'number'
          ? Math.max(24, Math.min(10000, row.attrs.minHeightPx))
          : 48,
      cells: blocks(row).map(
        (cell) =>
          fromEditorDocument(
            createDocument(blocks(cell)),
            { id: original.id, position: original.position, paragraphs: [] },
            inkRaw,
            24
          ).paragraphs
      ),
    })),
  });
  if (object?.kind !== 'table') throw new Error('invalidTable');
  return object;
}
class TableAppearance implements Plugin {
  readonly id = 'board-table';
  readonly name = 'Board table';
  readonly dependencies = ['table'];
  readonly priority = 20;
  constructor(private readonly report: (message: string) => void) {}
  private observer: MutationObserver | null = null;
  private root: ShadowRoot | null = null;
  private frame: number | null = null;
  private readonly position = () => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.root?.querySelectorAll<HTMLElement>('.notectl-popup').forEach(constrainPopup);
    });
  };
  init(context: PluginContext) {
    context.getToolbarRegistry().removeToolbarItem('table');
    context.registerMiddleware((transaction, state, next) => {
      if (isSafeTableDocument(state.apply(transaction).doc)) next(transaction);
      else {
        context.announce(t('tableLimits'));
        this.report(t('tableLimits'));
      }
    });
    context.registerStyleSheet(`
      :host { --notectl-content-min-height: 48px; }
      [part~="editor"] { border:0; box-shadow:none; }
      [part~="content"] { padding:24px; font-family:Arial,Helvetica,sans-serif; font-size:24px; line-height:1.2; white-space:pre-wrap; overflow-wrap:anywhere; touch-action:auto; }
      [part~="content"] p { margin:0; padding:0; line-height:1.2; min-height:1.2em; }
      [part~="content"] > p { min-height:4px; height:4px; font-size:1px; }
      [part~="table"] { margin:0; }
      .ntbl-container { width:max-content; max-width:none; }
      .notectl-table { border-collapse:collapse; table-layout:fixed; }
      [part~="table-cell"] { padding:8px; vertical-align:top; font-size:24px; line-height:1.2; }
      [part~="plugin-container-top"] { position:sticky; top:0; z-index:5; }
    `);
    const root = context.getContainer().getRootNode();
    if (root instanceof ShadowRoot) this.root = root;
  }
  onReady() {
    if (!this.root) return;
    this.observer = new MutationObserver(this.position);
    this.observer.observe(this.root, { childList: true, subtree: true });
    this.root.addEventListener('scroll', this.position, true);
    document.addEventListener('board:layout', this.position);
  }
  destroy() {
    this.observer?.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.root?.removeEventListener('scroll', this.position, true);
    document.removeEventListener('board:layout', this.position);
  }
}
export async function openTableEditor(
  object: TableObject,
  ink: string,
  lang: Language,
  dark: boolean,
  changed: () => void,
  report: (message: string) => void
) {
  const editor = await createEditor({
    toolbar: {
      overflow: ToolbarOverflowBehavior.Flow,
      groups: [
        [
          new TextFormattingPlugin({
            bold: true,
            italic: true,
            underline: false,
            inputRule: false,
          }),
        ],
        [
          new FontSizePlugin({ defaultSize: 24, sizes: [16, 24, 32, 48, 64, 96] }),
          new TextColorPlugin(),
          new HighlightPlugin({ colors: ['#fff176', '#aed581', '#64b5f6', '#f48fb1', '#ffab91'] }),
        ],
        [
          new AlignmentPlugin({
            alignments: ['start', 'center', 'end'],
            alignableTypes: ['paragraph'],
          }),
        ],
      ],
    },
    plugins: [new TablePlugin({ maxPickerRows: 1, maxPickerCols: 1 }), new TableAppearance(report)],
    markdown: false,
    placeholder: '',
    locale: lang === 'es' ? Locale.ES : Locale.EN,
    theme: dark ? ThemePreset.Dark : ThemePreset.Light,
  });
  editor.setJSON(toTableDocument(object));
  editor.on('stateChange', changed);
  editor.on('selectionChange', changed);
  editor.shadowRoot?.addEventListener(
    'paste',
    (event) => {
      if (!(event instanceof ClipboardEvent)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .forEach((line, index) => {
          if (index) {
            const tr = splitBlockCommand(editor.getState());
            if (tr) editor.dispatch(tr);
          }
          if (line) editor.dispatch(insertTextCommand(editor.getState(), line, 'paste'));
        });
    },
    true
  );
  return {
    element: editor,
    read: () =>
      fromTableDocument(
        editor.getJSON(),
        object,
        ink,
        Array.from(editor.shadowRoot?.querySelectorAll('col') ?? []).map(
          (col) => col.getBoundingClientRect().width
        )
      ),
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    canUndo: () => editor.can().undo(),
    canRedo: () => editor.can().redo(),
    focus() {
      const table = editor.getJSON().children.find((block) => block.type === 'table');
      const row = table && blocks(table)[0],
        cell = row && blocks(row)[0],
        paragraph = cell && blocks(cell)[0];
      if (table && row && cell && paragraph)
        editor.dispatch(
          editor
            .getState()
            .transaction()
            .setSelection({
              anchor: {
                blockId: paragraph.id,
                offset: 0,
                path: [table.id, row.id, cell.id, paragraph.id],
              },
              head: {
                blockId: paragraph.id,
                offset: 0,
                path: [table.id, row.id, cell.id, paragraph.id],
              },
            })
            .build()
        );
      editor.shadowRoot
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?.focus({ preventScroll: true });
    },
    configure: (language: Language, isDark: boolean) =>
      editor.configure({
        locale: language === 'es' ? Locale.ES : Locale.EN,
        theme: isDark ? ThemePreset.Dark : ThemePreset.Light,
      }),
    destroy() {
      editor.off('stateChange', changed);
      editor.off('selectionChange', changed);
      void editor.destroy().catch(() => {});
      editor.remove();
    },
  };
}
export type TableEditorSession = Awaited<ReturnType<typeof openTableEditor>>;
