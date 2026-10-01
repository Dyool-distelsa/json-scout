/** Tiny DOM builders shared by the vault panel and its dialogs. */

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text] set as textContent, so it is never parsed as HTML
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A `type="button"` button, so it never submits a surrounding form.
 * @param {string} label
 * @param {string} className
 * @param {(event: MouseEvent) => void} onClick
 * @returns {HTMLButtonElement}
 */
export function button(label, className, onClick) {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
