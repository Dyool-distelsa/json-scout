import { describe, it, expect } from 'vitest';
import {
  INITIAL_TABS,
  newTabId,
  baseName,
  nextUntitledTitle,
  activeTab,
  findTabByPath,
  addUntitled,
  openFileTab,
  activate,
  closeTab,
  markSaved,
  cycle,
} from './tabs.js';

const ids = (state) => state.tabs.map((t) => t.id);

describe('newTabId', () => {
  it('is draft-safe and sorts by creation time', () => {
    const a = newTabId(1000, () => 0.5);
    const b = newTabId(2000, () => 0.1);
    expect(a).toMatch(/^[a-z0-9-]+$/);
    expect([b, a].sort()).toEqual([a, b]);
  });
});

describe('baseName', () => {
  it('handles both separator styles', () => {
    expect(baseName('C:\\dir\\a.json')).toBe('a.json');
    expect(baseName('/tmp/b.json')).toBe('b.json');
  });
});

describe('untitled tabs', () => {
  it('numbers them with the lowest free number', () => {
    let state = addUntitled(INITIAL_TABS, 'a');
    state = addUntitled(state, 'b');
    expect(state.tabs.map((t) => t.title)).toEqual(['Untitled 1', 'Untitled 2']);
    state = closeTab(state, 'a');
    expect(nextUntitledTitle(state.tabs)).toBe('Untitled 1');
  });

  it('inserts after the active tab and activates it', () => {
    let state = addUntitled(INITIAL_TABS, 'a');
    state = addUntitled(state, 'b');
    state = activate(state, 'a');
    state = addUntitled(state, 'c');
    expect(ids(state)).toEqual(['a', 'c', 'b']);
    expect(state.activeId).toBe('c');
  });

  it('can be added in the background', () => {
    let state = addUntitled(INITIAL_TABS, 'a');
    state = addUntitled(state, 'b', { activate: false });
    expect(state.activeId).toBe('a');
  });
});

describe('file tabs', () => {
  it('reuses the tab already showing a path, regardless of case or separators', () => {
    let { state } = openFileTab(INITIAL_TABS, 'a', 'C:\\x\\Data.json');
    state = addUntitled(state, 'b');
    const again = openFileTab(state, 'c', 'c:/x/data.json');
    expect(again.existed).toBe(true);
    expect(ids(again.state)).toEqual(['a', 'b']);
    expect(again.state.activeId).toBe('a');
  });

  it('remembers tabs opened from the vault', () => {
    const { tab } = openFileTab(INITIAL_TABS, 'a', '/ws/kv/cfg.json', { fromVault: true });
    expect(tab).toMatchObject({ title: 'cfg.json', fromVault: true, dirty: false });
  });

  it('turns an untitled tab into a clean file tab once saved', () => {
    let state = addUntitled(INITIAL_TABS, 'a', { dirty: true });
    state = markSaved(state, 'a', '/tmp/out.json');
    expect(activeTab(state)).toMatchObject({ path: '/tmp/out.json', title: 'out.json', dirty: false });
    expect(findTabByPath(state, '/tmp/out.json').id).toBe('a');
  });
});

describe('closeTab', () => {
  const three = () => {
    let state = addUntitled(INITIAL_TABS, 'a');
    state = addUntitled(state, 'b');
    return addUntitled(state, 'c');
  };

  it('activates the right neighbour, or the left one for the last tab', () => {
    let state = activate(three(), 'b');
    state = closeTab(state, 'b');
    expect(state.activeId).toBe('c');
    state = closeTab(state, 'c');
    expect(state.activeId).toBe('a');
    state = closeTab(state, 'a');
    expect(state).toEqual({ tabs: [], activeId: null });
  });

  it('keeps the active tab when another one closes', () => {
    const state = closeTab(activate(three(), 'a'), 'c');
    expect(state.activeId).toBe('a');
  });
});

describe('cycle', () => {
  it('wraps around in both directions', () => {
    let state = addUntitled(INITIAL_TABS, 'a');
    state = addUntitled(state, 'b');
    expect(cycle(state, 1).activeId).toBe('a');
    expect(cycle(activate(state, 'a'), -1).activeId).toBe('b');
  });
});
