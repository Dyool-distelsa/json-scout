/**
 * Pure rules and wording for the paste pipeline. Kept separate from the
 * editor's DOM glue so they can be unit tested (see pasteRules.test.js).
 */

const STEP_LABELS = {
  repaired: 'repaired',
  sorted: 'sorted keys',
  formatted: 'formatted',
};

/** Toast shown when pasted text is left untouched because it cannot be repaired. */
export const PASTE_FAILURE_MESSAGE =
  'Pasted text is not valid JSON and could not be repaired; it was inserted as-is.';

/**
 * The pipeline only runs when the paste would replace the whole document:
 * the document is empty, or the selection covers all of it. Anything else
 * (a fragment pasted into existing content) stays a plain paste.
 * @param {number} docLength
 * @param {number} selectionFrom
 * @param {number} selectionTo
 * @returns {boolean}
 */
export function shouldProcessPaste(docLength, selectionFrom, selectionTo) {
  if (docLength === 0) return true;
  return Math.min(selectionFrom, selectionTo) === 0 && Math.max(selectionFrom, selectionTo) === docLength;
}

/**
 * @param {Array<'repaired'|'sorted'|'formatted'>} steps
 * @returns {string} e.g. "Pasted, repaired, sorted keys and formatted"
 */
export function describePasteSuccess(steps) {
  const labels = steps.map((step) => STEP_LABELS[step] ?? step);
  if (labels.length === 0) return 'Pasted';
  const last = labels[labels.length - 1];
  const head = labels.slice(0, -1);
  return head.length === 0 ? `Pasted and ${last}` : `Pasted, ${head.join(', ')} and ${last}`;
}
