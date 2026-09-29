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
  const cleaned = stripBOM(text ?? '');
  try {
    const value = parseJsonStrict(cleaned);
    return { valid: true, value };
  } catch (err) {
    const index = err instanceof JsonSyntaxError ? err.index : 0;
    const { line, column } = getLineColumn(cleaned, index);
    return { valid: false, error: { message: err.message, line, column } };
  }
}
