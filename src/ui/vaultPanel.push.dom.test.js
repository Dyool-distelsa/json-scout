// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultPanel } from './vaultPanel.js';
import { createFakeInvoke, settle } from './testing/fakeBackend.js';

const IDENTITY = { user: 'ana@example.com', subscription: 'Dev' };
const BASE_VERSION = '0123456789abcdef0123456789abcdef';
const NEW_VERSION = 'aaaaaaaa11111111aaaaaaaa11111111';
const item = (name, localState = 'remote') => ({ name, enabled: true, localState });

function previewOf(overrides = {}) {
  return {
    changed: true,
    format: 'json',
    baseVersion: BASE_VERSION,
    baseText: '{"token":"old-token-value"}',
    workingText: '{"token":"new-token-value"}',
    remote: { currentVersion: BASE_VERSION, conflict: false, remoteText: null },
    environment: 'dev',
    contentHash: 'hash-1',
    ...overrides,
  };
}

let container;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const modal of document.querySelectorAll('.modal-backdrop')) modal.remove();
  container.remove();
  document.body.replaceChildren();
});

function setup({ items = [item('cfg', 'modified')], preview = previewOf() } = {}) {
  const fake = createFakeInvoke();
  fake.on('vault_status', IDENTITY);
  fake.on('vault_list', () => items);
  fake.on('vault_push_preview', preview);
  fake.on('vault_push', { newVersion: NEW_VERSION });
  fake.on('vault_pull', { path: 'C:\\ws\\kv-dev\\cfg.json', baseVersion: 'v2', format: 'json' });
  const notify = vi.fn();
  const openFile = vi.fn(async () => true);
  const panel = createVaultPanel(container, { invoke: fake.invoke, openFile, notify, isTauri: true });
  return { fake, panel, notify, openFile, items };
}

async function openVault(ctx, vault = 'kv-dev') {
  ctx.panel.activate();
  await settle();
  container.querySelector('.vault-input').value = vault;
  container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
}

const rowButton = (label, name) =>
  container.querySelector(`button[aria-label="${label} ${name}"]`);
const dialog = () => document.querySelector('[role="dialog"]');
const dialogButton = (text) =>
  [...dialog().querySelectorAll('button')].find((node) => node.textContent === text);
const escape = () =>
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );

