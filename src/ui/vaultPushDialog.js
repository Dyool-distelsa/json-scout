import { el, button } from './dom.js';
import { openModal } from './modal.js';
import { errorMessage } from './vaultModel.js';
import {
  environmentStyle,
  requiresTypedConfirmation,
  canConfirm,
  changeRows,
  changeSummary,
  shortVersion,
} from './vaultPush.js';

/** After these the pushed bytes are not the problem: the user has to fix the file or the situation. */
const FINAL_ERRORS = new Set(['not_pulled', 'no_changes', 'invalid_json', 'duplicate_keys']);
/** After these the preview no longer describes the vault: look again. */
const STALE_ERRORS = new Set(['conflict', 'preview_required']);

const KIND_LABELS = { added: 'added', removed: 'removed', changed: 'changed', moved: 'moved' };

function valueCell(cellData, revealed) {
  const node = el('span', 'push-value');
  if (revealed) {
    node.textContent = cellData?.text ?? '';
    return node;
  }
  node.classList.add('push-value--masked');
  const mask = el('span', undefined, cellData?.masked ?? '');
  mask.setAttribute('aria-hidden', 'true');
  node.append(mask, el('span', 'sr-only', 'hidden value'));
  return node;
}

function changeRow(row, mode, revealed) {
  const item = el('li', `push-row push-row--${row.kind}`);
  item.appendChild(el('code', 'push-row__path', mode === 'lines' ? `line ${row.line}` : row.path));
  item.appendChild(el('span', 'push-row__kind', KIND_LABELS[row.kind] ?? row.kind));
  if (row.before) item.appendChild(valueCell(row.before, revealed));
  if (row.before && row.after) item.appendChild(el('span', 'push-row__arrow', '→'));
  if (row.after) item.appendChild(valueCell(row.after, revealed));
  return item;
}

function changeSection(title, change, revealed) {
  const section = el('section', 'push-section');
  section.appendChild(el('h3', 'push-section__title', title));
  section.appendChild(el('p', 'push-section__summary', changeSummary(change)));
  if (change.rows.length > 0) {
    const list = el('ul', 'push-rows');
    for (const row of change.rows) list.appendChild(changeRow(row, change.mode, revealed));
    section.appendChild(list);
  }
  if (change.truncated) {
    section.appendChild(
      el('p', 'push-section__more', `${change.total - change.rows.length} more not shown.`)
    );
  }
  return section;
}

/**
 * The review step of a push: what changed (values masked until revealed), in
 * which environment, and the confirmation. The backend refuses a push that was
 * not previewed, so this dialog is the only way to push; it can also not push
 * anything but the bytes the preview described.
 *
 * Production and unknown environments require typing the secret name. If the
 * preview shows the vault moved on since the pull, the dialog offers Re-pull
 * or Overwrite anyway instead of Push; if the vault moves on after the
 * preview, the push is refused and the dialog offers to review again.
 *
 * Secret values appear only as text, and only after "Reveal values": never in
 * attributes, titles or messages.
 *
 * @param {{
 *   vault: string,
 *   name: string,
 *   preview: object,
 *   invoke: (command: string, args?: object) => Promise<any>,
 *   restoreFocus?: HTMLElement | (() => HTMLElement|null|undefined),
 *   onPushed: (result: { newVersion: string }) => void,
 *   onRepull: () => void,
 *   onClosed?: () => void,
 * }} options
 * @returns {{ close: () => void, isOpen: () => boolean }}
 */
