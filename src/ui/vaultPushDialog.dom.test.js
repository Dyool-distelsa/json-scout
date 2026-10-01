// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPushDialog } from './vaultPushDialog.js';
import { MASK } from './vaultPush.js';
import { createFakeInvoke, settle } from './testing/fakeBackend.js';

const BASE_VERSION = '0123456789abcdef0123456789abcdef';
const REMOTE_VERSION = 'fedcba9876543210fedcba9876543210';
const NEW_VERSION = 'aaaaaaaa11111111aaaaaaaa11111111';

const SECRETS = ['old-token-value', 'new-token-value', 'added-key-value', 'remote-edit-value'];

function previewOf(overrides = {}) {
  return {
    changed: true,
    format: 'json',
    baseVersion: BASE_VERSION,
    baseText: '{"user":"ana","token":"old-token-value"}',
    workingText: '{"user":"ana","token":"new-token-value","extra":"added-key-value"}',
    remote: { currentVersion: BASE_VERSION, conflict: false, remoteText: null },
    environment: 'dev',
    contentHash: 'hash-1',
    ...overrides,
  };
}

function conflictPreview(overrides = {}) {
  return previewOf({
    remote: {
      currentVersion: REMOTE_VERSION,
      conflict: true,
      remoteText: '{"user":"ana","token":"remote-edit-value"}',
    },
    ...overrides,
  });
}

let trigger;
let handle;
let fake;
let callbacks;

beforeEach(() => {
  trigger = document.createElement('button');
  trigger.textContent = 'Push';
  document.body.appendChild(trigger);
  trigger.focus();
  fake = createFakeInvoke();
  fake.on('vault_push', { newVersion: NEW_VERSION });
  callbacks = { onPushed: vi.fn(), onRepull: vi.fn() };
});

afterEach(() => {
  handle?.close?.();
  handle = undefined;
  document.body.replaceChildren();
});

function open(preview = previewOf(), { vault = 'kv-dev', name = 'cfg' } = {}) {
  handle = openPushDialog({
    vault,
    name,
    preview,
    invoke: fake.invoke,
    restoreFocus: () => trigger,
    ...callbacks,
  });
  return handle;
}

const dialog = () => document.querySelector('[role="dialog"]');
const buttonByText = (text) =>
  [...dialog().querySelectorAll('button')].find((node) => node.textContent === text);
const typedInput = () => dialog().querySelector('input[type="text"]');
const alertText = () => dialog().querySelector('[role="alert"]')?.textContent ?? '';

function type(value) {
  const input = typedInput();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Every attribute value and text node in the dialog, to prove no secret is anywhere. */
function everythingVisibleOrAttached() {
  const parts = [dialog().textContent];
  for (const node of dialog().querySelectorAll('*')) {
    for (const attribute of node.attributes) parts.push(attribute.value);
  }
  return parts.join('\n');
}

describe('push dialog: what it shows', () => {
  it('is an accessible modal that names the vault and the secret', () => {
    open();
    expect(dialog()).not.toBeNull();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().textContent).toContain('kv-dev');
    expect(dialog().textContent).toContain('cfg');
    expect(dialog().textContent).toContain('Pushes appear in Azure as your account.');
  });

  it('shows the environment in the header: dev neutral, qa and stg amber, prod and unknown red', () => {
    const tones = { dev: 'neutral', qa: 'caution', stg: 'caution', prod: 'danger', unknown: 'danger' };
    for (const [environment, tone] of Object.entries(tones)) {
      open(previewOf({ environment }));
      expect(dialog().classList.contains(`modal--${tone}`), environment).toBe(true);
      expect(dialog().querySelector('.push-env').textContent, environment).toBe(
        { dev: 'DEV', qa: 'QA', stg: 'STG', prod: 'PROD', unknown: 'UNKNOWN' }[environment]
      );
      handle.close();
    }
  });

  it('lists the changed keys with a summary and keeps every value masked by default', () => {
    open();

    const text = dialog().textContent;
    expect(text).toContain('$.token');
    expect(text).toContain('$.extra');
    expect(text).toContain('1 added · 1 changed');
    expect(text).toContain(MASK);
    for (const secret of SECRETS) expect(everythingVisibleOrAttached(), secret).not.toContain(secret);
  });

  it('reveals the values with one toggle and hides them again', () => {
    open();
    const toggle = buttonByText('Reveal values');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();

    expect(dialog().textContent).toContain('"old-token-value"');
    expect(dialog().textContent).toContain('"new-token-value"');
    expect(dialog().textContent).toContain('"added-key-value"');
    expect(buttonByText('Hide values').getAttribute('aria-pressed')).toBe('true');

    buttonByText('Hide values').click();

    for (const secret of SECRETS) expect(everythingVisibleOrAttached(), secret).not.toContain(secret);
  });

  it('never puts a value into an attribute, even when revealed', () => {
    open();
    buttonByText('Reveal values').click();
    for (const node of dialog().querySelectorAll('*')) {
      for (const attribute of node.attributes) {
        for (const secret of SECRETS) expect(attribute.value).not.toContain(secret);
      }
    }
  });

  it('summarises a text secret by line and masks its content', () => {
    open(
      previewOf({
        format: 'text',
        baseText: 'keep\nold-line-value',
        workingText: 'keep\nnew-line-value',
      })
    );

    expect(dialog().textContent).toContain('1 line added · 1 line removed');
    expect(dialog().textContent).toContain('line 2');
    expect(dialog().textContent).not.toContain('new-line-value');
    expect(dialog().textContent).not.toContain('old-line-value');

    buttonByText('Reveal values').click();
    expect(dialog().textContent).toContain('new-line-value');
    expect(dialog().textContent).toContain('old-line-value');
  });

  it('says so when only formatting or key order changed', () => {
    open(previewOf({ baseText: '{"a":1,"b":2}', workingText: '{"b":2,"a":1}' }));
    expect(dialog().textContent).toContain('No key-level changes');
  });

  it('shows the short version the edit is based on', () => {
    open();
    expect(dialog().textContent).toContain('01234567');
    expect(dialog().textContent).not.toContain(BASE_VERSION);
  });
});

