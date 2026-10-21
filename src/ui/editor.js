import { EditorState, Compartment, Facet } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
} from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { linter, lintGutter } from '@codemirror/lint';
import { validateJson } from '../tools/validate.js';
import { resolveLineColumnOffset } from './editorPosition.js';
import { shouldProcessPaste } from './pasteRules.js';

const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
/** Per-document language: JSON (with its linter) or Markdown. */
const languageCompartment = new Compartment();

/** The kind of the document a state holds (see ui/docKind.js). */
const docKind = Facet.define({ combine: (values) => values[0] ?? 'json' });

/** @param {import('./docKind.js').DocKind} kind */
function languageFor(kind) {
  if (kind === 'markdown') return [docKind.of('markdown'), markdown()];
  return [docKind.of('json'), lintGutter(), linter(jsonLintSource), json()];
}

/**
 * Editor palette. The base values (bg, bgAlt, text, dim, accent) MUST stay in
 * sync with the matching tokens in src/styles/main.css (--color-bg,
 * --color-bg-alt, --color-text, --color-text-dim, --color-accent): CodeMirror
 * themes are built in JS, so they cannot read the CSS custom properties.
 */
const palette = {
  dark: {
    bg: '#0f1012',
    bgAlt: '#16171a',
    text: '#e6e7ea',
    dim: '#8a8f98',
    accent: '#5e6ad2',
    activeLine: 'rgba(255, 255, 255, 0.04)',
    activeGutter: 'rgba(255, 255, 255, 0.07)',
    selection: 'rgba(94, 106, 210, 0.38)',
    match: 'rgba(226, 179, 64, 0.25)',
    tooltipBg: '#1c1d21',
    border: 'rgba(255, 255, 255, 0.12)',
    // JSON syntax colors
    key: '#9aa4f5',
    string: '#7fd3a7',
    number: '#f0b072',
    keyword: '#d68cf0', // true / false / null
    punctuation: '#6d727c',
  },
  light: {
    bg: '#ffffff',
    bgAlt: '#f7f7f8',
    text: '#1c1d21',
    dim: '#6b6f76',
    accent: '#5e6ad2',
    activeLine: 'rgba(15, 16, 20, 0.035)',
    activeGutter: 'rgba(15, 16, 20, 0.06)',
    selection: 'rgba(94, 106, 210, 0.22)',
    match: 'rgba(183, 121, 31, 0.22)',
    tooltipBg: '#ffffff',
    border: 'rgba(15, 16, 20, 0.14)',
    key: '#4a55b8',
    string: '#1f8a55',
    number: '#b4581a',
    keyword: '#9a3fc0',
    punctuation: '#9a9ea6',
  },
};

function buildTheme(p, dark) {
  return EditorView.theme(
    {
      '&': { color: p.text, backgroundColor: p.bg },
      '.cm-content': { caretColor: p.accent },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.accent },
      '.cm-gutters': { backgroundColor: p.bg, color: p.dim, border: 'none' },
      '.cm-activeLine': { backgroundColor: p.activeLine },
      '.cm-activeLineGutter': { backgroundColor: p.activeGutter, color: p.text },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
        { backgroundColor: `${p.selection} !important` },
      '.cm-selectionMatch': { backgroundColor: p.match },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: p.selection,
        outline: 'none',
      },
      '.cm-tooltip': {
        backgroundColor: p.tooltipBg,
        color: p.text,
        border: `1px solid ${p.border}`,
        borderRadius: '6px',
      },
      '.cm-panels': { backgroundColor: p.bgAlt, color: p.text },
    },
    { dark }
  );
}

function buildHighlight(p) {
  return HighlightStyle.define([
    { tag: t.propertyName, color: p.key },
    { tag: t.string, color: p.string },
    { tag: t.number, color: p.number },
    { tag: [t.bool, t.null], color: p.keyword },
    { tag: [t.punctuation, t.separator, t.brace, t.squareBracket], color: p.punctuation },
    // Markdown
    { tag: t.heading, color: p.key, fontWeight: '600' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: [t.link, t.url], color: p.accent },
    { tag: t.monospace, color: p.string },
    { tag: t.quote, color: p.dim, fontStyle: 'italic' },
    { tag: [t.processingInstruction, t.contentSeparator], color: p.punctuation },
  ]);
}

const darkPalette = [buildTheme(palette.dark, true), syntaxHighlighting(buildHighlight(palette.dark))];
const lightPalette = [buildTheme(palette.light, false), syntaxHighlighting(buildHighlight(palette.light))];

/**
 * A CodeMirror lint source that runs our own strict JSON validator and
 * maps its line/column error into a CodeMirror diagnostic range.
 */
function jsonLintSource(view) {
  const text = view.state.doc.toString();
  if (text.trim() === '') return [];
  const result = validateJson(text);
  if (result.valid) return [];

  const { line, column, message } = result.error;
  const doc = view.state.doc;
  const clampedLine = Math.min(Math.max(line, 1), doc.lines);
  const lineInfo = doc.line(clampedLine);
  const from = Math.min(lineInfo.from + Math.max(column - 1, 0), lineInfo.to);
  const to = Math.min(from + 1, lineInfo.to);

  return [
    {
      from,
      to: from === to ? from : to,
      severity: 'error',
      message,
    },
  ];
}

