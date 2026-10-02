/**
 * The build tag shown in the status bar, so it is always clear which build is
 * running. The values are injected at build time by vite.config.js (`define`).
 */

/**
 * @typedef {{ version?: string, commit?: string, commitFull?: string, date?: string }} BuildInfo
 */

const UNKNOWN = new Set(['', 'unknown']);
const known = (value) => typeof value === 'string' && !UNKNOWN.has(value.trim());

/**
 * @param {BuildInfo} info
 * @returns {{ text: string, title: string }} the visible tag, and the tooltip
 *   with the full commit and the build date.
 */
export function formatBuildTag(info = {}) {
  const { version, commit, commitFull, date } = info ?? {};
  const label = known(version) ? version.trim() : 'dev';
  const parts = [/^\d/.test(label) ? `v${label}` : label];
  if (known(commit)) parts.push(commit.trim());

  const details = [`Version: ${label}`];
  if (known(commitFull)) details.push(`Commit: ${commitFull.trim()}`);
  else if (known(commit)) details.push(`Commit: ${commit.trim()}`);
  if (known(date)) details.push(`Built: ${date.trim()}`);
  return { text: parts.join(' · '), title: details.join('\n') };
}

/**
 * Read the injected build constants. Each is guarded with `typeof`, so a
 * context that was not built through Vite (a bare script, a test runner with
 * another config) still gets a usable fallback instead of a ReferenceError.
 * @returns {BuildInfo}
 */
export function readBuildInfo() {
  /* eslint-disable no-undef */
  return {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown',
    commitFull: typeof __APP_COMMIT_FULL__ === 'string' ? __APP_COMMIT_FULL__ : 'unknown',
    date: typeof __APP_BUILD_DATE__ === 'string' ? __APP_BUILD_DATE__ : 'unknown',
  };
  /* eslint-enable no-undef */
}
