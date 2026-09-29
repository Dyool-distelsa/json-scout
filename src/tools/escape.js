/**
 * Escape a raw string into its JSON string-literal escaped form,
 * without the surrounding quotes.
 * @param {string} raw
 * @returns {string}
 */
export function escapeString(raw) {
  const quoted = JSON.stringify(raw ?? '');
  return quoted.slice(1, -1);
}

/**
 * Reverse of escapeString: turn an escaped body back into the raw string.
 * @param {string} escaped
 * @returns {string}
 * @throws {SyntaxError} if the escaped text contains an invalid escape sequence
 */
export function unescapeString(escaped) {
  return JSON.parse(`"${escaped ?? ''}"`);
}