/**
 * Callbacks of each editor view. The change and paste listeners below are
 * part of every document state but look the callbacks up by the view showing
 * the state, so a document can move between editors (a tab shown in the
 * compare pane) and still report to the editor it is in.
 * @type {WeakMap<EditorView, { onChange?: () => void, onPaste?: (text: string) => string | null }>}
 */
const viewCallbacks = new WeakMap();

const updateListener = EditorView.updateListener.of((update) => {
  // Deliberately does NOT pass the document text here: doing so would
  // call `doc.toString()` (materializing the whole document as a JS
  // string) on every single keystroke, even though `onChange` only
  // needs to know *that* the document changed. Callers that need the
  // text can call `getContent()` themselves, ideally from debounced
  // work rather than on every change.
  const onChange = viewCallbacks.get(update.view)?.onChange;
  if (update.docChanged && typeof onChange === 'function') {
    onChange();
  }
});

const pasteHandler = EditorView.domEventHandlers({
  paste(event, view) {
    const onPaste = viewCallbacks.get(view)?.onPaste;
    // The paste pipeline repairs and formats JSON: Markdown pastes as typed.
    if (typeof onPaste !== 'function' || view.state.readOnly || view.state.facet(docKind) !== 'json') {
      return false;
    }
    const { ranges, main } = view.state.selection;
    if (ranges.length !== 1 || !shouldProcessPaste(view.state.doc.length, main.from, main.to)) {
      return false;
    }
    const pasted = event.clipboardData?.getData('text/plain') ?? '';
    const replacement = onPaste(pasted);
    if (replacement === null || replacement === undefined) return false;
    event.preventDefault();
    // A normal transaction: the update listener above fires `onChange`
    // exactly as it does for typing, so lint/tree refresh is unchanged.
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: replacement },
      selection: { anchor: main.from + replacement.length },
      scrollIntoView: true,
      userEvent: 'input.paste',
    });
    return true;
  },
});

/**
 * Create a CodeMirror 6 editor for JSON or Markdown documents.
 * @param {HTMLElement} parent
 * @param {{ doc?: string, theme?: 'dark'|'light', readOnly?: boolean, onChange?: () => void,
 *   onPaste?: (text: string) => string | null }} [options]
 *   `onPaste` is offered pasted plain text only when the paste would replace
 *   the whole document; return replacement text to use it instead of the raw
 *   paste, or null to let the default paste happen.
 */
export function createEditor(parent, options = {}) {
  const { doc = '', theme = 'dark', readOnly = false, onChange, onPaste } = options;

  let currentTheme = theme;
  let currentReadOnly = readOnly;
  const buildState = (text, kind = 'json') => EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      languageCompartment.of(languageFor(kind)),
      keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
      themeCompartment.of(currentTheme === 'light' ? lightPalette : darkPalette),
      readOnlyCompartment.of(EditorState.readOnly.of(currentReadOnly)),
      updateListener,
      pasteHandler,
      EditorView.lineWrapping,
    ],
  });

  const view = new EditorView({ state: buildState(doc), parent });
  viewCallbacks.set(view, { onChange, onPaste });

  return {
    view,
    getContent: () => view.state.doc.toString(),
    setContent: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    /**
     * A fresh, independent document state (own undo history and selection)
     * for another open document. Shown with `setState`.
     * @param {string} text
     * @param {import('./docKind.js').DocKind} [kind]
     */
    createState: (text, kind) => buildState(text, kind),
    /** The kind of the shown document. */
    getKind: () => view.state.facet(docKind),
    /**
     * Switch the shown document to another language (it keeps its text,
     * undo history and selection).
     * @param {import('./docKind.js').DocKind} kind
     */
    setKind: (kind) => {
      view.dispatch({ effects: languageCompartment.reconfigure(languageFor(kind)) });
    },
    /** The shown document's whole state, to stash while another is shown. */
    getState: () => view.state,
    /**
     * Show a state from `createState`/`getState`. Does not fire `onChange`.
     * The theme and read-only setting follow the editor, not the state.
     */
    setState: (nextState) => {
      view.setState(nextState);
      view.dispatch({
        effects: [
          themeCompartment.reconfigure(currentTheme === 'light' ? lightPalette : darkPalette),
          readOnlyCompartment.reconfigure(EditorState.readOnly.of(currentReadOnly)),
        ],
      });
    },
    setTheme: (nextTheme) => {
      currentTheme = nextTheme;
      view.dispatch({
        effects: themeCompartment.reconfigure(nextTheme === 'light' ? lightPalette : darkPalette),
      });
    },
    setReadOnly: (value) => {
      currentReadOnly = value;
      view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(value)) });
    },
    getCursorPosition: () => {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      return { line: line.number, column: pos - line.from + 1 };
    },
    /**
     * Move the cursor to a 1-based (line, column) position, scroll it into
     * view and focus the editor. Out-of-range values are clamped (via
     * resolveLineColumnOffset) rather than throwing, so a stale or
     * off-by-one error position from a validator can never crash this.
     * @param {number} line - 1-based line number
     * @param {number} column - 1-based column number
     */
    goToLineColumn: (line, column) => {
      const offset = resolveLineColumnOffset(view.state.doc.toString(), line, column);
      view.dispatch({
        selection: { anchor: offset, head: offset },
        scrollIntoView: true,
      });
      view.focus();
    },
    destroy: () => view.destroy(),
  };
}
