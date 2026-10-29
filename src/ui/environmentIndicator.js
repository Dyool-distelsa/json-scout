/**
 * Persistent chrome for the loaded vault, not the app's build channel or the
 * document being edited. Naming follows environment_of in vault/service.rs;
 * this is a visual hint only, never an authorization or push guard.
 */
const LABELS = { dev: 'DEV', qa: 'QA', stg: 'STG', prod: 'PROD', unknown: 'UNKNOWN', none: 'No vault' };

export function environmentOf(vault) {
  if (!vault) return 'none';
  const suffix = /-([^-]+)$/.exec(vault.toLowerCase())?.[1];
  if (suffix === 'main') return 'prod';
  return ['dev', 'qa', 'stg', 'prod'].includes(suffix) ? suffix : 'unknown';
}

/**
 * @param {HTMLElement} container
 * @param {{ setWindowTitle?: (title: string) => Promise<void>, onTitleError?: (error: unknown) => void }} options
 */
export function createEnvironmentIndicator(container, { setWindowTitle, onTitleError = () => {} } = {}) {
  container.classList.add('environment-brand');
  const logo = document.createElement('span');
  logo.className = 'environment-brand__logo';
  logo.textContent = '{ }';
  logo.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'environment-brand__dot';
  dot.setAttribute('aria-hidden', 'true');
  logo.append(dot);
  const name = document.createElement('span');
  name.className = 'environment-brand__name';
  name.textContent = 'JSON Scout';
  const badge = document.createElement('span');
  badge.className = 'environment-badge';
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');
  container.replaceChildren(logo, name, badge);

  let environment = 'none';
  let baseTitle = document.title;
  let titleUpdates = Promise.resolve();
  function renderTitle() {
    const title = environment === 'none' ? baseTitle : `[Vault: ${LABELS[environment]}] ${baseTitle}`;
    document.title = title;
    // Keep desktop updates ordered even while the native bridge is loading.
    // A failed update must not block subsequent file/environment changes.
    if (setWindowTitle) {
      titleUpdates = titleUpdates.then(() => setWindowTitle(title)).catch(onTitleError);
    }
  }

  function setVault(vault) {
    environment = environmentOf(vault);
    document.documentElement.dataset.vaultEnvironment = environment;
    badge.textContent = environment === 'none' ? LABELS.none : `Vault · ${LABELS[environment]}`;
    container.title = vault
      ? `Loaded vault: ${vault}\nEnvironment inferred from the vault name; not the app build or the open file.`
      : 'No vault loaded. This indicator describes the loaded vault, not the app build or the open file.';
    renderTitle();
  }

  setVault(null);
  return {
    setVault,
    setDocumentTitle(title) {
      baseTitle = title;
      renderTitle();
    },
  };
}
