import { el, button } from './dom.js';
import { openModal } from './modal.js';

/**
 * Ask for a file or folder name. Resolves with the trimmed name, or null when
 * cancelled. `validate` returns why a name cannot be used (shown inline, OK
 * stays disabled) or null.
 * @param {{ title: string, label: string, initial?: string, confirmLabel?: string,
 *   validate: (name: string) => string|null, selectStem?: boolean }} options
 *   `selectStem` pre-selects the name without its `.json` extension.
 * @returns {Promise<string|null>}
 */
export function promptName({ title, label, initial = '', confirmLabel = 'OK', validate, selectStem = false }) {
  return new Promise((resolve) => {
    let result = null;
    const modal = openModal({ title, onClose: () => resolve(result) });
    const field = el('label', 'name-dialog__field', label);
    const input = el('input', 'vault-input name-dialog__input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = initial;
    field.appendChild(input);
    const errorEl = el('div', 'name-dialog__error');
    errorEl.setAttribute('role', 'alert');
    modal.body.append(field, errorEl);

    const ok = button(confirmLabel, 'primary', submit);
    const cancel = button('Cancel', '', () => modal.close());
    modal.footer.append(cancel, ok);

    function check() {
      const problem = validate(input.value.trim());
      // Stay quiet about an empty field until something was typed.
      errorEl.textContent = input.value === '' ? '' : (problem ?? '');
      ok.disabled = problem !== null;
      return problem === null;
    }
    function submit() {
      if (!check()) return;
      result = input.value.trim();
      modal.close();
    }
    input.addEventListener('input', check);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    check();
    modal.focus(input);
    const stemEnd = selectStem && initial.toLowerCase().endsWith('.json') ? initial.length - 5 : initial.length;
    input.setSelectionRange(0, stemEnd);
  });
}

/**
 * Ask to go ahead with an action. Resolves true when confirmed.
 * @param {{ title: string, message: string, confirmLabel: string }} options
 * @returns {Promise<boolean>}
 */
export function confirmAction({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const modal = openModal({ title, tone: 'caution', onClose: () => resolve(confirmed) });
    modal.body.appendChild(el('p', undefined, message));
    const ok = button(confirmLabel, 'primary', () => {
      confirmed = true;
      modal.close();
    });
    modal.footer.append(button('Cancel', '', () => modal.close()), ok);
    modal.focus(ok);
  });
}
