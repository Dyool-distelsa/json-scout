import {
  filterSecrets,
  isValidVaultName,
  rememberVault,
  parseRecentVaults,
  errorMessage,
  needsPullConfirmation,
  INITIAL_SESSION,
  reduceSession,
  panelStage,
  stageContent,
  loginErrorMessage,
  isSignedOutError,
  SESSION_EXPIRED_MESSAGE,
} from './vaultModel.js';
import { el, button } from './dom.js';
import { openPushDialog } from './vaultPushDialog.js';
import { pushSuccessMessage } from './vaultPush.js';

const RECENT_STORAGE_KEY = 'json-scout.vault.recent';
const INVALID_NAME_MESSAGE =
  'Vault names use letters, digits and hyphens only, and cannot start with a hyphen.';
const BADGE_TITLES = {
  remote: 'Not pulled yet',
  clean: 'Pulled, no local edits',
  modified: 'Pulled, edited locally',
};

function readRecentVaults() {
  try {
    return parseRecentVaults(globalThis.localStorage?.getItem(RECENT_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeRecentVaults(list) {
  try {
    globalThis.localStorage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage is a convenience only; the panel works without it.
  }
}

/**
 * Render the Vault panel: check the Azure session (offering a sign-in when
 * there is none), then load an Azure Key Vault by name, search its secrets,
 * pull one into the editor and push an edited one back. A push always goes
 * through a review dialog (see vaultPushDialog.js), and the backend refuses
 * one that was not previewed. Secret values and CLI output are never
 * rendered by the panel, only names, local state and fixed or
 * backend-summarised messages; the dialog shows values only on request. Outside the Tauri shell the
 * panel shows a disabled explanation and never invokes a command.
 *
 * The panel is idle until `activate()` (its tab is shown); `deactivate()`
 * makes it stop issuing calls, and the result of a check still in flight is
 * discarded.
 * @param {HTMLElement} container
 * @param {{
 *   invoke: (command: string, args?: object) => Promise<any>,
 *   openFile: (path: string) => Promise<boolean|void>,
 *   notify: (message: string, kind?: 'success'|'error'|'info') => void,
 *   isTauri: boolean,
 * }} deps
 * @returns {{
 *   activate: () => void,
 *   deactivate: () => void,
 *   refreshLocalStates: () => Promise<void>,
 * }}
 */
export function createVaultPanel(container, { invoke, openFile, notify, isTauri }) {
  container.innerHTML = '';
  const root = el('div', 'vault-panel');
  container.appendChild(root);

  if (!isTauri) {
    root.appendChild(
      el('p', 'vault-panel__notice', 'Azure Key Vault sync is only available in the desktop app.')
    );
    return { activate() {}, deactivate() {}, refreshLocalStates: async () => {} };
  }

  const state = {
    active: false,
    session: INITIAL_SESSION,
    checkToken: 0, // bumped by deactivate() so a stale status result is dropped
    vault: null, // vault the current list belongs to (not the input's live value)
    items: [],
    query: '',
    busy: null, // null | { kind: 'load' } | { kind: 'pull'|'push-preview'|'push', name }
    itemsGen: 0, // bumped whenever the listed rows change, so a stale disk read is dropped
    confirmName: null,
    recent: readRecentVaults(),
    message: null, // { text, kind: 'error' | 'info' }
  };

  // --- Static structure -----------------------------------------------------
  const authEl = el('div', 'vault-auth');
  const authTitle = el('p', 'vault-auth__title');
  authTitle.setAttribute('role', 'status');
  authTitle.setAttribute('aria-live', 'polite');
  const authHint = el('p', 'vault-auth__hint');
  const authButton = el('button', 'primary vault-auth__action');
  authButton.type = 'button';
  authEl.append(authTitle, authHint, authButton);
  let authAction = null; // 'sign-in' | 'retry' | null, as last rendered

  const form = el('form', 'vault-panel__form');
  form.noValidate = true;
  const nameInput = el('input', 'vault-input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Key Vault name';
  nameInput.setAttribute('aria-label', 'Key Vault name');
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  const loadButton = el('button', 'primary vault-load', 'Load');
  loadButton.type = 'submit';
  form.append(nameInput, loadButton);

  const chips = el('div', 'vault-chips');
  chips.setAttribute('aria-label', 'Recent vaults');
  const messageEl = el('div', 'vault-message');
  messageEl.setAttribute('role', 'status');
  messageEl.setAttribute('aria-live', 'polite');
  const identityEl = el('div', 'vault-identity');
  const searchInput = el('input', 'vault-input vault-search');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search secrets';
  searchInput.setAttribute('aria-label', 'Search secrets');
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  const summaryEl = el('div', 'vault-summary');
  summaryEl.setAttribute('aria-live', 'polite');
  const listEl = el('ul', 'vault-list');
  listEl.setAttribute('aria-label', 'Secrets');
  const listSection = el('div', 'vault-results');
  listSection.append(identityEl, searchInput, summaryEl, listEl);
  root.append(authEl, form, chips, messageEl, listSection);

  const isReady = () => panelStage(state.session) === 'ready';

  // --- Rendering ------------------------------------------------------------
  function renderAuth() {
    const stage = panelStage(state.session);
    const content = stageContent(stage, state.session.error);
    root.dataset.stage = stage;
    authEl.hidden = content === null;
    if (!content) {
      authAction = null;
      return;
    }
    authTitle.textContent = content.title;
    authHint.textContent = content.hint;
    authHint.hidden = content.hint === '';
    authButton.hidden = content.action === null;
    authAction = content.action?.kind ?? null;
    if (content.action) {
      authButton.textContent = content.action.label;
      authButton.disabled = content.action.disabled;
    }
    authEl.setAttribute('aria-busy', stage === 'checking' || stage === 'signing-in' ? 'true' : 'false');
  }

  function renderChips() {
    chips.replaceChildren();
    chips.hidden = state.recent.length === 0 || !isReady();
    for (const name of state.recent) {
      const chip = button(name, 'vault-chip', () => {
        nameInput.value = name;
        load(name);
      });
      chip.title = `Load ${name}`;
      chip.disabled = state.busy !== null;
      chips.appendChild(chip);
    }
  }

  function renderMessage() {
    messageEl.textContent = state.message?.text ?? '';
    messageEl.className = `vault-message${state.message ? ` vault-message--${state.message.kind}` : ''}`;
    messageEl.hidden = !state.message;
  }

  function renderIdentity() {
    const identity = state.session.identity;
    if (!identity?.user) {
      identityEl.textContent = '';
      return;
    }
    const parts = [`Signed in as ${identity.user}`];
    if (identity.subscription) parts.push(identity.subscription);
    identityEl.textContent = parts.join(' · ');
  }

  function renderBusy() {
    const busy = state.busy !== null;
    loadButton.disabled = busy;
    loadButton.textContent = state.busy?.kind === 'load' ? 'Loading…' : 'Load';
    root.setAttribute('aria-busy', busy ? 'true' : 'false');
    renderChips();
  }

  function renderRow(item, focusTargets) {
    const row = el('li', 'vault-row');
    if (item.enabled === false) row.classList.add('vault-row--disabled');

    const nameEl = el('span', 'vault-row__name', item.name);
    nameEl.title = item.enabled === false ? `${item.name} (disabled in Key Vault)` : item.name;
    const badge = el('span', `vault-badge vault-badge--${item.localState}`, item.localState);
    badge.title = BADGE_TITLES[item.localState] ?? '';
    row.append(nameEl);
    if (item.enabled === false) row.appendChild(el('span', 'vault-tag', 'disabled'));
    row.appendChild(badge);

    const isPulling = state.busy?.kind === 'pull' && state.busy.name === item.name;
    const pullButton = el('button', 'primary vault-row__action', isPulling ? 'Pulling…' : 'Pull');
    pullButton.type = 'button';
    pullButton.disabled = state.busy !== null;
    pullButton.setAttribute('aria-label', `Pull ${item.name}`);
    pullButton.addEventListener('click', () => requestPull(item));
    row.appendChild(pullButton);

    let pushButton = null;
    if (item.localState === 'modified') {
      const isPreviewing = state.busy?.kind === 'push-preview' && state.busy.name === item.name;
      pushButton = el('button', 'vault-btn vault-row__action', isPreviewing ? 'Checking…' : 'Push');
      pushButton.type = 'button';
      pushButton.disabled = state.busy !== null;
      pushButton.setAttribute('aria-label', `Push ${item.name}`);
      pushButton.addEventListener('click', () => requestPush(item));
      row.appendChild(pushButton);
      focusTargets?.set(`${item.name}:push`, pushButton);
    }

    if (state.confirmName === item.name && !isPulling) {
      pullButton.hidden = true;
      if (pushButton) pushButton.hidden = true;
      const confirm = el('div', 'vault-confirm');
      confirm.setAttribute('role', 'group');
      confirm.setAttribute('aria-label', `Confirm discarding local edits to ${item.name}`);
      confirm.appendChild(el('span', 'vault-confirm__text', 'Discard local edits?'));
      const discard = button('Discard and pull', 'danger vault-confirm__btn', () => {
        state.confirmName = null;
        pull(item);
      });
      const cancel = button('Cancel', 'vault-btn vault-confirm__btn', () => {
        state.confirmName = null;
        renderList();
        focusTargets?.get(item.name)?.focus();
      });
      discard.disabled = state.busy !== null;
      confirm.append(discard, cancel);
      row.appendChild(confirm);
      focusTargets?.set(`${item.name}:cancel`, cancel);
    }
    focusTargets?.set(item.name, pullButton);
    return row;
  }

  let rowFocusTargets = new Map();
  function renderList() {
    const listed = state.vault !== null && isReady();
    listSection.hidden = !listed;
    if (!listed) return;
    renderIdentity();
    const matches = filterSecrets(state.items, state.query);
    rowFocusTargets = new Map();
    listEl.replaceChildren(...matches.map((item) => renderRow(item, rowFocusTargets)));

    if (state.items.length === 0) {
      summaryEl.textContent = `${state.vault} has no secrets.`;
    } else if (matches.length === 0) {
      summaryEl.textContent = `No secrets match "${state.query.trim()}".`;
    } else {
      const total = state.items.length;
      summaryEl.textContent =
        matches.length === total
          ? `${state.vault} · ${total} ${total === 1 ? 'secret' : 'secrets'}`
          : `${state.vault} · ${matches.length} of ${total} secrets`;
    }
    searchInput.hidden = state.items.length === 0;
  }

  function render() {
    renderAuth();
    // The vault name and search stay out of reach until a session exists.
    form.hidden = !isReady();
    renderBusy();
    renderMessage();
    renderList();
  }

  // --- Behaviour ------------------------------------------------------------
  function setMessage(text, kind = 'error') {
    state.message = text ? { text, kind } : null;
  }

  function reportError(err) {
    const text = errorMessage(err);
    setMessage(text, 'error');
    notify?.(text, 'error');
  }

  /**
   * A failed vault call. A sign-out discovered mid-session sends the panel
   * back to the sign-in view; anything else is reported as before.
   */
  function handleCallError(err) {
    if (isSignedOutError(err)) {
      state.session = reduceSession(state.session, { type: 'expired' });
      state.vault = null;
      state.items = [];
      state.itemsGen += 1;
      state.confirmName = null;
      setMessage(SESSION_EXPIRED_MESSAGE, 'error');
      notify?.(SESSION_EXPIRED_MESSAGE, 'error');
      return;
    }
    reportError(err);
  }

  function remember(vault) {
    state.recent = rememberVault(state.recent, vault);
    writeRecentVaults(state.recent);
  }

  /** Ask the backend who is signed in; decides which view the panel shows. */
  async function checkSession() {
    if (!state.active || state.session.checking || state.session.signingIn) return;
    const token = ++state.checkToken;
    state.session = reduceSession(state.session, { type: 'check' });
    setMessage(null);
    render();
    try {
      const identity = await invoke('vault_status');
      if (token !== state.checkToken) return; // deactivated meanwhile
      state.session = reduceSession(state.session, { type: 'checked', identity });
    } catch (err) {
      if (token !== state.checkToken) return;
      state.session = reduceSession(state.session, { type: 'check-failed', error: err });
    }
    render();
  }

  /**
   * Open the Azure sign-in in the system browser and wait for it. The result
   * is the signed-in identity only; the backend never hands over a token.
   * It is applied even if the panel was hidden meanwhile: the call is already
   * running and nothing further is issued from here.
   */
  async function signIn() {
    if (panelStage(state.session) !== 'signed-out') return;
    state.session = reduceSession(state.session, { type: 'sign-in' });
    setMessage(null);
    render();
    try {
      const identity = await invoke('vault_login');
      state.session = reduceSession(state.session, { type: 'signed-in', identity });
    } catch (err) {
      state.session = reduceSession(state.session, { type: 'sign-in-failed', error: err });
      if (state.active) {
        const text = loginErrorMessage(err);
        setMessage(text, 'error');
        notify?.(text, 'error');
      }
    }
    // Disabling the button dropped focus; hand it to the next useful control.
    const focusLost =
      document.activeElement === document.body || root.contains(document.activeElement);
    render();
    if (state.active && focusLost) {
      (isReady() ? nameInput : authButton).focus();
    }
  }

  async function load(rawName) {
    if (state.busy || !isReady()) return;
    const vault = String(rawName ?? '').trim();
    if (!isValidVaultName(vault)) {
      setMessage(INVALID_NAME_MESSAGE);
      render();
      return;
    }
    state.busy = { kind: 'load' };
    setMessage(null);
    render();
    try {
      const items = await invoke('vault_list', { vault });
      state.vault = vault;
      state.items = Array.isArray(items) ? items : [];
      state.itemsGen += 1;
      state.confirmName = null;
      remember(vault);
    } catch (err) {
      if (state.vault !== vault) {
        state.vault = null;
        state.items = [];
        state.confirmName = null;
      }
      handleCallError(err);
    } finally {
      state.busy = null;
      render();
    }
  }

  /**
   * Entry point for a click on Pull. A `modified` secret asks before its
   * local edits are overwritten.
   */
  function requestPull(item) {
    if (state.busy) return;
    if (needsPullConfirmation(item)) {
      state.confirmName = item.name;
      renderList();
      rowFocusTargets.get(`${item.name}:cancel`)?.focus();
      return;
    }
    pull(item);
  }

  async function pull(item) {
    if (state.busy) return;
    const vault = state.vault;
    state.busy = { kind: 'pull', name: item.name };
    setMessage(null);
    render();
    try {
      if (item.localState === 'clean') {
        // A clean row may be stale: the working copy could have been edited
        // and saved since the last listing. Re-read local state first so a
        // modified file is never overwritten without confirmation.
        const items = await invoke('vault_list', { vault });
        state.items = Array.isArray(items) ? items : state.items;
        state.itemsGen += 1;
        const current = state.items.find((entry) => entry.name === item.name);
        if (needsPullConfirmation(current)) {
          state.confirmName = item.name;
          return;
        }
        // Hidden meanwhile (the plugin was switched off or the tab changed):
        // do not go on to fetch the secret and open it.
        if (!state.active) return;
      }
      const result = await invoke('vault_pull', { vault, name: item.name });
      const current = state.items.find((entry) => entry.name === item.name);
      if (current) current.localState = 'clean';
      state.itemsGen += 1;
      const opened = await openFile(result.path);
      if (opened !== false) notify?.(`Pulled "${item.name}" from ${vault}.`, 'success');
    } catch (err) {
      handleCallError(err);
    } finally {
      state.busy = null;
      render();
      const target =
        state.confirmName === item.name
          ? rowFocusTargets.get(`${item.name}:cancel`)
          : rowFocusTargets.get(item.name);
      target?.focus();
      refreshLocalStates();
    }
  }

  /**
   * Entry point for a click on Push: ask the backend for a preview (it checks
   * the JSON, compares with the base and looks at the vault), then let the user
   * review it. Nothing is written until the dialog's own confirmation.
   */
  async function requestPush(item) {
    if (state.busy) return;
    const vault = state.vault;
    const name = item.name;
    const focusRow = () => (rowFocusTargets.get(`${name}:push`) ?? rowFocusTargets.get(name))?.focus();
    state.busy = { kind: 'push-preview', name };
    setMessage(null);
    render();
    let preview;
    try {
      preview = await invoke('vault_push_preview', { vault, name });
    } catch (err) {
      state.busy = null;
      handleCallError(err);
      render();
      focusRow();
      return;
    }
    state.busy = null;
    // Hidden meanwhile: do not raise a dialog over whatever the user moved to.
    if (!state.active || state.vault !== vault) {
      render();
      return;
    }
    if (preview?.changed !== true) {
      render();
      notify?.('No changes to push', 'info');
      focusRow();
      return;
    }
    // The panel stays locked for as long as the dialog is open.
    state.busy = { kind: 'push', name };
    render();
    openPushDialog({
      vault,
      name,
      preview,
      invoke,
      restoreFocus: () => rowFocusTargets.get(`${name}:push`),
      onClosed: () => {
        state.busy = null;
        render();
        focusRow();
      },
      onPushed: ({ newVersion }) => {
        const current = state.items.find((entry) => entry.name === name);
        if (current) current.localState = 'clean';
        state.itemsGen += 1;
        notify?.(pushSuccessMessage(name, newVersion), 'success');
        render();
        rowFocusTargets.get(name)?.focus();
        refreshLocalStates();
      },
      // The dialog has closed itself by now (see onClosed): the stale list goes.
      onSignedOut: (err) => {
        handleCallError(err);
        render();
        if (!authButton.hidden && !authButton.disabled) authButton.focus();
      },
      // The secret is modified, so this asks before discarding the edits.
      onRepull: () => requestPull(state.items.find((entry) => entry.name === name) ?? item),
    });
  }

  // --- Local-state refresh --------------------------------------------------
  // A row's state comes from `vault_list`, but an edit saved from the editor
  // changes it without any listing. `vault_local_changes` answers from the local
  // disk alone (no Azure call), so it is cheap enough to ask after every save,
  // on focus, and when the tab comes back.
  const canRefreshLocalStates = () => state.active && isReady() && state.vault !== null;
  let refreshRun = null;
  let refreshQueued = false;

  /** Move the pulled rows to modified or clean; a row that is not pulled is left alone. */
  function applyLocalChanges(changes) {
    const modified = new Set(
      (Array.isArray(changes) ? changes : [])
        .filter((change) => change?.vault === state.vault)
        .map((change) => change.name)
    );
    let changed = false;
    for (const entry of state.items) {
      if (entry.localState === 'remote') continue;
      const next = modified.has(entry.name) ? 'modified' : 'clean';
      if (entry.localState === next) continue;
      entry.localState = next;
      changed = true;
    }
    if (!changed) return;
    state.itemsGen += 1;
    // A confirmation to discard edits makes no sense once there are none.
    const asked = state.items.find((entry) => entry.name === state.confirmName);
    if (asked && asked.localState !== 'modified') state.confirmName = null;
    renderListKeepingFocus();
  }

  /** Re-render the rows without dropping the keyboard focus the user is on. */
  function renderListKeepingFocus() {
    const focused = document.activeElement;
    const focusKey = [...rowFocusTargets].find(([, node]) => node === focused)?.[0];
    renderList();
    if (focusKey === undefined) return;
    (rowFocusTargets.get(focusKey) ?? rowFocusTargets.get(focusKey.split(':')[0]))?.focus();
  }

  async function runLocalStatesRefresh() {
    do {
      refreshQueued = false;
      if (!canRefreshLocalStates()) return;
      const generation = state.itemsGen;
      let changes;
      try {
        changes = await invoke('vault_local_changes');
      } catch {
        // A convenience refresh: the rows stay as they were and nothing is reported.
        return;
      }
      if (!canRefreshLocalStates()) return;
      // The rows were replaced while the disk was being read: ask again.
      if (generation !== state.itemsGen) {
        refreshQueued = true;
        continue;
      }
      applyLocalChanges(changes);
    } while (refreshQueued);
  }

  /**
   * Bring the rows' local state up to date from the disk. Requests made while a
   * read is running share it and trigger one more read afterwards.
   */
  function refreshLocalStates() {
    if (!canRefreshLocalStates()) return Promise.resolve();
    if (refreshRun) {
      refreshQueued = true;
      return refreshRun;
    }
    refreshRun = runLocalStatesRefresh().finally(() => {
      refreshRun = null;
    });
    return refreshRun;
  }

  authButton.addEventListener('click', () => {
    if (authAction === 'sign-in') signIn();
    else if (authAction === 'retry') checkSession();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    load(nameInput.value);
  });
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    renderList();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.confirmName && !state.busy) {
      const name = state.confirmName;
      state.confirmName = null;
      renderList();
      rowFocusTargets.get(name)?.focus();
    }
  });

  render();
  return {
    /** The panel is shown: check the session unless one is already known. */
    activate() {
      if (state.active) return;
      state.active = true;
      if (!isReady()) checkSession();
      else refreshLocalStates();
    },
    /** The panel is hidden: stop issuing calls and drop a check in flight. */
    deactivate() {
      if (!state.active) return;
      state.active = false;
      state.checkToken += 1;
      state.confirmName = null;
      if (state.session.checking) {
        state.session = reduceSession(state.session, { type: 'check-cancelled' });
      }
      render();
    },
    refreshLocalStates,
  };
}
