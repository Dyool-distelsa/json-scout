import {
  filterSecrets,
  isValidVaultName,
  rememberVault,
  parseRecentVaults,
  errorMessage,
  needsPullConfirmation,
} from './vaultModel.js';

const RECENT_STORAGE_KEY = 'json-scout.vault.recent';
const INVALID_NAME_MESSAGE =
  'Vault names use letters, digits and hyphens only, and cannot start with a hyphen.';
const BADGE_TITLES = {
  remote: 'Not pulled yet',
  clean: 'Pulled, no local edits',
  modified: 'Pulled, edited locally',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

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
 * Render the Vault panel: load an Azure Key Vault by name, search its
 * secrets and pull one into the editor. Read-only: nothing here can write
 * to a vault. Secret values are never rendered, only names and local state.
 * Outside the Tauri shell the panel shows a disabled explanation and never
 * invokes a command.
 * @param {HTMLElement} container
 * @param {{
 *   invoke: (command: string, args?: object) => Promise<any>,
 *   openFile: (path: string) => Promise<boolean|void>,
 *   notify: (message: string, kind?: 'success'|'error'|'info') => void,
 *   isTauri: boolean,
 * }} deps
 */
export function createVaultPanel(container, { invoke, openFile, notify, isTauri }) {
  container.innerHTML = '';
  const root = el('div', 'vault-panel');
  container.appendChild(root);

  if (!isTauri) {
    root.appendChild(
      el('p', 'vault-panel__notice', 'Azure Key Vault sync is only available in the desktop app.')
    );
    return {};
  }

  const state = {
    vault: null, // vault the current list belongs to (not the input's live value)
    identity: null,
    items: [],
    query: '',
    busy: null, // null | { kind: 'load' } | { kind: 'pull', name }
    confirmName: null,
    recent: readRecentVaults(),
    message: null, // { text, kind: 'error' | 'info' }
  };

  // --- Static structure -----------------------------------------------------
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
  root.append(form, chips, messageEl, listSection);

  // --- Rendering ------------------------------------------------------------
  function renderChips() {
    chips.replaceChildren();
    chips.hidden = state.recent.length === 0;
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
    const identity = state.identity;
    if (!identity) {
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

    if (state.confirmName === item.name && !isPulling) {
      pullButton.hidden = true;
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
    const listed = state.vault !== null;
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

  function remember(vault) {
    state.recent = rememberVault(state.recent, vault);
    writeRecentVaults(state.recent);
  }

  async function load(rawName) {
    if (state.busy) return;
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
      const identity = await invoke('vault_status');
      const items = await invoke('vault_list', { vault });
      state.vault = vault;
      state.identity = identity;
      state.items = Array.isArray(items) ? items : [];
      state.confirmName = null;
      remember(vault);
    } catch (err) {
      if (state.vault !== vault) {
        state.vault = null;
        state.identity = null;
        state.items = [];
        state.confirmName = null;
      }
      reportError(err);
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
        const current = state.items.find((entry) => entry.name === item.name);
        if (needsPullConfirmation(current)) {
          state.confirmName = item.name;
          return;
        }
      }
      const result = await invoke('vault_pull', { vault, name: item.name });
      const current = state.items.find((entry) => entry.name === item.name);
      if (current) current.localState = 'clean';
      const opened = await openFile(result.path);
      if (opened !== false) notify?.(`Pulled "${item.name}" from ${vault}.`, 'success');
    } catch (err) {
      reportError(err);
    } finally {
      state.busy = null;
      render();
      const target =
        state.confirmName === item.name
          ? rowFocusTargets.get(`${item.name}:cancel`)
          : rowFocusTargets.get(item.name);
      target?.focus();
    }
  }

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
  return {};
}