export function openPushDialog({
  vault,
  name,
  preview,
  invoke,
  restoreFocus,
  onPushed,
  onRepull,
  onClosed,
}) {
  const state = {
    preview,
    reveal: false,
    typed: '',
    pushing: null, // null | 'push' | 'overwrite'
    refreshing: false,
    error: null, // { text, kind } | null
  };

  const busy = () => state.pushing !== null || state.refreshing;
  const modal = openModal({
    title: 'Push to Azure Key Vault',
    restoreFocus,
    escapeCloses: () => !busy(),
    onClose: onClosed,
  });
  modal.dialog.classList.add('push-dialog');

  const conflict = () => state.preview.remote?.conflict === true;
  const environment = () => state.preview.environment;

  // --- Static structure -----------------------------------------------------
  const envBadge = el('span', 'push-env');
  modal.header.appendChild(envBadge);

  const facts = el('dl', 'push-facts');
  const fact = (label, value) => {
    const term = el('dt', undefined, label);
    const detail = el('dd', undefined, value);
    facts.append(term, detail);
    return detail;
  };
  fact('Vault', vault);
  fact('Secret', name);
  const baseVersionEl = fact('Based on version', '');

  const conflictBlock = el('div', 'push-conflict');
  conflictBlock.setAttribute('role', 'status');

  const revealButton = button('Reveal values', 'vault-btn push-reveal', () => {
    state.reveal = !state.reveal;
    render();
  });
  const toolsRow = el('div', 'push-tools');
  toolsRow.appendChild(revealButton);

  const sections = el('div', 'push-sections');
  const note = el('p', 'push-note', 'Pushes appear in Azure as your account.');

  const typedRow = el('label', 'push-confirm');
  typedRow.append('Type ', el('code', 'push-confirm__name', name), ' to confirm');
  const typedInput = el('input', 'vault-input push-confirm__input');
  typedInput.type = 'text';
  typedInput.autocomplete = 'off';
  typedInput.spellcheck = false;
  typedRow.appendChild(typedInput);
  const confirmSlot = el('div', 'push-confirm-slot');

  const errorEl = el('div', 'push-error');
  errorEl.setAttribute('role', 'alert');

  modal.body.append(facts, conflictBlock, toolsRow, sections, note, confirmSlot, errorEl);

  // Buttons are built once; `render` only chooses which are attached.
  const cancelButton = button('Cancel', 'vault-btn push-btn', () => modal.close());
  const pushButton = button('Push', 'primary push-btn', () => confirm(false));
  const overwriteButton = button('Overwrite anyway', 'danger push-btn', () => confirm(true));
  const repullButton = button('Re-pull', 'vault-btn push-btn', () => {
    if (busy()) return;
    modal.close();
    onRepull();
  });
  const reviewButton = button('Review again', 'primary push-btn', () => reviewAgain());
  let footerMode = null;

  function mode() {
    if (state.error && FINAL_ERRORS.has(state.error.kind)) return 'final';
    if (state.error && STALE_ERRORS.has(state.error.kind)) return 'review';
    return conflict() ? 'conflict' : 'push';
  }

  // --- Rendering ------------------------------------------------------------
  function render() {
    const style = environmentStyle(environment());
    modal.setTone(style.tone);
    envBadge.textContent = style.short;
    envBadge.setAttribute('aria-label', `Environment: ${style.label}`);
    baseVersionEl.textContent = shortVersion(state.preview.baseVersion) || 'unknown';

    const remote = state.preview.remote ?? {};
    conflictBlock.hidden = !conflict();
    conflictBlock.textContent = conflict()
      ? `This secret changed in Azure since you pulled it (you pulled ${shortVersion(
          state.preview.baseVersion
        )}, Azure now has ${shortVersion(remote.currentVersion)}). Re-pull to start from the current ` +
        'value, or overwrite it with your version.'
      : '';

    revealButton.textContent = state.reveal ? 'Hide values' : 'Reveal values';
    revealButton.setAttribute('aria-pressed', String(state.reveal));
    const format = state.preview.format;
    const next = [];
    if (conflict() && typeof remote.remoteText === 'string') {
      next.push(
        changeSection(
          'Changed in Azure',
          changeRows(format, state.preview.baseText, remote.remoteText),
          state.reveal
        )
      );
    }
    next.push(
      changeSection(
        'Your edits',
        changeRows(format, state.preview.baseText, state.preview.workingText),
        state.reveal
      )
    );
    sections.replaceChildren(...next);

    const current = mode();
    const needsTyped =
      requiresTypedConfirmation(environment()) && (current === 'push' || current === 'conflict');
    if (needsTyped !== typedRow.isConnected) {
      confirmSlot.replaceChildren(...(needsTyped ? [typedRow] : []));
    }

    const working = busy();
    const confirmOk = canConfirm(environment(), state.typed, name);
    cancelButton.disabled = working;
    cancelButton.textContent = current === 'final' ? 'Close' : 'Cancel';
    pushButton.disabled = working || !confirmOk;
    pushButton.textContent = state.pushing === 'push' ? 'Pushing…' : 'Push';
    pushButton.className = `${style.tone === 'danger' ? 'danger' : 'primary'} push-btn`;
    overwriteButton.disabled = working || !confirmOk;
    overwriteButton.textContent = state.pushing === 'overwrite' ? 'Pushing…' : 'Overwrite anyway';
    repullButton.disabled = working;
    reviewButton.disabled = working;
    reviewButton.textContent = state.refreshing ? 'Reviewing…' : 'Review again';

    if (current !== footerMode) {
      footerMode = current;
      const actions = {
        push: [cancelButton, pushButton],
        conflict: [cancelButton, repullButton, overwriteButton],
        review: [cancelButton, reviewButton],
        final: [cancelButton],
      }[current];
      modal.footer.replaceChildren(...actions);
    }

    errorEl.textContent = state.error?.text ?? '';
    errorEl.hidden = !state.error;
    modal.dialog.setAttribute('aria-busy', working ? 'true' : 'false');
  }

  // --- Behaviour ------------------------------------------------------------
  async function confirm(overwrite) {
    if (busy() || !canConfirm(environment(), state.typed, name)) return;
    state.pushing = overwrite ? 'overwrite' : 'push';
    state.error = null;
    render();
    try {
      const result = await invoke('vault_push', {
        vault,
        name,
        contentHash: state.preview.contentHash,
        overwrite,
      });
      state.pushing = null;
      modal.close();
      onPushed({ newVersion: result?.newVersion });
    } catch (err) {
      state.pushing = null;
      state.error = { text: errorMessage(err), kind: err?.kind };
      render();
    }
  }

  async function reviewAgain() {
    if (busy()) return;
    state.refreshing = true;
    state.error = null;
    render();
    let fresh;
    try {
      fresh = await invoke('vault_push_preview', { vault, name });
    } catch (err) {
      state.refreshing = false;
      // Keep asking to review again unless the failure says to stop.
      const kind = err?.kind;
      state.error = {
        text: errorMessage(err),
        kind: FINAL_ERRORS.has(kind) ? kind : 'preview_required',
      };
      render();
      return;
    }
    state.refreshing = false;
    if (fresh?.changed !== true) {
      state.error = { text: errorMessage({ kind: 'no_changes' }), kind: 'no_changes' };
      render();
      return;
    }
    state.preview = fresh;
    state.typed = '';
    typedInput.value = '';
    render();
    focusPrimary();
  }

  function focusPrimary() {
    modal.focus(typedRow.isConnected ? typedInput : undefined);
  }

  typedInput.addEventListener('input', () => {
    state.typed = typedInput.value;
    render();
  });
  typedInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const target = footerMode === 'conflict' ? overwriteButton : pushButton;
    if (!target.disabled) target.click();
  });

  render();
  focusPrimary();
  return { close: modal.close, isOpen: modal.isOpen };
}
