import { describe, it, expect } from 'vitest';
import {
  PLUGIN_STORAGE_KEY,
  PLUGINS,
  defaultPluginState,
  parsePluginState,
  serializePluginState,
  setPluginEnabled,
  isPluginEnabled,
  isPluginAvailable,
  isPluginActive,
  loadPluginState,
  savePluginState,
} from './plugins.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    data,
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('storage blocked');
  },
  setItem() {
    throw new Error('storage blocked');
  },
};

describe('plugin registry', () => {
  it('stores its state under the documented key', () => {
    expect(PLUGIN_STORAGE_KEY).toBe('json-scout.plugins');
  });

  it('lists the Azure Key Vault plugin, which needs the desktop app', () => {
    const vault = PLUGINS.find((plugin) => plugin.id === 'vault');
    expect(vault?.label).toBe('Azure Key Vault');
    expect(vault?.requiresDesktop).toBe(true);
    expect(typeof vault?.description).toBe('string');
    expect(vault.description.length).toBeGreaterThan(0);
  });

  it('has unique plugin ids', () => {
    const ids = PLUGINS.map((plugin) => plugin.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('defaultPluginState', () => {
  it('has every plugin off', () => {
    expect(defaultPluginState()).toEqual({ vault: false });
  });

  it('returns a fresh object each time', () => {
    expect(defaultPluginState()).not.toBe(defaultPluginState());
  });
});

describe('parsePluginState', () => {
  it('defaults every plugin to off for missing input', () => {
    for (const raw of [undefined, null, '']) {
      expect(parsePluginState(raw)).toEqual({ vault: false });
    }
  });

  it('defaults to off for garbage', () => {
    for (const raw of ['not json', '[]', 'null', '42', '"vault"', 'true', '{', '[true]']) {
      expect(parsePluginState(raw), String(raw)).toEqual({ vault: false });
    }
  });

  it('restores an enabled plugin', () => {
    expect(parsePluginState('{"vault":true}')).toEqual({ vault: true });
  });

  it('treats only a literal true as on', () => {
    for (const value of ['"yes"', '1', '"true"', 'null', '{}', '[]', 'false']) {
      expect(parsePluginState(`{"vault":${value}}`), value).toEqual({ vault: false });
    }
  });

  it('ignores plugins it does not know about', () => {
    expect(parsePluginState('{"unknown":true,"vault":true}')).toEqual({ vault: true });
    expect(parsePluginState('{"unknown":true}')).toEqual({ vault: false });
  });

  it('does not let a prototype key switch a plugin on', () => {
    expect(parsePluginState('{"__proto__":{"vault":true}}')).toEqual({ vault: false });
  });

  it('is not an object that inherits from a stored one', () => {
    expect(Object.keys(parsePluginState('{"vault":true,"extra":1}'))).toEqual(['vault']);
  });
});

describe('serializePluginState', () => {
  it('round-trips through parsePluginState', () => {
    for (const state of [{ vault: true }, { vault: false }]) {
      expect(parsePluginState(serializePluginState(state))).toEqual(state);
    }
  });

  it('writes only known plugins as booleans', () => {
    const text = serializePluginState({ vault: 'yes', extra: true });
    expect(JSON.parse(text)).toEqual({ vault: false });
  });

  it('tolerates a missing state', () => {
    expect(JSON.parse(serializePluginState(undefined))).toEqual({ vault: false });
  });
});

describe('setPluginEnabled', () => {
  it('returns a new state with the plugin switched on', () => {
    const before = { vault: false };
    const after = setPluginEnabled(before, 'vault', true);
    expect(after).toEqual({ vault: true });
    expect(before).toEqual({ vault: false });
    expect(after).not.toBe(before);
  });

  it('switches a plugin off again', () => {
    expect(setPluginEnabled({ vault: true }, 'vault', false)).toEqual({ vault: false });
  });

  it('coerces the flag to a boolean', () => {
    expect(setPluginEnabled({ vault: false }, 'vault', 'yes')).toEqual({ vault: true });
    expect(setPluginEnabled({ vault: true }, 'vault', 0)).toEqual({ vault: false });
  });

  it('leaves the state unchanged for an unknown plugin', () => {
    expect(setPluginEnabled({ vault: true }, 'nope', true)).toEqual({ vault: true });
    expect(setPluginEnabled({ vault: false }, '__proto__', true)).toEqual({ vault: false });
  });
});

describe('isPluginEnabled', () => {
  it('reads the flag of a known plugin', () => {
    expect(isPluginEnabled({ vault: true }, 'vault')).toBe(true);
    expect(isPluginEnabled({ vault: false }, 'vault')).toBe(false);
  });

  it('is false for an unknown plugin or a missing state', () => {
    expect(isPluginEnabled({ vault: true }, 'nope')).toBe(false);
    expect(isPluginEnabled(undefined, 'vault')).toBe(false);
    expect(isPluginEnabled({}, 'vault')).toBe(false);
  });
});

describe('isPluginAvailable and isPluginActive', () => {
  it('needs the desktop app for the vault plugin', () => {
    expect(isPluginAvailable('vault', { isTauri: true })).toBe(true);
    expect(isPluginAvailable('vault', { isTauri: false })).toBe(false);
    expect(isPluginAvailable('vault', undefined)).toBe(false);
  });

  it('is unavailable for an unknown plugin', () => {
    expect(isPluginAvailable('nope', { isTauri: true })).toBe(false);
  });

  it('is active only when switched on and available', () => {
    expect(isPluginActive({ vault: true }, 'vault', { isTauri: true })).toBe(true);
    expect(isPluginActive({ vault: false }, 'vault', { isTauri: true })).toBe(false);
    // A stored "on" never activates the plugin where it cannot work.
    expect(isPluginActive({ vault: true }, 'vault', { isTauri: false })).toBe(false);
  });
});

describe('loadPluginState', () => {
  it('reads the stored state', () => {
    const storage = memoryStorage({ [PLUGIN_STORAGE_KEY]: '{"vault":true}' });
    expect(loadPluginState(storage)).toEqual({ vault: true });
  });

  it('defaults to off when nothing is stored', () => {
    expect(loadPluginState(memoryStorage())).toEqual({ vault: false });
  });

  it('falls back to off when storage throws or is missing', () => {
    expect(loadPluginState(throwingStorage)).toEqual({ vault: false });
    expect(loadPluginState(undefined)).toEqual({ vault: false });
    expect(loadPluginState(null)).toEqual({ vault: false });
  });

  it('falls back to off for a corrupt value', () => {
    const storage = memoryStorage({ [PLUGIN_STORAGE_KEY]: '{oops' });
    expect(loadPluginState(storage)).toEqual({ vault: false });
  });
});

describe('savePluginState', () => {
  it('writes the serialised state and reports success', () => {
    const storage = memoryStorage();
    expect(savePluginState(storage, { vault: true })).toBe(true);
    expect(storage.data.get(PLUGIN_STORAGE_KEY)).toBe('{"vault":true}');
  });

  it('reports failure instead of throwing when storage is unavailable', () => {
    expect(savePluginState(throwingStorage, { vault: true })).toBe(false);
    expect(savePluginState(undefined, { vault: true })).toBe(false);
  });
});
