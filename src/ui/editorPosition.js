/**
 * Pure, CodeMirror-independent helpers for translating a 1-based
 * (line, column) position — as reported by tools/validate.js — into a
 * clamped character offset inside a document string.
 *
 * Kept separate from editor.js so this logic can be unit tested directly
 * without spinning up a CodeMirror EditorView.
 */

/**
 * Split `text` into line boundaries using the same CRLF-aware rule as
 * tools/jsonUtils.getLineColumn (a "\r\n" pair counts as a single boundary),
 * so a line number produced by validateJson() always lines up with the
 * boundaries computed here.
 * @param {string} text
 * @returns {{ start: number, end: number }[]} one entry per line, `end`
 *   excludes the line-break characters themselves.
 */
function computeLineBoundaries(text) {
  const boundaries = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\r' && text[i + 1] === '\n') {
      boundaries.push({ start, end: i });
      i += 2;
      start = i;
    } else if (ch === '\n' || ch === '\r') {
      boundaries.push({ start, end: i });
      i += 1;
      start = i;
    } else {
      i += 1;
    }
  }
  boundaries.push({ start, end: text.length });
  return boundaries;
}

/**
 * Resolve a 1-based (line, column) position into a 0-based character
 * offset into `text`, clamping out-of-range values to the nearest valid
 * position instead of throwing (a line/column beyond the document end must
 * never crash the caller).
 * @param {string} text
 * @param {number} line - 1-based line number
 * @param {number} column - 1-based column number
 * @returns {number} clamped character offset into `text`
 */
export function resolveLineColumnOffset(text, line, column) {
  const safeText = typeof text === 'string' ? text : '';
  const boundaries = computeLineBoundaries(safeText);

  const requestedLine = Number.isFinite(line) ? Math.trunc(line) : 1;
  const clampedLineIndex = Math.min(Math.max(requestedLine, 1), boundaries.length) - 1;
  const { start, end } = boundaries[clampedLineIndex];
  const lineLength = end - start;

  const requestedColumn = Number.isFinite(column) ? Math.trunc(column) : 1;
  const clampedColumn = Math.min(Math.max(requestedColumn, 1), lineLength + 1);

  return start + clampedColumn - 1;
}
