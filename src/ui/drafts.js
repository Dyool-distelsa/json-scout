/**
 * Where Untitled documents are kept between runs. In the desktop app they are
 * files in the app data folder (see `src-tauri/src/drafts.rs`); in a plain
 * browser tab they fall back to `localStorage`, best effort.
 */

const STORAGE_KEY = 'json-scout.drafts';

/**
 * @typedef {{
 *   list: () => Promise<Array<{ id: string, contents: string }>>,
 *   save: (id: string, contents: string) => Promise<void>,
 *   remove: (id: string) => Promise<void>,
 * }} DraftStore
 */

/**
 * @param {(command: string, args?: object) => Promise<any>} invoke
 * @returns {DraftStore}
 */
export function createTauriDraftStore(invoke) {
  return {
    list: async () => {
      const drafts = await invoke('drafts_list');
      return Array.isArray(drafts) ? drafts : [];
    },
    save: (id, contents) => invoke('draft_save', { id, contents }),
    remove: (id) => invoke('draft_delete', { id }),
  };
}

/**
 * @param {Storage|null} storage
 * @returns {DraftStore}
 */
export function createLocalDraftStore(storage) {
  function read() {
    try {
      const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  function write(drafts) {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(drafts));
    } catch {
      // Storage is a convenience only here.
    }
  }
  return {
    list: async () =>
      Object.entries(read())
        .filter(([, contents]) => typeof contents === 'string')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, contents]) => ({ id, contents })),
    save: async (id, contents) => write({ ...read(), [id]: contents }),
    remove: async (id) => {
      const drafts = read();
      delete drafts[id];
      write(drafts);
    },
  };
}
