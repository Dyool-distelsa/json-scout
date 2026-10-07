import { button } from './dom.js';
import { openModal } from './modal.js';
import { createSettingsPanel } from './settings.js';
import { createHelpPanel } from './helpPanel.js';

/**
 * The Settings and Help dialogs opened from the toolbar. Each call builds a
 * fresh dialog, so Settings re-reads the current state every time.
 */

function openPanelDialog(title, fill) {
  const modal = openModal({ title });
  modal.dialog.classList.add('modal--panel');
  fill(modal.body);
  const close = button('Close', 'primary', () => modal.close());
  modal.footer.appendChild(close);
  modal.focus(close);
  return modal;
}

/** @param {(message: string, kind?: string) => void} notify */
export function openSettingsDialog(notify) {
  return openPanelDialog('Settings', (body) => createSettingsPanel(body, notify));
}

/** @param {{ isTauri: boolean, notify: (message: string, kind?: string) => void }} deps */
export function openHelpDialog(deps) {
  return openPanelDialog('Help', (body) => createHelpPanel(body, deps));
}
