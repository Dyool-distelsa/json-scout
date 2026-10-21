/**
 * Document kinds: what a tab holds decides the editor language, the toolbar
 * tools and the side panels. Pure, so it is unit tested in node.
 *
 * @typedef {'json'|'markdown'} DocKind
 * @typedef {'raw'|'split'|'preview'} MarkdownView
 */

/** @type {DocKind[]} */
export const DOC_KINDS = ['json', 'markdown'];

/** @type {MarkdownView[]} */
export const MARKDOWN_VIEWS = ['raw', 'split', 'preview'];

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/** Lower-case extensions (with the dot) of the files the app opens. */
export const SUPPORTED_EXTENSIONS = ['.json', ...MARKDOWN_EXTENSIONS];

/**
 * The kind of a file, from its extension. Anything that is not Markdown is
 * treated as JSON, as it always was.
 * @param {string|null} path
 * @returns {DocKind}
 */
export function kindForPath(path) {
  const lower = String(path ?? '').toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext)) ? 'markdown' : 'json';
}

/** Whether `path` names a file the app opens (JSON or Markdown). */
export function isSupportedPath(path) {
  const lower = String(path ?? '').toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * A best guess at the kind of text with no file name (a restored draft, a
 * dropped or pasted document). JSON wins whenever the text could be JSON.
 * @param {string} text
 * @returns {DocKind}
 */
export function guessKind(text) {
  const trimmed = String(text ?? '').trimStart();
  if (trimmed === '' || /^[[{"]/.test(trimmed)) return 'json';
  // A heading, list, quote or fence at the start of a line.
  return /^(#{1,6}\s|[-*+]\s|>\s|```|\d+\.\s)/m.test(trimmed) ? 'markdown' : 'json';
}

/** Short label of a kind for the toolbar and status bar. */
export function kindLabel(kind) {
  return kind === 'markdown' ? 'Markdown' : 'JSON';
}

/** Default file name offered by Save As for an Untitled document. */
export function defaultFileName(kind) {
  return kind === 'markdown' ? 'untitled.md' : 'untitled.json';
}

/**
 * Native dialog filters, the active kind's first so Save As picks its
 * extension by default.
 * @param {DocKind} [first]
 */
export function dialogFilters(first = 'json') {
  const json = { name: 'JSON', extensions: ['json'] };
  const markdown = { name: 'Markdown', extensions: ['md', 'markdown'] };
  const ordered = first === 'markdown' ? [markdown, json] : [json, markdown];
  return [{ name: 'JSON and Markdown', extensions: ['json', 'md', 'markdown'] }, ...ordered];
}

/**
 * The stored Markdown view, falling back to Split.
 * @param {unknown} value
 * @returns {MarkdownView}
 */
export function resolveMarkdownView(value) {
  return MARKDOWN_VIEWS.includes(/** @type {MarkdownView} */ (value)) ? /** @type {MarkdownView} */ (value) : 'split';
}
