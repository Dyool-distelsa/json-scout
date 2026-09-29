import { stripBOM } from './jsonUtils.js';

/**
 * Parse and re-serialize JSON text with a configurable indent.
 * @param {string} text - raw JSON text (may include a BOM or CRLF newlines)
 * @param {{ indent?: 2 | 4 | 'tab' }} [options]
 * @returns {string} formatted JSON text
 * @throws {SyntaxError} if the input is not valid JSON
 */
export function formatJson(text, options = {}) {
  const { indent = 2 } = options;
  const cleaned = stripBOM(text);
  const parsed = JSON.parse(cleaned);
  const space = indent === 'tab' ? '\t' : indent;
  return JSON.stringify(parsed, null, space);
}
