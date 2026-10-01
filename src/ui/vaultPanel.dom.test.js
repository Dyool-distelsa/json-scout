// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultPanel } from './vaultPanel.js';
import { createFakeInvoke, settle } from './testing/fakeBackend.js';

const IDENTITY = { user: 'ana@example.com', subscription: 'Dev' };
const PULL_RESULT = { path: 'C:\\ws\\kv\\cfg.json', baseVersion: 'v1', format: 'json' };
const item = (name, localState = 'remote') => ({ name, enabled: true, localState });

let container;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  document.body.replaceChildren();
});

/** A panel wired to a fake backend that is signed in. */
function setup({ items = [], openFile = vi.fn(async () => true) } = {}) {
  const fake = createFakeInvoke();
  fake.on('vault_status', IDENTITY);
  fake.on('vault_list', () => items);
  fake.on('vault_pull', PULL_RESULT);
  const notify = vi.fn();
  const panel = createVaultPanel(container, {
    invoke: fake.invoke,
    openFile,
    notify,
    isTauri: true,
  });
  return { fake, panel, notify, openFile };
}

/** Activate, wait for the sign-in check and load `vault`. */
async function openVault({ fake, panel }, vault = 'kv-dev') {
  panel.activate();
  await settle();
  submitVaultName(vault);
  await settle();
  expect(fake.callsOf('vault_list').length).toBeGreaterThan(0);
}

function submitVaultName(vault) {
  container.querySelector('.vault-input').value = vault;
  container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
}

const pullButton = (name) => container.querySelector(`button[aria-label="Pull ${name}"]`);
const confirmBox = () => container.querySelector('.vault-confirm');
const buttonByText = (text) =>
  [...container.querySelectorAll('button')].find((node) => node.textContent === text);

describe('vault panel: pull over local edits', () => {
  it('asks before pulling a modified secret and does not call vault_pull until confirmed', async () => {
    const ctx = setup({ items: [item('cfg', 'modified')] });
    await openVault(ctx);

    pullButton('cfg').click();
    await settle();

    expect(confirmBox()).not.toBeNull();
    expect(confirmBox().textContent).toContain('Discard local edits?');
    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(0);

    buttonByText('Discard and pull').click();
    await settle();

    expect(ctx.fake.callsOf('vault_pull')).toEqual([
      { command: 'vault_pull', args: { vault: 'kv-dev', name: 'cfg' } },
    ]);
    expect(ctx.openFile).toHaveBeenCalledWith('C:\\ws\\kv\\cfg.json');
  });

  it('cancelling the confirmation pulls nothing and puts the row back', async () => {
    const ctx = setup({ items: [item('cfg', 'modified')] });
    await openVault(ctx);
    pullButton('cfg').click();

    buttonByText('Cancel').click();

    expect(confirmBox()).toBeNull();
    expect(pullButton('cfg').hidden).toBe(false);
    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(0);
  });

  it('re-lists a clean row first and asks when the re-list says it was edited meanwhile', async () => {
    const ctx = setup({ items: [item('cfg', 'clean')] });
    await openVault(ctx);
    // The file was edited and saved after the listing was loaded.
    ctx.fake.on('vault_list', () => [item('cfg', 'modified')]);

    pullButton('cfg').click();
    await settle();

    expect(ctx.fake.callsOf('vault_list')).toHaveLength(2);
    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(0);
    expect(confirmBox()).not.toBeNull();
  });

  it('pulls a clean row straight away when the re-list confirms it is still clean', async () => {
    const ctx = setup({ items: [item('cfg', 'clean')] });
    await openVault(ctx);

    pullButton('cfg').click();
    await settle();

    expect(ctx.fake.callsOf('vault_list')).toHaveLength(2);
    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(1);
    expect(confirmBox()).toBeNull();
  });
});

