// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVaultPanel } from './vaultPanel.js';
import { createDocuments } from './documents.js';
import { createTabStrip } from './tabStrip.js';
import { createFakeInvoke, settle } from './testing/fakeBackend.js';

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

it('resets the panel before Load while retaining pulled tabs with their original environment', async () => {
  document.body.innerHTML = '<div id="panel"></div><div id="tabs"></div>';
  const fake = createFakeInvoke();
  fake.on('vault_status', { user: 'test@example.invalid', subscription: 'Test' });
  fake.on('vault_list', ({ vault }) => [{ name: `${vault}-config`, enabled: true, localState: 'remote' }]);
  fake.on('vault_pull', ({ vault }) => ({ path: `/test/${vault}/config.json` }));
  let shown = { doc: { toString: () => '' } };
  const docs = createDocuments({
    editor: {
      createState: (text) => ({ doc: { toString: () => text } }),
      getState: () => shown, setState: (value) => { shown = value; },
      getContent: () => shown.doc.toString(), setKind() {},
    },
    strip: createTabStrip(document.querySelector('#tabs'), { onActivate() {}, onClose() {}, onNew() {} }),
    drafts: { list: async () => [], save: async () => {}, remove: async () => {} },
    askSave: async () => 'cancel', saveActive: async () => false, onActiveChange() {},
  });
  docs.openFile('/test/local.json', '{}');
  const onCleared = vi.fn(() => {
    for (const tab of docs.tabs().filter(t => t.fromVault)) docs.forceClose(tab.id);
  });
  const container = document.querySelector('#panel');
  const panel = createVaultPanel(container, {
    invoke: fake.invoke, isTauri: true, notify() {}, onCleared,
    openFile: async (path, origin) => docs.openFile(path, '{}', { fromVault: true, ...origin }),
  });
  const load = (vault) => {
    container.querySelector('input').value = vault;
    container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  };
  panel.activate(); await settle();
  load('kv-prod'); await settle();
  container.querySelector('button[aria-label="Pull kv-prod-config"]').click(); await settle();
  const search = container.querySelector('input[type="search"]');
  search.value = 'prod'; search.dispatchEvent(new Event('input'));
  const pending = fake.hold('vault_list');
  load('kv-qa');
  expect(search.value).toBe('');
  expect(container.querySelector('.vault-list').children).toHaveLength(0);
  expect(container.querySelector('.vault-results').hidden).toBe(true);
  expect(docs.tabs()).toHaveLength(2);
  expect(fake.callsOf('vault_clean')).toHaveLength(0);
  expect(onCleared).not.toHaveBeenCalled();
  pending.resolve([{ name: 'qa-config', enabled: true, localState: 'remote' }]); await settle();
  expect(container.querySelector('.vault-summary').textContent).toBe('kv-qa · 1 secret');
  expect(container.querySelector('button[aria-label="Pull qa-config"]')).not.toBeNull();
  container.querySelector('button[aria-label="Pull qa-config"]').click(); await settle();
  expect(docs.tabs().map(t => t.vaultName ?? null)).toEqual([null, 'kv-prod', 'kv-qa']);
  const tabs = [...document.querySelectorAll('.doc-tab')];
  expect(tabs.map(t => t.dataset.vaultEnvironment ?? null)).toEqual([null, 'prod', 'qa']);
  expect(tabs[1].textContent).toContain('PROD');
  expect(tabs[1].title).toContain('kv-prod');
  expect(tabs[2].textContent).toContain('QA');
  expect(fake.callsOf('vault_clean')).toHaveLength(0);
  expect(onCleared).not.toHaveBeenCalled();
});