describe('vault panel: the Push action', () => {
  it('offers Push next to Pull on a modified secret only', async () => {
    const ctx = setup({
      items: [item('edited', 'modified'), item('same', 'clean'), item('fresh', 'remote')],
    });
    await openVault(ctx);

    expect(rowButton('Push', 'edited')).not.toBeNull();
    expect(rowButton('Pull', 'edited')).not.toBeNull();
    expect(rowButton('Push', 'same')).toBeNull();
    expect(rowButton('Push', 'fresh')).toBeNull();
  });

  it('asks the backend for a preview and says so when there is nothing to push', async () => {
    const ctx = setup({ preview: previewOf({ changed: false }) });
    await openVault(ctx);

    rowButton('Push', 'cfg').click();
    await settle();

    expect(ctx.fake.callsOf('vault_push_preview')).toEqual([
      { command: 'vault_push_preview', args: { vault: 'kv-dev', name: 'cfg' } },
    ]);
    expect(ctx.notify).toHaveBeenCalledWith('No changes to push', 'info');
    expect(dialog()).toBeNull();
    expect(ctx.fake.callsOf('vault_push')).toHaveLength(0);
  });

  it('opens the review dialog when the preview has changes, without pushing yet', async () => {
    const ctx = setup();
    await openVault(ctx);

    rowButton('Push', 'cfg').click();
    await settle();

    expect(dialog()).not.toBeNull();
    expect(dialog().textContent).toContain('kv-dev');
    expect(dialog().textContent).toContain('cfg');
    expect(ctx.fake.callsOf('vault_push')).toHaveLength(0);
  });

  it('shows the preview in progress and ignores a second click', async () => {
    const ctx = setup();
    await openVault(ctx);
    const pending = ctx.fake.hold('vault_push_preview');
    const push = rowButton('Push', 'cfg');

    push.click();
    push.click();
    await settle();

    expect(ctx.fake.callsOf('vault_push_preview')).toHaveLength(1);
    expect(rowButton('Push', 'cfg').textContent).toBe('Checking…');
    expect(rowButton('Pull', 'cfg').disabled).toBe(true);
    pending.resolve(previewOf());
    await settle();
    expect(dialog()).not.toBeNull();
  });

  it('does not open a dialog for a preview that finishes after the panel was hidden', async () => {
    const ctx = setup();
    await openVault(ctx);
    const pending = ctx.fake.hold('vault_push_preview');
    rowButton('Push', 'cfg').click();
    await settle();

    ctx.panel.deactivate();
    pending.resolve(previewOf());
    await settle();

    expect(dialog()).toBeNull();
  });

  it('reports a preview that fails with the backend reason and opens no dialog', async () => {
    const ctx = setup();
    ctx.fake.on('vault_push_preview', () => {
      throw {
        kind: 'invalid_json',
        message: 'The working copy is not valid JSON (line 2, column 4). Fix it and try again.',
      };
    });
    await openVault(ctx);

    rowButton('Push', 'cfg').click();
    await settle();

    expect(dialog()).toBeNull();
    expect(container.querySelector('.vault-message').textContent).toContain('line 2, column 4');
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'), 'error');
    expect(rowButton('Push', 'cfg').disabled).toBe(false);
  });

  it('stores a safe diagnostic when the panel-owned preview fails', async () => {
    const ctx = setup();
    ctx.fake.on('vault_push_preview', () => {
      throw {
        kind: 'parse',
        message: 'secret-value sentinel',
        diagnostic: {
          operation: 'secret_get',
          reason: 'invalid_json',
          metadata: { line: 4, column: 2, field: 'value' },
        },
      };
    });
    await openVault(ctx);

    rowButton('Push', 'cfg').click();
    await settle();

    expect(container.querySelector('.vault-diagnostic').textContent).toContain('Secret pull');
    expect(container.querySelector('.vault-diagnostic').textContent).toContain('Invalid JSON');
    expect(container.textContent).not.toContain('secret-value sentinel');
    expect(ctx.notify).toHaveBeenCalledWith('Secret pull failed: Invalid JSON.', 'error');
  });

  it('sends the panel back to sign-in when the session ended during the preview', async () => {
    const ctx = setup();
    ctx.fake.on('vault_push_preview', () => {
      throw { kind: 'not_signed_in', message: 'raw' };
    });
    await openVault(ctx);

    rowButton('Push', 'cfg').click();
    await settle();

    expect(container.querySelector('.vault-panel').dataset.stage).toBe('signed-out');
  });
});

