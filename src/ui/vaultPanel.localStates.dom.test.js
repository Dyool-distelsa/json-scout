// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultPanel } from './vaultPanel.js';
import { createFakeInvoke, settle } from './testing/fakeBackend.js';

const IDENTITY = { user: 'ana@example.com', subscription: 'Dev' };
const item = (name, localState = 'remote') => ({ name, enabled: true, localState });

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

/**
 * `changes` is what `vault_local_changes` answers right now (a test reassigns it
 * to simulate editing and saving, or restoring, a pulled file).
 */
function setup({ items = [item('cfg', 'clean'), item('fresh', 'remote')] } = {}) {
  const fake = createFakeInvoke();
  const ctx = { changes: [] };
  fake.on('vault_status', IDENTITY);
  fake.on('vault_list', () => items.map((entry) => ({ ...entry })));
  fake.on('vault_local_changes', () => ctx.changes.map((change) => ({ ...change })));
  fake.on('vault_pull', { path: 'C:\\ws\\kv-dev\\cfg.json', baseVersion: 'v2', format: 'json' });
  fake.on('vault_push_preview', {
    changed: true,
    format: 'json',
    baseVersion: 'v1',
    baseText: '{"a":1}',
    workingText: '{"a":2}',
    remote: { currentVersion: 'v1', conflict: false, remoteText: null },
    environment: 'dev',
    contentHash: 'hash-1',
  });
  fake.on('vault_push', { newVersion: 'v3' });
  const notify = vi.fn();
  const openFile = vi.fn(async () => true);
  const panel = createVaultPanel(container, { invoke: fake.invoke, openFile, notify, isTauri: true });
  return Object.assign(ctx, { fake, panel, notify, openFile });
}

async function openVault(ctx, vault = 'kv-dev') {
  ctx.panel.activate();
  await settle();
  container.querySelector('.vault-input').value = vault;
  container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
}

const rowButton = (label, name) => container.querySelector(`button[aria-label="${label} ${name}"]`);
const badgeOf = (name) =>
  [...container.querySelectorAll('.vault-row')]
    .find((row) => row.querySelector('.vault-row__name').textContent === name)
    ?.querySelector('.vault-badge').textContent;
const localChangeCalls = (ctx) => ctx.fake.callsOf('vault_local_changes');

