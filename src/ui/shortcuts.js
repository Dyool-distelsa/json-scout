/**
 * Keyboard shortcut table and matching. Pure: no DOM access, so it is unit
 * tested in node. `Mod` means Ctrl or Cmd. Keys are stored lowercase and
 * compared case-insensitively because Shift changes the case of `event.key`.
 */

export const SHORTCUTS = [
  { action: 'open', key: 'o', label: 'Open' },
  { action: 'save', key: 's', label: 'Save' },
  { action: 'saveAs', key: 's', shift: true, label: 'Save As' },
  { action: 'format', key: 'f', shift: true, label: 'Format' },
  { action: 'minify', key: 'm', shift: true, label: 'Minify' },
  { action: 'validate', key: 'enter', shift: true, label: 'Validate' },
  { action: 'repair', key: 'r', shift: true, label: 'Repair' },
  { action: 'sortKeys', key: 'o', shift: true, label: 'Sort Keys' },
  { action: 'diffToggle', key: 'd', shift: true, label: 'Toggle Diff' },
  { action: 'toggleSidebar', key: 'b', label: 'Toggle Files panel' },
  { action: 'toggleRightPanel', key: 'j', label: 'Toggle Tools panel' },
  { action: 'themeToggle', key: 't', shift: true, label: 'Toggle theme' },
];

/**
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean,
 *   shiftKey?: boolean, altKey?: boolean }} event
 * @returns {string | null} the action id, or null when nothing matches.
 */
export function matchShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (typeof event.key !== 'string') return null;
  const key = event.key.toLowerCase();
  const shift = !!event.shiftKey;
  const hit = SHORTCUTS.find((s) => s.key === key && !!s.shift === shift);
  return hit ? hit.action : null;
}

/**
 * Like matchShortcut, but ignores OS auto-repeat so holding a combination
 * does not re-run toggles (panels, theme, diff) or repeat Format/Save.
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean, repeat?: boolean }} event
 * @returns {string|null} Action id to run, or null.
 */
export function shouldFireShortcut(event) {
  if (event.repeat) return null;
  return matchShortcut(event);
}

const KEY_NAMES = { enter: 'Enter' };
const MAC_KEY_SYMBOLS = { enter: '↵' };

/**
 * Human-readable label for tooltips: 'Ctrl+Shift+F' or '⌘⇧F'.
 * @param {string} action
 * @param {boolean} isMac
 * @returns {string} '' for an unknown action.
 */
export function formatShortcut(action, isMac) {
  const s = SHORTCUTS.find((entry) => entry.action === action);
  if (!s) return '';
  if (isMac) {
    return `⌘${s.shift ? '⇧' : ''}${MAC_KEY_SYMBOLS[s.key] ?? s.key.toUpperCase()}`;
  }
  return ['Ctrl', s.shift ? 'Shift' : null, KEY_NAMES[s.key] ?? s.key.toUpperCase()]
    .filter(Boolean)
    .join('+');
}

/** True on macOS/iOS browsers; safe outside a browser. */
export function detectMac() {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}