describe('vault panel: pushing from the dialog', () => {
  async function review(ctx) {
    await openVault(ctx);
    rowButton('Push', 'cfg').click();
    await settle();
  }

  it('pushes, tells the user the short new version and marks the secret clean', async () => {
    const ctx = setup();
    await review(ctx);

    dialogButton('Push').click();
    await settle();

    expect(ctx.fake.callsOf('vault_push')).toEqual([
      {
        command: 'vault_push',
        args: { vault: 'kv-dev', name: 'cfg', contentHash: 'hash-1', overwrite: false },
      },
    ]);
    expect(ctx.notify).toHaveBeenCalledWith('Pushed cfg (v aaaaaaaa…)', 'success');
    expect(dialog()).toBeNull();
    expect(container.querySelector('.vault-badge--clean')).not.toBeNull();
    expect(container.querySelector('.vault-badge--modified')).toBeNull();
    expect(rowButton('Push', 'cfg')).toBeNull();
  });

  it('never puts a secret value into a toast or the panel', async () => {
    const ctx = setup();
    await review(ctx);
    dialogButton('Push').click();
    await settle();

    const everything = [
      container.textContent,
      ...ctx.notify.mock.calls.map((call) => call[0]),
    ].join('\n');
    expect(everything).not.toContain('old-token-value');
    expect(everything).not.toContain('new-token-value');
  });

  it('keeps the panel locked while the dialog is open', async () => {
    const ctx = setup({ items: [item('cfg', 'modified'), item('other', 'remote')] });
    await review(ctx);

    expect(rowButton('Pull', 'other').disabled).toBe(true);
    expect(container.querySelector('.vault-load').disabled).toBe(true);

    escape();
    expect(rowButton('Pull', 'other').disabled).toBe(false);
  });

  it('returns focus to the row when the dialog is dismissed', async () => {
    const ctx = setup();
    await review(ctx);

    escape();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(rowButton('Push', 'cfg'));
    expect(ctx.fake.callsOf('vault_push')).toHaveLength(0);
  });

  it('returns focus into the list after a successful push', async () => {
    const ctx = setup();
    await review(ctx);

    dialogButton('Push').click();
    await settle();

    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(rowButton('Pull', 'cfg'));
  });

  it('Overwrite anyway after a conflicting preview pushes with overwrite set', async () => {
    const ctx = setup({
      preview: previewOf({
        remote: {
          currentVersion: 'fedcba9876543210fedcba9876543210',
          conflict: true,
          remoteText: '{"token":"remote-token-value"}',
        },
      }),
    });
    await review(ctx);

    dialogButton('Overwrite anyway').click();
    await settle();

    expect(ctx.fake.callsOf('vault_push')[0].args).toEqual({
      vault: 'kv-dev',
      name: 'cfg',
      contentHash: 'hash-1',
      overwrite: true,
    });
    expect(ctx.notify).toHaveBeenCalledWith('Pushed cfg (v aaaaaaaa…)', 'success');
  });

  it('Re-pull from a conflict goes through the modified-secret confirmation before pulling', async () => {
    const ctx = setup({
      preview: previewOf({
        remote: {
          currentVersion: 'fedcba9876543210fedcba9876543210',
          conflict: true,
          remoteText: '{"token":"remote-token-value"}',
        },
      }),
    });
    await review(ctx);

    dialogButton('Re-pull').click();
    await settle();

    expect(dialog()).toBeNull();
    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(0);
    expect(container.querySelector('.vault-confirm')).not.toBeNull();

    [...container.querySelectorAll('button')]
      .find((node) => node.textContent === 'Discard and pull')
      .click();
    await settle();
    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(1);
    expect(ctx.openFile).toHaveBeenCalledWith('C:\\ws\\kv-dev\\cfg.json');
  });

  it('keeps the row modified when the push fails', async () => {
    const ctx = setup();
    await review(ctx);
    ctx.fake.on('vault_push', () => {
      throw { kind: 'forbidden', message: 'raw' };
    });

    dialogButton('Push').click();
    await settle();

    expect(dialog()).not.toBeNull();
    expect(container.querySelector('.vault-badge--modified')).not.toBeNull();
    expect(ctx.notify).not.toHaveBeenCalledWith(expect.stringContaining('Pushed'), 'success');
  });
  describe('when the Azure session ends inside the dialog', () => {
    const signedOut = () => {
      throw { kind: 'not_signed_in', message: 'raw' };
    };
    const stage = () => container.querySelector('.vault-panel').dataset.stage;

    it('sends the panel to sign-in after a push finds the session gone', async () => {
      const ctx = setup();
      await review(ctx);
      ctx.fake.on('vault_push', signedOut);

      dialogButton('Push').click();
      await settle();

      expect(dialog()).toBeNull();
      expect(stage()).toBe('signed-out');
      expect(container.querySelector('.vault-results').hidden).toBe(true);
      expect(ctx.notify).toHaveBeenCalledWith(
        'Your Azure session has ended. Sign in again to continue.',
        'error'
      );
      expect(ctx.fake.callsOf('vault_push')).toHaveLength(1);
    });

    it('sends the panel to sign-in after Review again finds the session gone', async () => {
      const ctx = setup();
      await review(ctx);
      ctx.fake.on('vault_push', () => {
        throw { kind: 'preview_required' };
      });
      dialogButton('Push').click();
      await settle();
      ctx.fake.on('vault_push_preview', signedOut);

      dialogButton('Review again').click();
      await settle();

      expect(dialog()).toBeNull();
      expect(stage()).toBe('signed-out');
      expect(container.querySelector('.vault-results').hidden).toBe(true);
    });

    it('leaves nothing locked and offers the sign-in button', async () => {
      const ctx = setup();
      await review(ctx);
      ctx.fake.on('vault_push', signedOut);

      dialogButton('Push').click();
      await settle();

      const signIn = container.querySelector('.vault-auth__action');
      expect(signIn.hidden).toBe(false);
      expect(signIn.disabled).toBe(false);
      expect(container.querySelector('.vault-panel').getAttribute('aria-busy')).toBe('false');
    });
  });
});
