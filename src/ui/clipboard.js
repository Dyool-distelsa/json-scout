/**
 * Clipboard helpers for the editor's Copy button. `copyText` takes its
 * dependencies as arguments so both paths can be unit tested without a
 * browser (see clipboard.test.js); the default fallback is thin DOM glue.
 */

/**
 * @param {string | undefined} text
 * @returns {boolean} true when there is something worth copying
 */
export function isCopyable(text) {
  return typeof text === 'string' && text.trim() !== '';
}

/**
 * Legacy copy path for webviews where the async clipboard API is missing
 * or rejects: select a hidden textarea and run `execCommand('copy')`.
 * @param {string} text
 * @returns {boolean} whether the browser reported success
 */
function execCommandCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  const previouslyFocused = document.activeElement;
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
    previouslyFocused?.focus?.();
  }
}

/**
 * Copy text to the clipboard, trying the async API first and falling back
 * to `execCommand('copy')`.
 * @param {string} text
 * @param {{ clipboard?: { writeText?: (text: string) => Promise<void> }, fallback?: (text: string) => boolean }} [deps]
 * @returns {Promise<boolean>} true when the text was copied
 */
export async function copyText(
  text,
  { clipboard = globalThis.navigator?.clipboard, fallback = execCommandCopy } = {}
) {
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or unsupported context: use the legacy path.
    }
  }
  try {
    return Boolean(fallback(text));
  } catch {
    return false;
  }
}
