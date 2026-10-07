// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createLocalDraftStore, createTauriDraftStore } from './drafts.js';

describe('createLocalDraftStore', () => {
  it('saves, lists in id order and removes drafts', async () => {
    localStorage.clear();
    const store = createLocalDraftStore(localStorage);
    await store.save('b', 'two');
    await store.save('a', 'one');
    expect(await store.list()).toEqual([
      { id: 'a', contents: 'one' },
      { id: 'b', contents: 'two' },
    ]);
    await store.remove('a');
    expect(await store.list()).toEqual([{ id: 'b', contents: 'two' }]);
  });

  it('treats corrupt or missing storage as empty', async () => {
    localStorage.setItem('json-scout.drafts', 'not json');
    expect(await createLocalDraftStore(localStorage).list()).toEqual([]);
    expect(await createLocalDraftStore(null).list()).toEqual([]);
  });
});

describe('createTauriDraftStore', () => {
  it('maps to the draft commands', async () => {
    const invoke = vi.fn(async () => [{ id: 'a', contents: 'x' }]);
    const store = createTauriDraftStore(invoke);
    expect(await store.list()).toEqual([{ id: 'a', contents: 'x' }]);
    await store.save('a', 'y');
    await store.remove('a');
    expect(invoke.mock.calls).toEqual([
      ['drafts_list'],
      ['draft_save', { id: 'a', contents: 'y' }],
      ['draft_delete', { id: 'a' }],
    ]);
  });
});