describe('push dialog: confirming', () => {
  it('pushes a dev secret with one click and reports the new version', async () => {
    open();
    expect(typedInput()).toBeNull();

    buttonByText('Push').click();
    await settle();

    expect(fake.callsOf('vault_push')).toEqual([
      {
        command: 'vault_push',
        args: { vault: 'kv-dev', name: 'cfg', contentHash: 'hash-1', overwrite: false },
      },
    ]);
    expect(callbacks.onPushed).toHaveBeenCalledWith({ newVersion: NEW_VERSION });
    expect(dialog()).toBeNull();
  });

  it('asks for the secret name before pushing to production', async () => {
    open(previewOf({ environment: 'prod' }));
    const push = buttonByText('Push');
    expect(typedInput()).not.toBeNull();
    expect(push.disabled).toBe(true);

    for (const wrong of ['', 'cf', 'CFG', ' cfg', 'cfg ', 'cfgx']) {
      type(wrong);
      expect(push.disabled, JSON.stringify(wrong)).toBe(true);
    }
    push.click();
    await settle();
    expect(fake.callsOf('vault_push')).toHaveLength(0);

    type('cfg');
    expect(push.disabled).toBe(false);
    push.click();
    await settle();
    expect(fake.callsOf('vault_push')).toHaveLength(1);
  });

  it('refuses a click that reaches the handler without the name typed (not just a disabled button)', async () => {
    open(previewOf({ environment: 'prod' }));
    const push = buttonByText('Push');

    push.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(fake.callsOf('vault_push')).toHaveLength(0);
  });

  it('asks for the secret name for an unknown environment too', () => {
    open(previewOf({ environment: 'unknown' }));
    expect(typedInput()).not.toBeNull();
    expect(buttonByText('Push').disabled).toBe(true);
  });

  it('enables the production push again if the typed name is edited away from the secret name', () => {
    open(previewOf({ environment: 'prod' }));
    type('cfg');
    expect(buttonByText('Push').disabled).toBe(false);
    type('cf');
    expect(buttonByText('Push').disabled).toBe(true);
  });

  it('blocks a second submission while the push is in flight', async () => {
    open();
    const pending = fake.hold('vault_push');
    const push = buttonByText('Push');

    push.click();
    push.click();
    await settle();

    expect(fake.callsOf('vault_push')).toHaveLength(1);
    expect(push.disabled).toBe(true);
    expect(push.textContent).toBe('Pushing…');
    expect(dialog().getAttribute('aria-busy')).toBe('true');
    expect(buttonByText('Cancel').disabled).toBe(true);

    pending.resolve({ newVersion: NEW_VERSION });
    await settle();
    expect(callbacks.onPushed).toHaveBeenCalledTimes(1);
  });

  it('refuses a click that reaches the handler while a push is already running', async () => {
    open();
    const pending = fake.hold('vault_push');
    const push = buttonByText('Push');
    push.click();
    await settle();

    push.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(fake.callsOf('vault_push')).toHaveLength(1);
    pending.resolve({ newVersion: NEW_VERSION });
    await settle();
  });

  it('does not close on Escape while the push is in flight', async () => {
    open();
    const pending = fake.hold('vault_push');
    buttonByText('Push').click();
    await settle();

    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );

    expect(dialog()).not.toBeNull();
    pending.resolve({ newVersion: NEW_VERSION });
    await settle();
    expect(dialog()).toBeNull();
  });

  it('stays open on a failure, shows the message and lets the user retry', async () => {
    open();
    fake.on('vault_push', () => {
      throw { kind: 'forbidden', message: 'raw' };
    });

    buttonByText('Push').click();
    await settle();

    expect(dialog()).not.toBeNull();
    expect(alertText()).toContain('read or write');
    expect(buttonByText('Push').disabled).toBe(false);
    expect(callbacks.onPushed).not.toHaveBeenCalled();

    fake.on('vault_push', { newVersion: NEW_VERSION });
    buttonByText('Push').click();
    await settle();
    expect(callbacks.onPushed).toHaveBeenCalledTimes(1);
  });

  it('maps every push error kind to its message', async () => {
    const cases = {
      not_pulled: /no local working copy/,
      invalid_json: /not valid JSON/,
      duplicate_keys: /repeats a key/,
      no_changes: /no changes to push/,
    };
    for (const [kind, pattern] of Object.entries(cases)) {
      open();
      fake.on('vault_push', () => {
        throw { kind };
      });
      buttonByText('Push').click();
      await settle();
      expect(alertText(), kind).toMatch(pattern);
      handle.close();
    }
  });

  it('closes on Escape and gives focus back to the trigger', () => {
    open();
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(fake.calls).toHaveLength(0);
  });

  it('Cancel closes without pushing', () => {
    open();
    buttonByText('Cancel').click();
    expect(dialog()).toBeNull();
    expect(fake.callsOf('vault_push')).toHaveLength(0);
  });
});

