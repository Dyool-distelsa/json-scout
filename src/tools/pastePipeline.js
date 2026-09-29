import { parseDocument } from './parseDocument.js';
import { repairJson } from './repair.js';
import { sortKeysDeep } from './sortKeys.js';
import { formatJson } from './format.js';

/**
 * The paste pipeline: validate, repair (only when needed), sort keys
 * recursively, then format with the given indent. Reuses the same tools the
 * toolbar buttons use, so results match clicking them one after another.
 *
 * Defined behaviour for edge cases:
 *  - empty / whitespace-only input is `ok: false` (there is nothing to process);
 *  - when the input was invalid and repair only "succeeds" by wrapping the
 *    text into a bare string or number (e.g. plain prose), that is not a
 *    real repair, so the result is `ok: false`;
 *  - on any failure the original text is returned untouched.
 * @param {string} text
 * @param {{ indent?: 2 | 4 | 'tab' }} [options]
 * @returns {{ ok: true, text: string, steps: Array<'repaired'|'sorted'|'formatted'> }
 *   | { ok: false, text: string, error: string }}
 */
export function processPastedJson(text, { indent = 2 } = {}) {
  const original = text ?? '';
  if (original.trim() === '') {
    return { ok: false, text: original, error: 'Nothing to process: the text is empty.' };
  }

  const steps = [];
  let parsed = parseDocument(original);

  if (!parsed.valid) {
    let repairedText;
    try {
      repairedText = repairJson(original);
    } catch (err) {
      return { ok: false, text: original, error: err.message ?? String(err) };
    }
    parsed = parseDocument(repairedText);
    if (!parsed.valid || parsed.value === null || typeof parsed.value !== 'object') {
      return { ok: false, text: original, error: 'The text is not JSON and could not be repaired.' };
    }
    steps.push('repaired');
  }

  const sorted = sortKeysDeep(parsed.value);
  const formatted = formatJson(JSON.stringify(sorted), { indent });
  steps.push('sorted', 'formatted');
  return { ok: true, text: formatted, steps };
}
