import { stripBOM } from './jsonUtils.js';

/**
 * Parse and re-serialize JSON text with no whitespace.
 * @param {string} text - raw JSON text (may include a BOM or CRLF newlines)
 * @returns {string} minified JSON text
 * @throws {SyntaxError} if the input is not valid JSON
 */
export function minifyJson(text) {
  const cleaned = stripBOM(text);
  const parsed = JSON.parse(cleaned);
  return JSON.stringify(parsed);
}
