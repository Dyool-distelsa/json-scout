/**
 * Pure helpers behind the Vault panel. No DOM, no Tauri, no storage access:
 * everything here is deterministic and unit tested (see vaultModel.test.js).
 */

/** How many recently used vault names the panel remembers. */
export const MAX_RECENT_VAULTS = 8;

/** Same rule as the backend: alphanumeric first character, then up to 126 more of [A-Za-z0-9-]. */
const VAULT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,126}$/;

const GENERIC_ERROR_MESSAGE = 'Vault request failed.';

/**
 * Case-insensitive substring filter over secret names, preserving order.
 * @param {{ name: string }[]} items
 * @param {string} query
 * @returns {object[]} a new array
 */
export function filterSecrets(items, query) {
  if (!Array.isArray(items)) return [];
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (needle === '') return [...items];
  return items.filter(
    (entry) => typeof entry?.name === 'string' && entry.name.toLowerCase().includes(needle)
  );
}

/**
 * Whether `name` is acceptable as a vault name. The panel validates before
 * invoking so an invalid name never reaches the backend.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidVaultName(name) {
  return typeof name === 'string' && VAULT_NAME_PATTERN.test(name);
}

/**
 * Add `name` to a recent-vaults list: most recent first, de-duplicated
 * case-insensitively (the newest casing wins) and bounded to `max`.
 * An invalid name leaves the list unchanged.
 * @param {string[]} list
 * @param {string} name
 * @param {number} [max]
 * @returns {string[]} a new array
 */
export function rememberVault(list, name, max = MAX_RECENT_VAULTS) {
  const current = Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : [];
  const next = isValidVaultName(name)
    ? [name, ...current.filter((entry) => entry.toLowerCase() !== name.toLowerCase())]
    : current;
  return next.slice(0, Math.max(0, max));
}

/**
 * Restore the recent-vaults list from its stored JSON text. Anything
 * malformed yields an empty list; invalid and duplicate entries are dropped.
 * @param {string|null|undefined} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function parseRecentVaults(raw, max = MAX_RECENT_VAULTS) {
  if (typeof raw !== 'string' || raw === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of parsed) {
    if (!isValidVaultName(entry)) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result.slice(0, Math.max(0, max));
}

/**
 * Turn a rejected backend call into user-facing text. Backend errors are
 * `{ kind, message }`; a plain string or an Error is tolerated too.
 * @param {unknown} err
 * @returns {string}
 */
export function errorMessage(err) {
  if (typeof err === 'string') return err !== '' ? err : GENERIC_ERROR_MESSAGE;
  if (err instanceof Error) return err.message !== '' ? err.message : GENERIC_ERROR_MESSAGE;
  const kind = err?.kind;
  switch (kind) {
    case 'not_signed_in':
      return 'Not signed in to Azure. Run `az login` and retry.';
    case 'az_missing':
      return 'Azure CLI (az) not found. Install it, make sure it is on your PATH, then retry.';
    case 'forbidden':
      return 'You do not have read access to this vault or secret.';
    case 'timeout':
      return 'The Azure CLI took too long to respond. Retry in a moment.';
    default: {
      const message = err?.message;
      return typeof message === 'string' && message !== '' ? message : GENERIC_ERROR_MESSAGE;
    }
  }
}

/**
 * Pulling over a locally edited secret would discard those edits, so the
 * panel asks first.
 * @param {{ localState?: string }|null|undefined} item
 * @returns {boolean}
 */
export function needsPullConfirmation(item) {
  return item?.localState === 'modified';
}
