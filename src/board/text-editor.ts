import {
  createEditor,
  createDocument,
  createBlockNode,
  createTextNode,
  nodeType,
  markType,
  insertTextCommand,
  splitBlockCommand,
  ThemePreset,
  Locale,
  isTextNode,
} from '@notectl/core';
import type {
  Document as EditorDocument,
  Mark,
  Plugin,
  PluginContext,
  EditorState,
} from '@notectl/core';
import { TextFormattingPlugin } from '@notectl/core/plugins/text-formatting';
import { FontSizePlugin } from '@notectl/core/plugins/font-size';
import { TextColorPlugin } from '@notectl/core/plugins/text-color';
import { HighlightPlugin } from '@notectl/core/plugins/highlight';
import { ToolbarOverflowBehavior } from '@notectl/core/plugins/toolbar';
import { AlignmentPlugin } from '@notectl/core/plugins/alignment';
import type { Language } from '../i18n.ts';
import type { TextObject, TextRun } from './model.ts';
import { DEFAULT_TEXT_SIZE, TEXT_FONT } from './text-layout.ts';
import { constrainPopup } from './screen-layout.ts';

const DEFAULT_RUN: Omit<TextRun, 'text'> = {
  fontSize: DEFAULT_TEXT_SIZE,
  inkRaw: '#111827',
  bold: false,
  italic: false,
};

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/^#[\da-f]{3}$/i.test(value))
    return (
      '#' +
      value
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('')
    );
  return /^#[\da-f]{6}$/i.test(value) ? value : undefined;
}

export function toEditorDocument(object: TextObject): EditorDocument {
  return createDocument(
    object.paragraphs.map((p) =>
      createBlockNode(
        nodeType('paragraph'),
        p.runs.map((run) => {
          const marks: Mark[] = [
            { type: markType('fontSize'), attrs: { size: `${run.fontSize}px` } },
            { type: markType('textColor'), attrs: { color: run.inkRaw } },
          ];
          if (run.bold) marks.push({ type: markType('bold') });
          if (run.italic) marks.push({ type: markType('italic') });
          if (run.highlightRaw)
            marks.push({ type: markType('highlight'), attrs: { color: run.highlightRaw } });
          return createTextNode(run.text, marks);
        }),
        undefined,
        { align: p.align === 'left' ? 'start' : p.align === 'right' ? 'end' : 'center' }
      )
    )
  );
}

export function fromEditorDocument(
  doc: EditorDocument,
  object: TextObject,
  inkRaw: string,
  defaultSize = DEFAULT_TEXT_SIZE
): TextObject {
  return {
    ...object,
    position: { ...object.position },
    paragraphs: doc.children.flatMap((block) => {
      const paragraphs: TextObject['paragraphs'] = [
        {
          align:
            block.attrs?.align === 'center'
              ? 'center'
              : block.attrs?.align === 'end'
                ? 'right'
                : 'left',
          runs: [],
        },
      ];
      for (const child of block.children) {
        if (!isTextNode(child)) continue;
        const sizeMark = child.marks.find((m) => m.type === 'fontSize');
        const colorMark = child.marks.find((m) => m.type === 'textColor');
        const highlightMark = child.marks.find((m) => m.type === 'highlight');
        const size = Number.parseFloat(String(sizeMark?.attrs?.size ?? defaultSize));
        const color = normalizeHexColor(colorMark?.attrs?.color) ?? inkRaw;
        const highlightRaw = normalizeHexColor(highlightMark?.attrs?.color);
        const style = {
          fontSize: Number.isFinite(size) ? Math.max(1, Math.min(1000, size)) : DEFAULT_TEXT_SIZE,
          inkRaw: color,
          ...(highlightRaw ? { highlightRaw } : {}),
          bold: child.marks.some((m) => m.type === 'bold'),
          italic: child.marks.some((m) => m.type === 'italic'),
        };
        child.text
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .forEach((text, index) => {
            if (index) paragraphs.push({ align: paragraphs[0].align, runs: [] });
            if (!text) return;
            const runs = paragraphs[paragraphs.length - 1].runs;
            const previous = runs.at(-1);
            if (
              previous &&
              previous.fontSize === style.fontSize &&
              previous.inkRaw === style.inkRaw &&
              previous.highlightRaw === style.highlightRaw &&
              previous.bold === style.bold &&
              previous.italic === style.italic
            )
              previous.text += text;
            else runs.push({ text, ...style });
          });
      }
      return paragraphs;
    }),
  };
}