describe('vault panel: refreshLocalStates', () => {
  it('shows Push on a pulled row once a saved edit makes it modified, without a Load', async () => {
    const ctx = setup();
    await openVault(ctx);
    expect(rowButton('Push', 'cfg')).toBeNull();

    ctx.changes = [{ vault: 'kv-dev', name: 'cfg' }];
    await ctx.panel.refreshLocalStates();

    expect(rowButton('Push', 'cfg')).not.toBeNull();
    expect(badgeOf('cfg')).toBe('modified');
    expect(ctx.fake.callsOf('vault_list')).toHaveLength(1);
  });

  it('takes Push away again when the saved content is back to the base', async () => {
    const ctx = setup();
    await openVault(ctx);
    ctx.changes = [{ vault: 'kv-dev', name: 'cfg' }];
    await ctx.panel.refreshLocalStates();
    expect(rowButton('Push', 'cfg')).not.toBeNull();

    ctx.changes = [];
    await ctx.panel.refreshLocalStates();

    expect(rowButton('Push', 'cfg')).toBeNull();
    expect(badgeOf('cfg')).toBe('clean');
  });

  it('never touches a remote row, and ignores changes that belong to another vault', async () => {
    const ctx = setup();
    await openVault(ctx);
    ctx.changes = [
      { vault: 'kv-dev', name: 'fresh' },
      { vault: 'kv-other', name: 'cfg' },
    ];
    await ctx.panel.refreshLocalStates();

    expect(badgeOf('fresh')).toBe('remote');
    expect(badgeOf('cfg')).toBe('clean');
    expect(rowButton('Push', 'fresh')).toBeNull();
    expect(rowButton('Push', 'cfg')).toBeNull();
  });

  it('is skipped while the panel is hidden', async () => {
    const ctx = setup();
    await openVault(ctx);
    ctx.panel.deactivate();
    ctx.changes = [{ vault: 'kv-dev', name: 'cfg' }];

    await ctx.panel.refreshLocalStates();

    expect(localChangeCalls(ctx)).toHaveLength(0);
  });

  it('is skipped before a vault is loaded and while signed out', async () => {
    const ctx = setup();
    await ctx.panel.refreshLocalStates();
    ctx.panel.activate();
    await settle();
    await ctx.panel.refreshLocalStates();
    expect(localChangeCalls(ctx)).toHaveLength(0);

    const signedOut = setup();
    signedOut.fake.on('vault_status', () => {
      throw { kind: 'not_signed_in', message: 'Not signed in' };
    });
    signedOut.panel.activate();
    await settle();
    await signedOut.panel.refreshLocalStates();
    expect(localChangeCalls(signedOut)).toHaveLength(0);
  });

  it('never lists the vault: it reads the local disk only', async () => {
    const ctx = setup();
    await openVault(ctx);
    const listsBefore = ctx.fake.callsOf('vault_list').length;
    await ctx.panel.refreshLocalStates();
    expect(ctx.fake.callsOf('vault_list')).toHaveLength(listsBefore);
  });

  it('coalesces concurrent refreshes into the running one plus a single follow-up', async () => {
    const ctx = setup();
    await openVault(ctx);
    const first = ctx.fake.hold('vault_local_changes');

    const runs = [ctx.panel.refreshLocalStates(), ctx.panel.refreshLocalStates(), ctx.panel.refreshLocalStates()];
    await settle();
    expect(localChangeCalls(ctx)).toHaveLength(1);

    ctx.changes = [{ vault: 'kv-dev', name: 'cfg' }];
    first.resolve([]);
    await Promise.all(runs);

    // One call in flight, three requests: the running one and exactly one more.
    expect(localChangeCalls(ctx)).toHaveLength(2);
    expect(rowButton('Push', 'cfg')).not.toBeNull();
  });

  it('drops a result that predates a newer listing and asks again', async () => {
    const ctx = setup();
    await openVault(ctx);
    const stale = ctx.fake.hold('vault_local_changes');
    const run = ctx.panel.refreshLocalStates();
    await settle();

    // A Load finishes while the disk read is still pending.
    container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    stale.resolve([{ vault: 'kv-dev', name: 'cfg' }]);
    await run;

    expect(localChangeCalls(ctx)).toHaveLength(2);
    expect(rowButton('Push', 'cfg')).toBeNull();
    expect(badgeOf('cfg')).toBe('clean');
  });

  it('keeps the rows and stays quiet when the disk read fails', async () => {
    const ctx = setup();
    await openVault(ctx);
    ctx.fake.on('vault_local_changes', () => {
      throw { kind: 'io', message: 'disk unavailable' };
    });
    await ctx.panel.refreshLocalStates();

    expect(badgeOf('cfg')).toBe('clean');
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it('keeps focus on the same control when a refresh re-renders the rows', async () => {
    const ctx = setup();
    await openVault(ctx);
    rowButton('Pull', 'cfg').focus();
    ctx.changes = [{ vault: 'kv-dev', name: 'cfg' }];
    await ctx.panel.refreshLocalStates();

    expect(document.activeElement).toBe(rowButton('Pull', 'cfg'));
  });

  it('does not re-render when nothing changed', async () => {
    const ctx = setup();
    await openVault(ctx);
    const row = container.querySelector('.vault-row');
    await ctx.panel.refreshLocalStates();
    expect(container.querySelector('.vault-row')).toBe(row);
  });
});

describe('vault panel: automatic local-state refresh', () => {
  it('refreshes when the tab is shown again', async () => {
    const ctx = setup();
    await openVault(ctx);
    ctx.panel.deactivate();
    ctx.changes = [{ vault: 'kv-dev', name: 'cfg' }];

    ctx.panel.activate();
    await settle();

    expect(localChangeCalls(ctx)).toHaveLength(1);
    expect(rowButton('Push', 'cfg')).not.toBeNull();
  });

  it('refreshes after a pull completes', async () => {
    const ctx = setup({ items: [item('fresh', 'remote')] });
    await openVault(ctx);
    rowButton('Pull', 'fresh').click();
    await settle();

    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(1);
    expect(localChangeCalls(ctx).length).toBeGreaterThanOrEqual(1);
  });

  it('refreshes after a push completes', async () => {
    const ctx = setup({ items: [item('cfg', 'modified')] });
    await openVault(ctx);
    rowButton('Push', 'cfg').click();
    await settle();
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(
      (node) => node.textContent === 'Push'
    );
    expect(confirm).toBeDefined();
    confirm.click();
    await settle();

    expect(ctx.fake.callsOf('vault_push')).toHaveLength(1);
    expect(localChangeCalls(ctx).length).toBeGreaterThanOrEqual(1);
    expect(rowButton('Push', 'cfg')).toBeNull();
  });
});
