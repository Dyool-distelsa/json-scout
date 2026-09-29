import { parseDocument } from './parseDocument.js';

/**
 * Validate JSON text and report a precise line/column on failure.
 * @param {string} text
 * @returns {{ valid: true } | { valid: false, error: { message: string, line: number, column: number } }}
 */
export function validateJson(text) {
  const result = parseDocument(text);
  return result.valid ? { valid: true } : { valid: false, error: result.error };
}