class BoardAppearance implements Plugin {
  readonly id = 'board-appearance';
  readonly name = 'Board text appearance';
  readonly priority = 200;
  private context: PluginContext | null = null;
  private sheet: CSSStyleSheet | null = null;
  private root: ShadowRoot | null = null;
  private popupObserver: MutationObserver | null = null;
  private popupFrame: number | null = null;
  private readonly positionPopups = () => {
    if (this.popupFrame !== null) return;
    this.popupFrame = window.requestAnimationFrame(() => {
      this.popupFrame = null;
      this.root?.querySelectorAll<HTMLElement>('.notectl-popup').forEach(constrainPopup);
    });
  };
  init(context: PluginContext): void {
    this.context = context;
    context.registerStyleSheet(`
      :host { --notectl-content-min-height: 38.4px; }
      [part~="editor"] { border:0; box-shadow:none; overflow:visible; background:transparent; }
      [part~="content"] { padding:0; white-space:pre; overflow-wrap:normal; word-wrap:normal; overflow-x:auto; font-family:${TEXT_FONT}; font-size:32px; line-height:1.2; touch-action:auto; }
      [part~="content"] p { margin:0; padding:0; min-height:1.2em; line-height:1.2; width:max-content; min-width:100%; }
      [part~="content"]:before { top:0 !important; left:0 !important; }
      [part~="plugin-container-top"] { border:0; margin-bottom:8px; }
      [part~="toolbar"] { border-radius:8px; }
    `);
  }
  onReady(): void {
    const root = this.context?.getContainer().getRootNode();
    if (!(root instanceof ShadowRoot)) return;
    this.root = root;
    this.sheet = new CSSStyleSheet();
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.sheet];
    this.popupObserver = new MutationObserver(this.positionPopups);
    this.popupObserver.observe(root, { childList: true, subtree: true });
    root.addEventListener('scroll', this.positionPopups, true);
    document.addEventListener('board:layout', this.positionPopups);
    if (this.context) this.updateLineSizes(this.context.getState());
  }
  onStateChange(_old: EditorState, state: EditorState): void {
    this.updateLineSizes(state);
  }
  private updateLineSizes(state: EditorState): void {
    // Change CSS outside contentEditable, so layout changes never enter editor history.
    this.sheet?.replaceSync(
      state.doc.children
        .map((block) => {
          const sizes = block.children
            .filter(isTextNode)
            .map((child) =>
              Number.parseFloat(
                String(
                  child.marks.find((mark) => mark.type === 'fontSize')?.attrs?.size ??
                    DEFAULT_TEXT_SIZE
                )
              )
            );
          const size = Math.max(
            1,
            ...sizes.filter(Number.isFinite),
            sizes.length ? 0 : DEFAULT_TEXT_SIZE
          );
          return `[data-block-id="${CSS.escape(block.id)}"] { font-size:${size}px; }`;
        })
        .join('\n')
    );
  }
  destroy(): void {
    this.popupObserver?.disconnect();
    this.root?.removeEventListener('scroll', this.positionPopups, true);
    document.removeEventListener('board:layout', this.positionPopups);
    if (this.popupFrame !== null) window.cancelAnimationFrame(this.popupFrame);
    if (this.root && this.sheet)
      this.root.adoptedStyleSheets = this.root.adoptedStyleSheets.filter(
        (sheet) => sheet !== this.sheet
      );
  }
}

export interface TextEditorSession {
  element: HTMLElement;
  read(): TextObject;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  focus(): void;
  configure(lang: Language, dark: boolean): void;
  destroy(): void;
}

export async function mountTextEditor(
  object: TextObject,
  inkRaw: string,
  lang: Language,
  dark: boolean,
  onChange: () => void
): Promise<TextEditorSession> {
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
          new FontSizePlugin({ defaultSize: DEFAULT_TEXT_SIZE, sizes: [16, 24, 32, 48, 64, 96] }),
          new TextColorPlugin(),
          new HighlightPlugin({
            colors: ['#fff176', '#aed581', '#64b5f6', '#f48fb1', '#ffab91'],
          }),
        ],
        [
          new AlignmentPlugin({
            alignments: ['start', 'center', 'end'],
            alignableTypes: ['paragraph'],
          }),
        ],
      ],
    },
    plugins: [new BoardAppearance()],
    markdown: false,
    locale: lang === 'es' ? Locale.ES : Locale.EN,
    theme: dark ? ThemePreset.Dark : ThemePreset.Light,
    placeholder: lang === 'es' ? 'Escribe aquí…' : 'Type here…',
  });
  editor.setJSON(toEditorDocument(object));
  const state = editor.getState();
  if (!object.paragraphs.some((p) => p.runs.length)) {
    const marks = toEditorDocument({
      ...object,
      paragraphs: [{ align: 'left', runs: [{ ...DEFAULT_RUN, inkRaw, text: ' ' }] }],
    }).children[0].children[0];
    if (isTextNode(marks))
      editor.dispatch(state.transaction().setStoredMarks(marks.marks, null).build());
  }
  editor.on('stateChange', onChange);
  editor.on('selectionChange', onChange);
  // Intercept before the editor's HTML paste handler: no embeds or external resources.
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
            const split = splitBlockCommand(editor.getState());
            if (split) editor.dispatch(split);
          }
          if (line) editor.dispatch(insertTextCommand(editor.getState(), line, 'paste'));
        });
    },
    true
  );
  return {
    element: editor,
    read: () => fromEditorDocument(editor.getJSON(), object, inkRaw),
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    canUndo: () => editor.can().undo(),
    canRedo: () => editor.can().redo(),
    focus: () =>
      editor.shadowRoot
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?.focus({ preventScroll: true }),
    configure: (language, isDark) =>
      editor.configure({
        locale: language === 'es' ? Locale.ES : Locale.EN,
        theme: isDark ? ThemePreset.Dark : ThemePreset.Light,
      }),
    destroy: () => {
      editor.off('stateChange', onChange);
      editor.off('selectionChange', onChange);
      void editor.destroy().catch(() => {});
      editor.remove();
    },
  };
}
