/**
 * Open documents (editor tabs). Pure: every function returns a new state and
 * touches no DOM, so it is unit tested in node.
 *
 * A tab is either a file (`path` set) or an Untitled document (`path` null)
 * whose text lives in a recoverable draft until it is saved somewhere.
 *
 * @typedef {{
 *   id: string,
 *   path: string|null,
 *   title: string,
 *   dirty: boolean,
 *   fromVault: boolean,
 * }} Tab
 * @typedef {{ tabs: Tab[], activeId: string|null }} TabsState
 */

/** @type {TabsState} */
export const INITIAL_TABS = { tabs: [], activeId: null };

const UNTITLED = /^Untitled (\d+)$/;

/**
 * A draft-safe id (`[a-z0-9-]`) that sorts by creation time, so restored
 * drafts come back in the order they were made.
 * @param {number} [now]
 * @param {() => number} [random]
 * @returns {string}
 */
export function newTabId(now = Date.now(), random = Math.random) {
  const time = now.toString(36).padStart(10, '0');
  const suffix = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${time}-${suffix}`;
}

/** Last segment of a Windows or POSIX path. */
export function baseName(path) {
  return String(path).split(/[\\/]/).pop() || String(path);
}

/** Paths compare without regard to separator style or (Windows) case. */
function samePath(a, b) {
  const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

/** Lowest "Untitled N" not already taken. */
export function nextUntitledTitle(tabs) {
  const used = new Set(
    tabs.filter((t) => t.path === null).map((t) => Number(UNTITLED.exec(t.title)?.[1]))
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return `Untitled ${n}`;
}

/** @returns {Tab|null} */
export function activeTab(state) {
  return state.tabs.find((t) => t.id === state.activeId) ?? null;
}

/** @returns {Tab|null} */
export function findTab(state, id) {
  return state.tabs.find((t) => t.id === id) ?? null;
}

/** @returns {Tab|null} */
export function findTabByPath(state, path) {
  return state.tabs.find((t) => t.path !== null && samePath(t.path, path)) ?? null;
}

/**
 * Add an Untitled tab after the active one (or last, with `atEnd`) and make
 * it active unless `activate` is false.
 * @param {TabsState} state
 * @param {string} id
 * @param {{ dirty?: boolean, activate?: boolean, atEnd?: boolean }} [options]
 */
export function addUntitled(state, id, { dirty = false, activate = true, atEnd = false } = {}) {
  const tab = { id, path: null, title: nextUntitledTitle(state.tabs), dirty, fromVault: false };
  return insert(state, tab, activate, atEnd);
}

/**
 * Add a tab for a file, or just activate the one already showing it.
 * @param {TabsState} state
 * @param {string} id used only when a new tab is needed
 * @param {string} path
 * @param {{ fromVault?: boolean }} [options]
 * @returns {{ state: TabsState, tab: Tab, existed: boolean }}
 */
export function openFileTab(state, id, path, { fromVault = false } = {}) {
  const existing = findTabByPath(state, path);
  if (existing) {
    return { state: { ...state, activeId: existing.id }, tab: existing, existed: true };
  }
  const tab = { id, path, title: baseName(path), dirty: false, fromVault };
  return { state: insert(state, tab, true), tab, existed: false };
}

function insert(state, tab, activate, atEnd = false) {
  const index = atEnd ? -1 : state.tabs.findIndex((t) => t.id === state.activeId);
  const tabs = [...state.tabs];
  tabs.splice(index === -1 ? tabs.length : index + 1, 0, tab);
  return { tabs, activeId: activate || state.activeId === null ? tab.id : state.activeId };
}

export function activate(state, id) {
  return findTab(state, id) ? { ...state, activeId: id } : state;
}

/**
 * Remove a tab. Closing the active tab activates its right neighbour, or the
 * left one when it was last.
 */
export function closeTab(state, id) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId };
  const next = tabs[index] ?? tabs[index - 1] ?? null;
  return { tabs, activeId: next ? next.id : null };
}

/** @param {Partial<Tab>} patch */
export function updateTab(state, id, patch) {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
}

/** The tab now lives at `path`: it is a clean file tab from here on. */
export function markSaved(state, id, path) {
  return updateTab(state, id, { path, title: baseName(path), dirty: false });
}

/** Tab after (`step` 1) or before (`step` -1) the active one, wrapping. */
export function cycle(state, step) {
  if (state.tabs.length === 0) return state;
  const index = state.tabs.findIndex((t) => t.id === state.activeId);
  const next = (index + step + state.tabs.length) % state.tabs.length;
  return { ...state, activeId: state.tabs[next].id };
}
