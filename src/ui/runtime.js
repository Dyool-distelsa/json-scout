/**
 * Pure helpers for detecting the Tauri runtime and deriving a
 * user-facing display name for the currently open file path.
 */

/**
 * True when running inside the Tauri desktop shell, where native IPC
 * (and plugins such as `@tauri-apps/plugin-dialog`) are available.
 * False in a plain browser tab, e.g. `vite dev` opened directly in a
 * browser without the Tauri webview host.
 * @returns {boolean}
 */
export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Derive the display file name shown in the title bar / status bar
 * from a full file path. Returns 'Untitled' when there is no current
 * path (nothing open yet, or content loaded without a backing file).
 * @param {string|null|undefined} path
 * @returns {string}
 */
export function deriveDisplayFileName(path) {
  if (!path) return 'Untitled';
  return path.split(/[\\/]/).pop();
}