describe('vault panel: busy guards', () => {
  it('ignores a second confirmed pull while one is in flight', async () => {
    const ctx = setup({ items: [item('cfg', 'modified')] });
    await openVault(ctx);
    const pending = ctx.fake.hold('vault_pull');
    pullButton('cfg').click();
    const discard = buttonByText('Discard and pull');

    discard.click();
    discard.click(); // a stale handler firing again while the first pull runs
    await settle();

    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(1);
    pending.resolve(PULL_RESULT);
    await settle();
  });

  it('does not open a confirmation for another row while a pull is in flight', async () => {
    const ctx = setup({ items: [item('one', 'remote'), item('two', 'modified')] });
    await openVault(ctx);
    const stalePullTwo = pullButton('two');
    const pending = ctx.fake.hold('vault_pull');
    pullButton('one').click();
    await settle();

    stalePullTwo.click();

    expect(confirmBox()).toBeNull();
    pending.resolve(PULL_RESULT);
    await settle();
  });

  it('disables the pull actions while a pull runs', async () => {
    const ctx = setup({ items: [item('one', 'remote'), item('two', 'remote')] });
    await openVault(ctx);
    const pending = ctx.fake.hold('vault_pull');

    pullButton('one').click();
    await settle();

    expect(pullButton('one').textContent).toBe('Pulling…');
    expect(pullButton('two').disabled).toBe(true);
    pending.resolve(PULL_RESULT);
    await settle();
    expect(pullButton('two').disabled).toBe(false);
  });

  it('ignores a second load while one is in flight', async () => {
    const ctx = setup({ items: [item('cfg')] });
    ctx.panel.activate();
    await settle();
    const pending = ctx.fake.hold('vault_list');

    submitVaultName('kv-dev');
    submitVaultName('kv-dev');
    await settle();

    expect(ctx.fake.callsOf('vault_list')).toHaveLength(1);
    pending.resolve([item('cfg')]);
    await settle();
  });
});

describe('vault panel: lifecycle', () => {
  it('issues no calls until it is activated', async () => {
    const ctx = setup();
    await settle();
    expect(ctx.fake.calls).toHaveLength(0);
  });

  it('checks the session once on activation and not again while it is ready', async () => {
    const ctx = setup();
    ctx.panel.activate();
    ctx.panel.activate();
    await settle();
    expect(ctx.fake.callsOf('vault_status')).toHaveLength(1);

    ctx.panel.deactivate();
    ctx.panel.activate();
    await settle();
    expect(ctx.fake.callsOf('vault_status')).toHaveLength(1);
  });

  it('discards a session check that finishes after the panel was hidden', async () => {
    const ctx = setup();
    const pending = ctx.fake.hold('vault_status');
    ctx.panel.activate();
    await settle();
    ctx.panel.deactivate();

    pending.resolve(IDENTITY);
    await settle();

    // The stale answer must not turn the panel "ready" behind the user's back.
    expect(container.querySelector('.vault-panel').dataset.stage).toBe('checking');
    expect(container.querySelector('form').hidden).toBe(true);

    ctx.panel.activate();
    await settle();
    expect(ctx.fake.callsOf('vault_status')).toHaveLength(2);
    expect(container.querySelector('form').hidden).toBe(false);
  });

  it('does not fetch or open a clean secret when the panel was hidden during the re-list', async () => {
    const ctx = setup({ items: [item('cfg', 'clean')] });
    await openVault(ctx);
    const pending = ctx.fake.hold('vault_list');

    pullButton('cfg').click();
    await settle();
    ctx.panel.deactivate();
    pending.resolve([item('cfg', 'clean')]);
    await settle();

    expect(ctx.fake.callsOf('vault_pull')).toHaveLength(0);
    expect(ctx.openFile).not.toHaveBeenCalled();
  });

  it('closes an open confirmation when the panel is hidden', async () => {
    const ctx = setup({ items: [item('cfg', 'modified')] });
    await openVault(ctx);
    pullButton('cfg').click();
    expect(confirmBox()).not.toBeNull();

    ctx.panel.deactivate();

    expect(confirmBox()).toBeNull();
  });
});

describe('vault panel: the openFile contract', () => {
  async function pulled(openFile) {
    const ctx = setup({ items: [item('cfg', 'remote')], openFile });
    await openVault(ctx);
    pullButton('cfg').click();
    await settle();
    return ctx;
  }
  const successToasts = (notify) => notify.mock.calls.filter(([, kind]) => kind === 'success');

  it('announces success when the file was opened', async () => {
    const { notify } = await pulled(vi.fn(async () => true));
    expect(successToasts(notify)).toEqual([['Pulled "cfg" from kv-dev.', 'success']]);
  });

  it('announces success for an opener that returns nothing', async () => {
    const { notify } = await pulled(vi.fn(async () => undefined));
    expect(successToasts(notify)).toHaveLength(1);
  });

  it('stays silent when the file could not be opened (the opener reported why)', async () => {
    const { notify } = await pulled(vi.fn(async () => false));
    expect(successToasts(notify)).toHaveLength(0);
  });

  it('marks the row clean even when the editor could not open the file', async () => {
    await pulled(vi.fn(async () => false));
    expect(container.querySelector('.vault-badge--clean')).not.toBeNull();
  });
});
