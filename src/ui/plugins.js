/**
 * Optional plugins and their on/off state. Pure helpers plus two thin storage
 * helpers that take the storage object as a parameter, so they are testable
 * and every access is guarded: storage can be missing or throw (private mode,
 * blocked site data) and the app must keep working with everything off.
 */

export const PLUGIN_STORAGE_KEY = 'json-scout.plugins';

/**
 * Registry of plugins the Plugins menu offers.
 * `requiresDesktop`: the plugin only works inside the Tauri shell.
 */
export const PLUGINS = Object.freeze([
  Object.freeze({
    id: 'vault',
    label: 'Azure Key Vault',
    description: 'Browse and pull Key Vault secrets from the sidebar.',
    requiresDesktop: true,
  }),
]);

const KNOWN_IDS = PLUGINS.map((plugin) => plugin.id);

const isKnown = (id) => typeof id === 'string' && KNOWN_IDS.includes(id);

/** Every plugin off. */
export function defaultPluginState() {
  return Object.fromEntries(KNOWN_IDS.map((id) => [id, false]));
}

/**
 * Restore the state from its stored JSON text. Anything malformed yields every
 * plugin off; only a literal `true` for a known plugin turns it on.
 * @param {string|null|undefined} raw
 * @returns {Record<string, boolean>}
 */
export function parsePluginState(raw) {
  const state = defaultPluginState();
  if (typeof raw !== 'string' || raw === '') return state;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return state;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return state;
  for (const id of KNOWN_IDS) {
    if (Object.hasOwn(parsed, id) && parsed[id] === true) state[id] = true;
  }
  return state;
}

/**
 * JSON text for storage: known plugins only, as booleans.
 * @param {Record<string, unknown>|undefined} state
 * @returns {string}
 */
export function serializePluginState(state) {
  return JSON.stringify(
    Object.fromEntries(KNOWN_IDS.map((id) => [id, isPluginEnabled(state, id)]))
  );
}

/**
 * Whether the user switched `id` on. Unknown plugins are never enabled.
 * @param {Record<string, unknown>|undefined} state
 * @param {string} id
 * @returns {boolean}
 */
export function isPluginEnabled(state, id) {
  return isKnown(id) && state?.[id] === true;
}

/**
 * A copy of `state` with `id` switched on or off. An unknown id leaves the
 * state unchanged.
 * @param {Record<string, boolean>} state
 * @param {string} id
 * @param {unknown} on
 * @returns {Record<string, boolean>}
 */
export function setPluginEnabled(state, id, on) {
  const next = Object.fromEntries(KNOWN_IDS.map((known) => [known, isPluginEnabled(state, known)]));
  if (isKnown(id)) next[id] = Boolean(on);
  return next;
}

/**
 * Whether `id` can work in this environment (the vault needs the desktop app).
 * @param {string} id
 * @param {{ isTauri?: boolean }|undefined} env
 * @returns {boolean}
 */
export function isPluginAvailable(id, env) {
  const plugin = PLUGINS.find((entry) => entry.id === id);
  if (!plugin) return false;
  return !plugin.requiresDesktop || env?.isTauri === true;
}

/**
 * On and able to work. A stored "on" never activates a plugin where it cannot run.
 * @param {Record<string, unknown>|undefined} state
 * @param {string} id
 * @param {{ isTauri?: boolean }|undefined} env
 * @returns {boolean}
 */
export function isPluginActive(state, id, env) {
  return isPluginEnabled(state, id) && isPluginAvailable(id, env);
}

/**
 * Read the persisted state; any failure yields every plugin off.
 * @param {Pick<Storage, 'getItem'>|null|undefined} storage
 * @returns {Record<string, boolean>}
 */
export function loadPluginState(storage) {
  try {
    return parsePluginState(storage?.getItem(PLUGIN_STORAGE_KEY));
  } catch {
    return defaultPluginState();
  }
}

/**
 * Persist the state. Storage is a convenience: a failure is reported, never thrown.
 * @param {Pick<Storage, 'setItem'>|null|undefined} storage
 * @param {Record<string, boolean>} state
 * @returns {boolean} whether the state was written
 */
export function savePluginState(storage, state) {
  try {
    if (!storage) return false;
    storage.setItem(PLUGIN_STORAGE_KEY, serializePluginState(state));
    return true;
  } catch {
    return false;
  }
}
