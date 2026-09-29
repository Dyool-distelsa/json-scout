import { EditorState, Compartment } from '@codemirror/state';
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
import {
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { linter, lintGutter } from '@codemirror/lint';
import { validateJson } from '../tools/validate.js';
import { resolveLineColumnOffset } from './editorPosition.js';

const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

const darkPalette = EditorView.theme(
  {
    '&': { color: '#e4e4ec', backgroundColor: '#1e1e24' },
    '.cm-content': { caretColor: '#6c8cff' },
    '.cm-gutters': { backgroundColor: '#26262e', color: '#9a9aac', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(108,140,255,0.07)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(108,140,255,0.12)' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(108,140,255,0.35) !important' },
  },
  { dark: true }
);

const lightPalette = EditorView.theme(
  {
    '&': { color: '#1b1c22', backgroundColor: '#ffffff' },
    '.cm-content': { caretColor: '#3457d5' },
    '.cm-gutters': { backgroundColor: '#f4f5f7', color: '#666a75', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(52,87,213,0.06)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(52,87,213,0.1)' },
  },
  { dark: false }
);

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
 * Create a CodeMirror 6 JSON editor.
 * @param {HTMLElement} parent
 * @param {{ doc?: string, theme?: 'dark'|'light', readOnly?: boolean, onChange?: () => void }} [options]
 */
export function createEditor(parent, options = {}) {
  const { doc = '', theme = 'dark', readOnly = false, onChange } = options;

  const updateListener = EditorView.updateListener.of((update) => {
    // Deliberately does NOT pass the document text here: doing so would
    // call `doc.toString()` (materializing the whole document as a JS
    // string) on every single keystroke, even though `onChange` only
    // needs to know *that* the document changed. Callers that need the
    // text can call `getContent()` themselves, ideally from debounced
    // work rather than on every change.
    if (update.docChanged && typeof onChange === 'function') {
      onChange();
    }
  });

  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      lintGutter(),
      linter(jsonLintSource),
      json(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
      themeCompartment.of(theme === 'light' ? lightPalette : darkPalette),
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      updateListener,
      EditorView.lineWrapping,
    ],
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    getContent: () => view.state.doc.toString(),
    setContent: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    setTheme: (nextTheme) => {
      view.dispatch({
        effects: themeCompartment.reconfigure(nextTheme === 'light' ? lightPalette : darkPalette),
      });
    },
    setReadOnly: (value) => {
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
