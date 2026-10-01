import { describe, it, expect } from 'vitest';
import {
  MAX_RECENT_VAULTS,
  filterSecrets,
  isValidVaultName,
  rememberVault,
  parseRecentVaults,
  errorMessage,
  needsPullConfirmation,
  INITIAL_SESSION,
  reduceSession,
  panelStage,
  stageContent,
  unavailableMessage,
  loginErrorMessage,
  isSignedOutError,
  SESSION_EXPIRED_MESSAGE,
} from './vaultModel.js';

const item = (name, localState = 'remote', enabled = true) => ({ name, enabled, localState });

describe('filterSecrets', () => {
  const items = [item('App-Config'), item('db-password'), item('APP-secret'), item('queue')];

  it('returns every item for an empty query', () => {
    expect(filterSecrets(items, '')).toEqual(items);
  });

  it('treats a whitespace-only query as empty', () => {
    expect(filterSecrets(items, '   ')).toEqual(items);
  });

  it('matches a case-insensitive substring', () => {
    expect(filterSecrets(items, 'app').map((i) => i.name)).toEqual(['App-Config', 'APP-secret']);
  });

  it('matches in the middle of a name', () => {
    expect(filterSecrets(items, 'PASS').map((i) => i.name)).toEqual(['db-password']);
  });

  it('keeps the original order', () => {
    expect(filterSecrets(items, '-').map((i) => i.name)).toEqual(['App-Config', 'db-password', 'APP-secret']);
  });

  it('trims the query before matching', () => {
    expect(filterSecrets(items, '  queue ').map((i) => i.name)).toEqual(['queue']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterSecrets(items, 'zzz')).toEqual([]);
  });

  it('does not mutate the input and returns a new array', () => {
    const copy = [...items];
    const result = filterSecrets(items, '');
    expect(items).toEqual(copy);
    expect(result).not.toBe(items);
  });

  it('tolerates a non-array input and a non-string query', () => {
    expect(filterSecrets(null, 'a')).toEqual([]);
    expect(filterSecrets(undefined, 'a')).toEqual([]);
    expect(filterSecrets(items, undefined)).toEqual(items);
  });

  it('skips entries without a string name', () => {
    expect(filterSecrets([{ enabled: true }, null, item('abc')], 'a').map((i) => i.name)).toEqual(['abc']);
  });
});

describe('isValidVaultName', () => {
  it('accepts alphanumerics and inner hyphens', () => {
    expect(isValidVaultName('kv-prod-01')).toBe(true);
    expect(isValidVaultName('A')).toBe(true);
    expect(isValidVaultName('9lives')).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(isValidVaultName('')).toBe(false);
  });

  it('rejects a leading hyphen', () => {
    expect(isValidVaultName('-kv')).toBe(false);
  });

  it('accepts a trailing hyphen, matching the backend rule', () => {
    expect(isValidVaultName('kv-')).toBe(true);
  });

  it('enforces the 127 character boundary', () => {
    expect(isValidVaultName('a'.repeat(127))).toBe(true);
    expect(isValidVaultName('a'.repeat(128))).toBe(false);
  });

  it('rejects shell metacharacters, spaces, dots and underscores', () => {
    for (const bad of ['kv name', 'kv;rm', 'kv&x', 'kv.vault', 'kv_x', 'kv/x', 'kv\\x', '$(x)', 'kv\n']) {
      expect(isValidVaultName(bad)).toBe(false);
    }
  });

  it('rejects non-ASCII letters', () => {
    expect(isValidVaultName('kvé')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidVaultName(null)).toBe(false);
    expect(isValidVaultName(undefined)).toBe(false);
    expect(isValidVaultName(42)).toBe(false);
  });
});

