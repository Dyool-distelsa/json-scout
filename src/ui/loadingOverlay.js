import { el } from './dom.js';

/**
 * Full-window "opening a file" overlay: animated braces, the file name and
 * the current step. It fades in after a short delay (in CSS), so small files
 * that open instantly never flash it. Animations use only transform and
 * opacity, so they keep running while the main thread parses a large file.
 * @returns {{ show: (name: string) => void, step: (text: string) => Promise<void>, hide: () => void }}
 */
export function createLoadingOverlay() {
  const root = el('div', 'loading-overlay');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.hidden = true;

  const card = el('div', 'loading-overlay__card');
  const mark = el('div', 'loading-mark');
  mark.setAttribute('aria-hidden', 'true');
  mark.append(
    el('span', 'loading-mark__brace', '{'),
    el('span', 'loading-mark__dot'),
    el('span', 'loading-mark__dot'),
    el('span', 'loading-mark__dot'),
    el('span', 'loading-mark__brace loading-mark__brace--close', '}')
  );
  const nameEl = el('div', 'loading-overlay__name');
  const stepEl = el('div', 'loading-overlay__step');
  const bar = el('div', 'loading-overlay__bar');
  bar.appendChild(el('span', 'loading-overlay__bar-fill'));
  card.append(mark, nameEl, stepEl, bar);
  root.appendChild(card);
  document.body.appendChild(root);

  let depth = 0;

  return {
    show(name) {
      depth += 1;
      nameEl.textContent = name;
      stepEl.textContent = 'Reading file…';
      root.hidden = false;
    },
    /** Change the step text and let it paint before blocking work starts. */
    step(text) {
      stepEl.textContent = text;
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    hide() {
      depth = Math.max(0, depth - 1);
      if (depth === 0) root.hidden = true;
    },
  };
}