describe('push dialog: a conflict', () => {
  it('says the secret changed in Azure and offers Re-pull and Overwrite anyway instead of Push', () => {
    open(conflictPreview());

    expect(dialog().textContent).toContain('changed in Azure since you pulled it');
    expect(dialog().textContent).toContain('01234567');
    expect(dialog().textContent).toContain('fedcba98');
    expect(buttonByText('Re-pull')).toBeDefined();
    expect(buttonByText('Overwrite anyway')).toBeDefined();
    expect(buttonByText('Push')).toBeUndefined();
  });

  it('shows what changed in Azure, masked until revealed, separately from the local edits', () => {
    open(conflictPreview());

    expect(dialog().textContent).toContain('Changed in Azure');
    expect(dialog().textContent).toContain('Your edits');
    for (const secret of SECRETS) expect(everythingVisibleOrAttached(), secret).not.toContain(secret);

    buttonByText('Reveal values').click();
    expect(dialog().textContent).toContain('"remote-edit-value"');
  });

  it('Overwrite anyway pushes the same hash with overwrite set', async () => {
    open(conflictPreview());

    buttonByText('Overwrite anyway').click();
    await settle();

    expect(fake.callsOf('vault_push')).toEqual([
      {
        command: 'vault_push',
        args: { vault: 'kv-dev', name: 'cfg', contentHash: 'hash-1', overwrite: true },
      },
    ]);
    expect(callbacks.onPushed).toHaveBeenCalledWith({ newVersion: NEW_VERSION });
  });

  it('Re-pull closes the dialog and hands over to the caller without calling the backend', () => {
    open(conflictPreview());

    buttonByText('Re-pull').click();

    expect(dialog()).toBeNull();
    expect(callbacks.onRepull).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(0);
  });

  it('asks for the secret name before overwriting in production', async () => {
    open(conflictPreview({ environment: 'prod' }));
    const overwrite = buttonByText('Overwrite anyway');
    expect(overwrite.disabled).toBe(true);
    overwrite.click();
    await settle();
    expect(fake.callsOf('vault_push')).toHaveLength(0);

    type('cfg');
    expect(overwrite.disabled).toBe(false);
  });

  it('blocks a double submission of Overwrite anyway', async () => {
    open(conflictPreview());
    const pending = fake.hold('vault_push');
    const overwrite = buttonByText('Overwrite anyway');

    overwrite.click();
    overwrite.click();
    await settle();

    expect(fake.callsOf('vault_push')).toHaveLength(1);
    expect(buttonByText('Re-pull').disabled).toBe(true);
    pending.resolve({ newVersion: NEW_VERSION });
    await settle();
  });
});