describe('rememberVault', () => {
  it('puts the newest vault first', () => {
    expect(rememberVault(['a', 'b'], 'c', 5)).toEqual(['c', 'a', 'b']);
  });

  it('moves an existing vault to the front without duplicating it', () => {
    expect(rememberVault(['a', 'b', 'c'], 'b', 5)).toEqual(['b', 'a', 'c']);
  });

  it('dedupes case-insensitively and keeps the newest casing', () => {
    expect(rememberVault(['Alpha', 'b'], 'alpha', 5)).toEqual(['alpha', 'b']);
  });

  it('bounds the list to max entries, dropping the oldest', () => {
    expect(rememberVault(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('ignores an invalid name', () => {
    expect(rememberVault(['a'], '-bad', 5)).toEqual(['a']);
    expect(rememberVault(['a'], '', 5)).toEqual(['a']);
    expect(rememberVault(['a'], null, 5)).toEqual(['a']);
  });

  it('does not mutate the input list', () => {
    const list = ['a', 'b'];
    rememberVault(list, 'c', 5);
    expect(list).toEqual(['a', 'b']);
  });

  it('tolerates a non-array list', () => {
    expect(rememberVault(null, 'a', 5)).toEqual(['a']);
    expect(rememberVault(undefined, 'a', 5)).toEqual(['a']);
  });

  it('uses a sensible default bound', () => {
    expect(MAX_RECENT_VAULTS).toBeGreaterThan(0);
    const many = Array.from({ length: MAX_RECENT_VAULTS + 5 }, (_, i) => `kv${i}`);
    expect(rememberVault(many, 'fresh').length).toBe(MAX_RECENT_VAULTS);
    expect(rememberVault(many, 'fresh')[0]).toBe('fresh');
  });

  it('returns an empty list for a non-positive max', () => {
    expect(rememberVault(['a'], 'b', 0)).toEqual([]);
  });
});

describe('parseRecentVaults', () => {
  it('parses a JSON array of valid names', () => {
    expect(parseRecentVaults('["a","b"]')).toEqual(['a', 'b']);
  });

  it('returns an empty list for null, empty or malformed input', () => {
    expect(parseRecentVaults(null)).toEqual([]);
    expect(parseRecentVaults('')).toEqual([]);
    expect(parseRecentVaults('{oops')).toEqual([]);
    expect(parseRecentVaults('{"a":1}')).toEqual([]);
  });

  it('drops invalid entries and duplicates', () => {
    expect(parseRecentVaults('["a","-bad",42,null,"A","b"]')).toEqual(['a', 'b']);
  });

  it('bounds the result', () => {
    const raw = JSON.stringify(Array.from({ length: MAX_RECENT_VAULTS + 3 }, (_, i) => `kv${i}`));
    expect(parseRecentVaults(raw)).toHaveLength(MAX_RECENT_VAULTS);
  });
});

describe('errorMessage', () => {
  it('maps not_signed_in to the az login instruction', () => {
    expect(errorMessage({ kind: 'not_signed_in', message: 'raw' })).toBe(
      'Not signed in to Azure. Run `az login` and retry.'
    );
  });

  it('maps az_missing to an install hint', () => {
    expect(errorMessage({ kind: 'az_missing', message: 'raw' })).toMatch(/Azure CLI.*not found/i);
  });

  it('maps forbidden to a message about reading or writing', () => {
    expect(errorMessage({ kind: 'forbidden', message: 'raw' })).toMatch(/read or write/i);
  });

  it('words the push error kinds for people, never with a value', () => {
    expect(errorMessage({ kind: 'not_pulled', message: 'raw' })).toBe(
      'This secret has no local working copy. Pull it before pushing.'
    );
    expect(errorMessage({ kind: 'no_changes', message: 'raw' })).toBe('There are no changes to push.');
    expect(errorMessage({ kind: 'preview_required', message: 'raw' })).toBe(
      'The preview is out of date. Review the changes again before pushing.'
    );
    expect(errorMessage({ kind: 'conflict', message: 'raw' })).toBe(
      "The secret changed in Azure after you pulled it. Re-pull it, or overwrite the vault's version."
    );
  });

  it('keeps the backend text for invalid JSON and duplicate keys, because it names the position', () => {
    const invalid = 'The working copy is not valid JSON (line 3, column 5). Fix it and try again.';
    expect(errorMessage({ kind: 'invalid_json', message: invalid })).toBe(invalid);
    const duplicate = 'The JSON repeats a key in the same object (at line 4).';
    expect(errorMessage({ kind: 'duplicate_keys', message: duplicate })).toBe(duplicate);
  });

  it('falls back to a fixed sentence when those messages are missing', () => {
    expect(errorMessage({ kind: 'invalid_json' })).toBe(
      'The working copy is not valid JSON. Fix it and try again.'
    );
    expect(errorMessage({ kind: 'duplicate_keys', message: '' })).toBe(
      'The JSON repeats a key in the same object. Remove the duplicate and try again.'
    );
  });

  it('maps timeout to a retry message', () => {
    expect(errorMessage({ kind: 'timeout', message: 'raw' })).toMatch(/retry/i);
  });

  it('uses the backend message for other kinds', () => {
    for (const kind of ['not_found', 'invalid_name', 'parse', 'io', 'cli', 'internal']) {
      expect(errorMessage({ kind, message: `backend ${kind}` })).toBe(`backend ${kind}`);
    }
  });

  it('uses the backend message for an unknown kind', () => {
    expect(errorMessage({ kind: 'brand_new', message: 'something' })).toBe('something');
  });

  it('accepts a plain string', () => {
    expect(errorMessage('boom')).toBe('boom');
  });

  it('accepts an Error instance', () => {
    expect(errorMessage(new Error('bad'))).toBe('bad');
  });

  it('falls back to a generic message for unknown shapes', () => {
    for (const bad of [null, undefined, 42, {}, { kind: 'cli' }, { kind: 'cli', message: '' }, '']) {
      expect(errorMessage(bad)).toBe('Vault request failed.');
    }
  });
});

describe('needsPullConfirmation', () => {
  it('is true only for a modified secret', () => {
    expect(needsPullConfirmation(item('a', 'modified'))).toBe(true);
    expect(needsPullConfirmation(item('a', 'clean'))).toBe(false);
    expect(needsPullConfirmation(item('a', 'remote'))).toBe(false);
  });

  it('is false for missing or malformed items', () => {
    expect(needsPullConfirmation(null)).toBe(false);
    expect(needsPullConfirmation(undefined)).toBe(false);
    expect(needsPullConfirmation({})).toBe(false);
  });
});

const identity = { user: 'ana@example.com', subscription: 'Dev' };
const notSignedIn = { kind: 'not_signed_in', message: 'raw' };
const azMissing = { kind: 'az_missing', message: 'raw' };

describe('isSignedOutError', () => {
  it('is true only for the not_signed_in kind', () => {
    expect(isSignedOutError(notSignedIn)).toBe(true);
    expect(isSignedOutError(azMissing)).toBe(false);
    expect(isSignedOutError(new Error('x'))).toBe(false);
    expect(isSignedOutError(null)).toBe(false);
    expect(isSignedOutError('not_signed_in')).toBe(false);
  });
});

describe('reduceSession', () => {
  it('starts with nothing known', () => {
    expect(INITIAL_SESSION).toEqual({ identity: null, error: null, checking: false, signingIn: false });
  });

  it('marks a check as running and clears the previous error', () => {
    const failed = reduceSession(INITIAL_SESSION, { type: 'check-failed', error: azMissing });
    expect(reduceSession(failed, { type: 'check' })).toEqual({
      identity: null,
      error: null,
      checking: true,
      signingIn: false,
    });
  });

  it('records the identity of a successful check', () => {
    const checking = reduceSession(INITIAL_SESSION, { type: 'check' });
    expect(reduceSession(checking, { type: 'checked', identity })).toEqual({
      identity,
      error: null,
      checking: false,
      signingIn: false,
    });
  });

  it('records a failed check and forgets any identity', () => {
    const ready = reduceSession(INITIAL_SESSION, { type: 'checked', identity });
    expect(reduceSession(ready, { type: 'check-failed', error: notSignedIn })).toEqual({
      identity: null,
      error: notSignedIn,
      checking: false,
      signingIn: false,
    });
  });

  it('stops a check that was cancelled without recording an outcome', () => {
    const checking = reduceSession(INITIAL_SESSION, { type: 'check' });
    expect(reduceSession(checking, { type: 'check-cancelled' })).toEqual(INITIAL_SESSION);
  });

  it('marks a sign-in as running', () => {
    const signedOut = reduceSession(INITIAL_SESSION, { type: 'check-failed', error: notSignedIn });
    expect(reduceSession(signedOut, { type: 'sign-in' })).toEqual({
      identity: null,
      error: null,
      checking: false,
      signingIn: true,
    });
  });

  it('becomes signed in when the sign-in succeeds', () => {
    const signingIn = reduceSession(INITIAL_SESSION, { type: 'sign-in' });
    expect(reduceSession(signingIn, { type: 'signed-in', identity })).toEqual({
      identity,
      error: null,
      checking: false,
      signingIn: false,
    });
  });

  it('goes back to signed out when the sign-in fails for any reason but a missing CLI', () => {
    const signingIn = reduceSession(INITIAL_SESSION, { type: 'sign-in' });
    for (const kind of ['cli', 'timeout', 'io', 'internal']) {
      const next = reduceSession(signingIn, { type: 'sign-in-failed', error: { kind, message: 'x' } });
      expect(next, kind).toEqual({
        identity: null,
        error: { kind: 'not_signed_in' },
        checking: false,
        signingIn: false,
      });
    }
  });

  it('keeps the missing-CLI error when the sign-in cannot start', () => {
    const signingIn = reduceSession(INITIAL_SESSION, { type: 'sign-in' });
    const next = reduceSession(signingIn, { type: 'sign-in-failed', error: azMissing });
    expect(next.error).toEqual(azMissing);
    expect(next.signingIn).toBe(false);
  });

  it('drops the identity when a later call reports the session expired', () => {
    const ready = reduceSession(INITIAL_SESSION, { type: 'checked', identity });
    expect(reduceSession(ready, { type: 'expired' })).toEqual({
      identity: null,
      error: { kind: 'not_signed_in' },
      checking: false,
      signingIn: false,
    });
  });

  it('never leaves a successful call without an identity, so the panel cannot stall', () => {
    expect(panelStage(reduceSession(INITIAL_SESSION, { type: 'checked' }))).toBe('ready');
    expect(panelStage(reduceSession(INITIAL_SESSION, { type: 'signed-in', identity: null }))).toBe(
      'ready'
    );
  });

  it('never leaves a failed check without an error, so the panel cannot stall', () => {
    for (const error of [undefined, null, '']) {
      const next = reduceSession(INITIAL_SESSION, { type: 'check-failed', error });
      expect(panelStage(next), String(error)).toBe('unavailable');
    }
  });

  it('does not mutate its input and ignores unknown events', () => {
    const before = { ...INITIAL_SESSION };
    reduceSession(INITIAL_SESSION, { type: 'check' });
    expect(INITIAL_SESSION).toEqual(before);
    expect(reduceSession(INITIAL_SESSION, { type: 'nope' })).toEqual(INITIAL_SESSION);
    expect(reduceSession(INITIAL_SESSION, undefined)).toEqual(INITIAL_SESSION);
  });
});

describe('panelStage', () => {
  const session = (patch) => ({ ...INITIAL_SESSION, ...patch });

  it('is checking while the first status call runs or before anything is known', () => {
    expect(panelStage(session({ checking: true }))).toBe('checking');
    expect(panelStage(INITIAL_SESSION)).toBe('checking');
  });

  it('is ready once an identity is known', () => {
    expect(panelStage(session({ identity }))).toBe('ready');
  });

  it('is signed-out for a not_signed_in error', () => {
    expect(panelStage(session({ error: notSignedIn }))).toBe('signed-out');
  });

  it('is signing-in while the login runs, whatever else is known', () => {
    expect(panelStage(session({ signingIn: true }))).toBe('signing-in');
    expect(panelStage(session({ signingIn: true, error: notSignedIn }))).toBe('signing-in');
  });

  it('is unavailable for a missing CLI and for any other error', () => {
    expect(panelStage(session({ error: azMissing }))).toBe('unavailable');
    expect(panelStage(session({ error: { kind: 'timeout', message: 'x' } }))).toBe('unavailable');
    expect(panelStage(session({ error: { kind: 'cli', message: 'x' } }))).toBe('unavailable');
  });

  it('tolerates a missing session', () => {
    expect(panelStage(undefined)).toBe('checking');
  });
});

describe('unavailableMessage', () => {
  it('explains that the Azure CLI is required when it is missing', () => {
    const text = unavailableMessage(azMissing);
    expect(text).toMatch(/Azure CLI/);
    expect(text).toMatch(/required/i);
    expect(text).toMatch(/PATH/);
  });

  it('uses the shared error mapping for everything else', () => {
    expect(unavailableMessage({ kind: 'timeout', message: 'raw' })).toBe(
      errorMessage({ kind: 'timeout', message: 'raw' })
    );
    expect(unavailableMessage({ kind: 'cli', message: 'boom' })).toBe('boom');
  });
});

describe('SESSION_EXPIRED_MESSAGE', () => {
  it('asks the user to sign in again instead of pointing at the terminal', () => {
    expect(SESSION_EXPIRED_MESSAGE).toMatch(/sign in again/i);
    expect(SESSION_EXPIRED_MESSAGE).not.toMatch(/az login/);
  });
});

describe('loginErrorMessage', () => {
  it('says the sign-in did not finish when it timed out', () => {
    expect(loginErrorMessage({ kind: 'timeout', message: 'raw' })).toMatch(/did not finish/i);
  });

  it('does not tell the user to run az login after a failed sign-in', () => {
    const text = loginErrorMessage(notSignedIn);
    expect(text).not.toMatch(/az login/);
    expect(text).toMatch(/try again/i);
  });

  it('uses the shared mapping for other errors', () => {
    expect(loginErrorMessage(azMissing)).toBe(errorMessage(azMissing));
    expect(loginErrorMessage({ kind: 'cli', message: 'boom' })).toBe('boom');
    expect(loginErrorMessage(null)).toBe('Vault request failed.');
  });
});

describe('stageContent', () => {
  it('offers a sign-in button and says a browser window will open when signed out', () => {
    const content = stageContent('signed-out', notSignedIn);
    expect(content.title).toMatch(/sign in to azure/i);
    expect(content.hint).toMatch(/browser window will open/i);
    expect(content.action).toEqual({ kind: 'sign-in', label: 'Sign in to Azure', disabled: false });
  });

  it('shows a waiting state with a disabled action while signing in', () => {
    const content = stageContent('signing-in', null);
    expect(content.title).toBe('Waiting for sign-in in your browser…');
    expect(content.action?.kind).toBe('sign-in');
    expect(content.action?.disabled).toBe(true);
  });

  it('shows a status line and no action while checking', () => {
    const content = stageContent('checking', null);
    expect(content.title).toMatch(/checking/i);
    expect(content.action).toBeNull();
  });

  it('explains the problem and offers another check when unavailable', () => {
    const content = stageContent('unavailable', azMissing);
    expect(content.title).toBe(unavailableMessage(azMissing));
    expect(content.action).toEqual({ kind: 'retry', label: 'Check again', disabled: false });
  });

  it('has no content for the ready stage', () => {
    expect(stageContent('ready', null)).toBeNull();
  });
});
