import { jsonrepair } from 'jsonrepair';
import { stripBOM } from './jsonUtils.js';
import { detectUnmatchedCloser } from './jsonParser.js';

/**
 * Attempt to repair common JSON mistakes: trailing commas, single-quoted
 * strings, unquoted keys, missing closing brackets, comments, and
 * newline-delimited JSON.
 *
 * `jsonrepair` cannot handle a missing OPENING bracket on its own — for
 * example `{"tags": "a","b"]}` (missing `[`) makes it throw its own
 * internal "Colon expected at position N" instead of repairing anything.
 * When that happens, fall back to `detectUnmatchedCloser` (see
 * jsonParser.js): if it finds an unmatched closer with a confident
 * insertion point, insert the missing opening bracket there and let
 * `jsonrepair` finish the rest (trailing commas, spacing, etc.). If the
 * insertion point is uncertain, or the patched text still cannot be
 * repaired, surface a clear, actionable message instead of the library's
 * internal wording or a silently wrong result.
 * @param {string} text
 * @returns {string} repaired JSON text
 * @throws {Error} if the input cannot be repaired
 */
export function repairJson(text) {
  const cleaned = stripBOM(text ?? '');
  try {
    return jsonrepair(cleaned);
  } catch (err) {
    const unmatched = detectUnmatchedCloser(cleaned);
    if (unmatched && unmatched.insertAt !== null) {
      const patched =
        cleaned.slice(0, unmatched.insertAt) + unmatched.missingOpener + cleaned.slice(unmatched.insertAt);
      try {
        return jsonrepair(patched);
      } catch {
        // The guess at where the missing bracket belongs did not produce
        // valid JSON after all — fall through to the actionable error
        // below instead of returning something silently wrong.
      }
    }
    if (unmatched) {
      throw new Error(
        `Cannot repair automatically: '${unmatched.closer}' has no matching opening ` +
          `'${unmatched.missingOpener}'. Add the missing '${unmatched.missingOpener}' and try again.`
      );
    }
    throw new Error(`Cannot repair this JSON: ${err.message}`);
  }
}
