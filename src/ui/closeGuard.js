import { el, button } from './dom.js';
import { openModal } from './modal.js';

/**
 * The close guard: closing the window discards the pulled workspace, so a
 * secret with unpushed edits would be lost. The window asks first.
 *
 * The question depends only on which secrets are modified on disk, not on the
 * Vault plugin switch: the files exist either way. No secret values are read
 * here; the backend reports names only.
 */

/** Most vault/name lines the dialog lists; the rest are counted. */
export const MAX_LISTED = 50;

/**
 * How long the close request waits for `vault_local_changes`. The call only
 * reads the disk, so a slower answer means something is stuck; past this the
 * guard asks the generic question instead of leaving the window unclosable.
 */
export const CHECK_TIMEOUT_MS = 3000;

const CHECK_FAILED_MESSAGE =
  'Could not check for unpushed edits. Close and discard any you may have?';

function failedCheck() {
  return { action: 'ask', message: CHECK_FAILED_MESSAGE, entries: [], hidden: 0 };
}

/**
 * `promise`, or a rejection once `ms` have passed. The timer is always cleared.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('check timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * What to do with a close request, given what `vault_local_changes` returned
 * (a list) or why it failed (anything else). An empty list lets the window
 * close; anything that is not a list, or a list with nothing usable in it,
 * asks anyway, because not knowing is not the same as having nothing to lose.
 * @param {unknown} changesOrError
 * @returns {{ action: 'close' } | { action: 'ask', message: string, entries: string[], hidden: number }}
 */
export function closeDecision(changesOrError) {
  if (!Array.isArray(changesOrError)) return failedCheck();
  if (changesOrError.length === 0) return { action: 'close' };
  const all = changesOrError
    .filter(
      (entry) =>
        typeof entry?.vault === 'string' &&
        entry.vault !== '' &&
        typeof entry?.name === 'string' &&
        entry.name !== ''
    )
    .map((entry) => `${entry.vault}/${entry.name}`);
  if (all.length === 0) return failedCheck();
  const subject =
    all.length === 1 ? '1 secret has unpushed edits' : `${all.length} secrets have unpushed edits`;
  return {
    action: 'ask',
    message: `${subject}. Close and discard them?`,
    entries: all.slice(0, MAX_LISTED),
    hidden: Math.max(0, all.length - MAX_LISTED),
  };
}

/**
 * Show the question and wait for the answer. "Keep editing" has the default
 * focus and is also what Escape means.
 * @param {{ message: string, entries: string[], hidden: number }} decision
 * @returns {Promise<boolean>} true to discard and close
 */
export function askDiscardOnClose(decision) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (discard) => {
      if (answered) return;
      answered = true;
      resolve(discard);
    };
    const modal = openModal({
      title: 'Unpushed edits',
      tone: 'caution',
      escapeCloses: () => true,
      onClose: () => answer(false),
    });
    modal.body.appendChild(el('p', 'close-guard__message', decision.message));
    if (decision.entries.length > 0) {
      const list = el('ul', 'close-guard__list');
      for (const entry of decision.entries) list.appendChild(el('li', undefined, entry));
      modal.body.appendChild(list);
    }
    if (decision.hidden > 0) {
      modal.body.appendChild(el('p', 'close-guard__more', `and ${decision.hidden} more.`));
    }
    const discard = button('Discard and close', 'danger', () => {
      answer(true);
      modal.close();
    });
    const keep = button('Keep editing', 'primary', () => modal.close());
    modal.footer.append(discard, keep);
    modal.focus(keep);
  });
}

/**
 * Intercept the main window's close request. Without unpushed edits the close
 * goes ahead untouched; with them (or when that cannot be checked) the user is
 * asked, and only "Discard and close" destroys the window (the Rust side then
 * clears the workspace and exits).
 *
 * If the guard itself breaks, the close is allowed: a window that cannot be
 * closed is worse than a missing question. A check that does not answer within
 * `checkTimeoutMs` is treated as a failed check (the generic question), and the
 * guard's state is released on every path, so a later request is never swallowed.
 * @param {{
 *   invoke: (command: string, args?: object) => Promise<any>,
 *   getWindow: () => Promise<{
 *     onCloseRequested: (handler: (event: { preventDefault: () => void }) => Promise<void>) => Promise<() => void>,
 *     destroy: () => Promise<void>,
 *   }>,
 *   notify?: (message: string, kind?: 'success'|'error'|'info') => void,
 *   checkTimeoutMs?: number,
 * }} deps
 * @returns {Promise<() => void>} removes the guard
 */
export async function installCloseGuard({
  invoke,
  getWindow,
  notify,
  checkTimeoutMs = CHECK_TIMEOUT_MS,
}) {
  let prompting = false;
  try {
    const win = await getWindow();
    return await win.onCloseRequested(async (event) => {
      if (prompting) {
        // The question is already on screen; do not stack a second one.
        event.preventDefault();
        return;
      }
      prompting = true;
      try {
        let outcome;
        try {
          outcome = await withTimeout(invoke('vault_local_changes'), checkTimeoutMs);
        } catch (err) {
          outcome = err;
        }
        const decision = closeDecision(outcome);
        if (decision.action === 'close') return;
        const discard = await askDiscardOnClose(decision);
        // Hold the close ourselves, so that the window API does not destroy
        // it a second time after we did.
        event.preventDefault();
        if (discard) {
          try {
            await win.destroy();
          } catch {
            notify?.('Could not close the window. Try again.', 'error');
          }
        }
      } catch {
        // The guard failed before any answer: let the close go ahead.
      } finally {
        prompting = false;
      }
    });
  } catch {
    // Not running inside Tauri (or the window API is unavailable).
    return () => {};
  }
}
