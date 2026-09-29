/**
 * Render the Settings panel: a toggle to install/remove the Windows
 * Explorer context-menu entries (backed by Rust `winreg` commands under
 * HKCU). Falls back to a disabled explanation when not running inside
 * the Tauri shell (e.g. a plain browser preview).
 * @param {HTMLElement} container
 * @param {(message: string, kind?: 'error'|'info') => void} onNotify
 */
export function createSettingsPanel(container, onNotify) {
  container.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'settings-row';

  const labelWrap = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'settings-row__label';
  label.textContent = 'Explorer context menu';
  const desc = document.createElement('div');
  desc.className = 'settings-row__desc';
  desc.textContent =
    'Adds "Open in JSON Scout" / "JSON Scout here" entries under HKCU (no admin rights required).';
  labelWrap.appendChild(label);
  labelWrap.appendChild(desc);

  const button = document.createElement('button');
  button.className = 'primary';
  button.textContent = 'Loading...';
  button.disabled = true;

  row.appendChild(labelWrap);
  row.appendChild(button);
  container.appendChild(row);

  let installed = false;

  async function invokeTauri(command) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command);
  }

  async function refresh() {
    try {
      installed = await invokeTauri('is_context_menu_installed');
      button.textContent = installed ? 'Remove' : 'Install';
      button.className = installed ? 'danger' : 'primary';
      button.disabled = false;
    } catch {
      button.textContent = 'Unavailable outside the desktop app';
      button.disabled = true;
    }
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await invokeTauri(installed ? 'uninstall_context_menu' : 'install_context_menu');
      onNotify?.(installed ? 'Context menu entries removed.' : 'Context menu entries installed.', 'info');
      await refresh();
    } catch (err) {
      onNotify?.(`Failed to update context menu: ${err}`, 'error');
      button.disabled = false;
    }
  });

  refresh();

  return { refresh };
}
