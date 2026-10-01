import { el } from './dom.js';

/**
 * A small accessible modal: `role="dialog"` and `aria-modal`, focus held inside
 * (Tab wraps, focus that escapes is pulled back), Escape to close and focus
 * returned to where it came from. Several can be open at once (the close guard
 * can appear over the push review); only the top one handles keys.
 *
 * The caller fills `body` and `footer`. Content is built with `textContent`,
 * never HTML.
 */

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/** Open modals, bottom first. */
const stack = [];
let nextId = 0;

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (node) => !node.disabled && !node.closest('[hidden]')
  );
}

/**
 * @param {{
 *   title: string,
 *   tone?: 'neutral'|'caution'|'danger',
 *   restoreFocus?: HTMLElement | (() => HTMLElement|null|undefined),
 *   escapeCloses?: () => boolean,
 *   onClose?: () => void,
 * }} options
 *   `restoreFocus` is where focus goes on close (default: what had it on
 *   open); a function is called at close time, for a trigger that may have
 *   been re-rendered meanwhile. `escapeCloses` lets the caller refuse Escape
 *   while work is in flight.
 * @returns {{
 *   dialog: HTMLElement, header: HTMLElement, titleEl: HTMLElement,
 *   body: HTMLElement, footer: HTMLElement,
 *   focus: (node?: HTMLElement) => void,
 *   setTone: (tone: string) => void,
 *   isOpen: () => boolean,
 *   close: () => void,
 * }}
 */
export function openModal({
  title,
  tone = 'neutral',
  restoreFocus = document.activeElement,
  escapeCloses = () => true,
  onClose,
}) {
  const titleId = `modal-title-${(nextId += 1)}`;
  const backdrop = el('div', 'modal-backdrop');
  const dialog = el('div', 'modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.tabIndex = -1;
  const header = el('header', 'modal__header');
  const titleEl = el('h2', 'modal__title', title);
  titleEl.id = titleId;
  header.appendChild(titleEl);
  const body = el('div', 'modal__body');
  const footer = el('footer', 'modal__footer');
  dialog.append(header, body, footer);
  backdrop.appendChild(dialog);

  let open = true;
  let currentTone = null;

  function setTone(next) {
    if (currentTone) dialog.classList.remove(`modal--${currentTone}`);
    currentTone = next;
    dialog.classList.add(`modal--${next}`);
  }
  setTone(tone);

  const isTop = () => stack[stack.length - 1] === handle;

  function focus(node) {
    (node ?? dialog).focus();
  }

  function onKeydown(event) {
    if (!isTop()) return;
    if (event.key === 'Escape') {
      if (!escapeCloses()) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = focusables(dialog);
    if (controls.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function onFocusin(event) {
    if (!isTop() || backdrop.contains(event.target)) return;
    (focusables(dialog)[0] ?? dialog).focus();
  }

  function close() {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', onFocusin, true);
    const at = stack.indexOf(handle);
    if (at !== -1) stack.splice(at, 1);
    backdrop.remove();
    const target = typeof restoreFocus === 'function' ? restoreFocus() : restoreFocus;
    if (target?.isConnected) target.focus();
    onClose?.();
  }

  const handle = {
    dialog,
    header,
    titleEl,
    body,
    footer,
    focus,
    setTone,
    isOpen: () => open,
    close,
  };

  // Attach first: if that throws, nothing is left registered.
  document.body.appendChild(backdrop);
  stack.push(handle);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('focusin', onFocusin, true);
  dialog.focus();
  return handle;
}
