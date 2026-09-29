const STORAGE_KEY = 'json-scout:theme';

/**
 * Apply and persist a theme ('dark' | 'light') on the document root.
 * @param {'dark'|'light'} theme
 */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable (private mode); theme still applies for this session.
  }
}

/**
 * Read the persisted theme, defaulting to 'dark'.
 * @returns {'dark'|'light'}
 */
export function getStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  return next;
}

export function initTheme() {
  applyTheme(getStoredTheme());
}