describe('push dialog: the secret changed after the preview', () => {
  it('turns a conflict answer to a plain push into a prompt to review again', async () => {
    open();
    fake.on('vault_push', () => {
      throw { kind: 'conflict', message: 'raw' };
    });

    buttonByText('Push').click();
    await settle();

    expect(alertText()).toContain('changed in Azure after you pulled it');
    expect(buttonByText('Review again')).toBeDefined();
    expect(callbacks.onPushed).not.toHaveBeenCalled();
  });

  it('reviewing again fetches a new preview and shows the new remote', async () => {
    open();
    fake.on('vault_push', () => {
      throw { kind: 'conflict' };
    });
    buttonByText('Push').click();
    await settle();
    fake.on('vault_push_preview', conflictPreview({ contentHash: 'hash-2' }));

    buttonByText('Review again').click();
    await settle();

    expect(fake.callsOf('vault_push_preview')).toEqual([
      { command: 'vault_push_preview', args: { vault: 'kv-dev', name: 'cfg' } },
    ]);
    expect(dialog().textContent).toContain('changed in Azure since you pulled it');
    expect(alertText()).toBe('');

    fake.on('vault_push', { newVersion: NEW_VERSION });
    buttonByText('Overwrite anyway').click();
    await settle();
    expect(fake.callsOf('vault_push').at(-1).args).toEqual({
      vault: 'kv-dev',
      name: 'cfg',
      contentHash: 'hash-2',
      overwrite: true,
    });
  });

  it('also offers to review again when the preview is no longer valid', async () => {
    open();
    fake.on('vault_push', () => {
      throw { kind: 'preview_required' };
    });
    buttonByText('Push').click();
    await settle();

    expect(alertText()).toContain('Review the changes again');
    expect(buttonByText('Review again')).toBeDefined();
  });

  it('clears a typed confirmation when a new preview replaces the old one', async () => {
    open(previewOf({ environment: 'prod' }));
    type('cfg');
    fake.on('vault_push', () => {
      throw { kind: 'preview_required' };
    });
    buttonByText('Push').click();
    await settle();
    fake.on('vault_push_preview', previewOf({ environment: 'prod', contentHash: 'hash-2' }));

    buttonByText('Review again').click();
    await settle();

    expect(typedInput().value).toBe('');
    expect(buttonByText('Push').disabled).toBe(true);
  });

  it('keeps the dialog open with the reason when reviewing again fails', async () => {
    open();
    fake.on('vault_push', () => {
      throw { kind: 'preview_required' };
    });
    buttonByText('Push').click();
    await settle();
    fake.on('vault_push_preview', () => {
      throw { kind: 'timeout' };
    });

    buttonByText('Review again').click();
    await settle();

    expect(dialog()).not.toBeNull();
    expect(alertText()).toContain('took too long');
  });

  it('says there is nothing left to push when the new preview shows no changes', async () => {
    open();
    fake.on('vault_push', () => {
      throw { kind: 'preview_required' };
    });
    buttonByText('Push').click();
    await settle();
    fake.on('vault_push_preview', previewOf({ changed: false }));

    buttonByText('Review again').click();
    await settle();

    expect(alertText()).toContain('no changes to push');
    expect(buttonByText('Push')).toBeUndefined();
  });
});

describe('push dialog: the Azure session ended', () => {
  const signedOut = () => {
    throw { kind: 'not_signed_in', message: 'raw' };
  };

  it('closes and hands over to the caller when a push finds the session gone', async () => {
    const onSignedOut = vi.fn();
    callbacks.onSignedOut = onSignedOut;
    open();
    fake.on('vault_push', signedOut);

    buttonByText('Push').click();
    await settle();

    expect(dialog()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut.mock.calls[0][0].kind).toBe('not_signed_in');
    expect(callbacks.onPushed).not.toHaveBeenCalled();
    expect(fake.callsOf('vault_push')).toHaveLength(1);
  });

  it('closes and hands over when Review again finds the session gone', async () => {
    const onSignedOut = vi.fn();
    callbacks.onSignedOut = onSignedOut;
    open();
    fake.on('vault_push', () => {
      throw { kind: 'preview_required' };
    });
    buttonByText('Push').click();
    await settle();
    fake.on('vault_push_preview', signedOut);

    buttonByText('Review again').click();
    await settle();

    expect(dialog()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('hands over after the dialog has closed, so the caller sees a settled page', async () => {
    let openWhenCalled;
    callbacks.onSignedOut = () => {
      openWhenCalled = dialog() !== null;
    };
    open();
    fake.on('vault_push', signedOut);

    buttonByText('Push').click();
    await settle();

    expect(openWhenCalled).toBe(false);
  });
});
