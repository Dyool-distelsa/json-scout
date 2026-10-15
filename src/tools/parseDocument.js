import { stripBOM, getLineColumn } from './jsonUtils.js';
import { parseJsonStrict, JsonSyntaxError } from './jsonParser.js';

/**
 * Parse JSON text exactly once and share the result (parsed value, or a
 * precisely located error) across every consumer that would otherwise
 * re-parse the same text independently (validation, the tree view,
 * stats). This is the single source of truth for "is this text valid
 * JSON, and if so what does it parse to" for one refresh cycle.
 * @param {string} text
 * @returns {{ valid: true, value: * } | { valid: false, error: { message: string, line: number, column: number } }}
 */
export function parseDocument(text) {
  const source = text ?? '';
  // The status bar, the side panels and the editor's linter all ask about
  // the same text after an edit; a 100 MB document should parse once.
  if (lastParse && lastParse.text === source) return lastParse.result;
  const result = parseUncached(source);
  lastParse = { text: source, result };
  return result;
}

/** @type {{ text: string, result: ReturnType<typeof parseDocument> } | null} */
let lastParse = null;

function parseUncached(text) {
  const cleaned = stripBOM(text);
  try {
    // The engine's native parser is many times faster than the strict one
    // and accepts exactly valid JSON; the strict parser only runs to locate
    // and explain an error.
    return { valid: true, value: JSON.parse(cleaned) };
  } catch {
    // Fall through to the strict parser for a precise message.
  }
  try {
    const value = parseJsonStrict(cleaned);
    return { valid: true, value };
  } catch (err) {
    const index = err instanceof JsonSyntaxError ? err.index : 0;
    const { line, column } = getLineColumn(cleaned, index);
    return { valid: false, error: { message: err.message, line, column } };
  }
}
