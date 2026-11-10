import { describe, expect, it, vi } from 'vitest';
import { createEditorGroups } from './editorGroups.js';

function setup(customDrafts) {
  const makeEditor = () => {
    let state = { doc: { toString: () => '' } };
    return {
      createState: (text) => ({ doc: { toString: () => text }, selection: 3, history: {} }),
      getState: () => state, setState: (next) => { state = next; },
      getContent: () => state.doc.toString(), setKind: vi.fn(),
      type: (text) => { state = { ...state, doc: { toString: () => text } }; },
    };
  };
  const editors = [makeEditor(), makeEditor()];
  const saved = new Map();
  const drafts = customDrafts ?? { list: async () => [], save: vi.fn(async (id, text) => saved.set(id, text)), remove: vi.fn(async id => saved.delete(id)) };
  const askSave = vi.fn(async () => 'cancel');
  const onActiveChange = vi.fn(); const onLayout = vi.fn();
  let n = 0;
  const docs = createEditorGroups({ editors, strips: [{ render: vi.fn() }, { render: vi.fn() }], drafts,
    askSave, saveActive: async () => { docs.markSaved('/saved.json'); return true; }, onActiveChange, onLayout,
    compareEditor: makeEditor(), onCompareChange() {}, newId: () => `tab-${++n}`,
  });
  return { docs, editors, drafts, saved, askSave, onActiveChange, onLayout };
}

describe('editor groups', () => {
  it('orders in-flight draft writes across moves and discard', async () => {
    const stored = new Map();
    let release;
    const first = new Promise(resolve => { release = resolve; });
    let writes = 0;
    const drafts = {
      list: async () => [],
      save: vi.fn(async (id, text) => { if (++writes === 1) await first; stored.set(id, text); }),
      remove: vi.fn(async id => { stored.delete(id); }),
    };
    const { docs, editors, askSave } = setup(drafts);
    docs.newUntitled('old'); const id = docs.active().id;
    const oldWrite = docs.flushDrafts();
    docs.split();
    editors[1].type('new'); docs.markEdited({ group: 1 });
    const newWrite = docs.flushDrafts();
    release(); await Promise.all([oldWrite, newWrite]);
    expect(stored.get(id)).toBe('new');
    askSave.mockResolvedValueOnce('discard');
    await docs.requestClose(id);
    await docs.flushDrafts();
    expect(stored.has(id)).toBe(false);
  });
  it('splits distinct tabs, switches independently and transfers exact editor state', () => {
    const { docs, editors } = setup();
    docs.newUntitled('one'); const one = docs.active().id;
    docs.newUntitled('two'); const two = docs.active().id;
    const original = editors[0].getState();
    docs.split();
    expect(docs.isSplit()).toBe(true);
    expect(docs.groupTabs(0).map(t => t.id)).toEqual([one]);
    expect(docs.groupTabs(1).map(t => t.id)).toEqual([two]);
    expect(editors[1].getState()).toBe(original);
    expect(editors[0].getContent()).toBe('one');
    docs.focusGroup(0); docs.newUntitled('three'); const three = docs.active().id;
    docs.activate(one);
    expect(editors[1].getContent()).toBe('two');
    docs.moveTab(three, 1, two);
    expect(docs.groupTabs(1).map(t => t.id)).toEqual([three, two]);
    expect(editors[1].getContent()).toBe('three');
    docs.activate(two); expect(editors[1].getState()).toBe(original);
    docs.join();
    expect(docs.isSplit()).toBe(false);
    expect(docs.tabs()).toHaveLength(3);
    expect(docs.active().id).toBe(two);
    expect(editors[0].getState()).toBe(original);
  });

  it('keeps per-group edits/drafts, cancel/save/close semantics and collapses an empty group', async () => {
    const { docs, editors, drafts, saved, askSave } = setup();
    docs.newUntitled('left'); const left = docs.active().id;
    docs.newUntitled('right'); const right = docs.active().id;
    docs.split();
    editors[1].type('right edited'); docs.markEdited({ group: 1 });
    await docs.flushDrafts();
    expect(saved.get(left)).toBe('left'); expect(saved.get(right)).toBe('right edited');
    expect(await docs.requestClose(right)).toBe(false);
    expect(docs.tabs()).toHaveLength(2);
    expect(editors[1].getContent()).toBe('right edited');
    askSave.mockResolvedValueOnce('save');
    expect(await docs.requestClose(right)).toBe(true);
    expect(docs.isSplit()).toBe(false);
    expect(docs.active().id).toBe(left);
    expect(editors[0].getContent()).toBe('left');
    expect(drafts.remove).toHaveBeenCalledWith(right);
    askSave.mockResolvedValueOnce('discard');
    await docs.requestClose(left);
    expect(docs.tabs()).toHaveLength(1);
    expect(editors[0].getContent()).toBe('');
  });

  it('deduplicates file opens across groups, preserves dirty text and safely joins before Diff', () => {
    const { docs, editors } = setup();
    docs.openFile('/a.json', '{"a":1}'); const a = docs.active().id;
    docs.openFile('/b.json', '{"b":1}'); const b = docs.active().id;
    docs.split();
    editors[1].type('dirty'); docs.markEdited({ group: 1 });
    docs.focusGroup(0); docs.openFile('/b.json', 'disk');
    expect(docs.tabs()).toHaveLength(2); expect(docs.active().id).toBe(b);
    expect(editors[1].getContent()).toBe('dirty');
    docs.setCompare(a);
    expect(docs.isSplit()).toBe(false);
    expect(docs.compared().id).toBe(a);
    expect(docs.active().id).toBe(b);
    expect(editors[0].getContent()).toBe('dirty');
    docs.setCompare(null);
    expect(docs.tabs()).toHaveLength(2);
  });

  it('splits a single document using a new empty tab, moves without duplicates, and scopes cycling', () => {
    const { docs, editors } = setup();
    docs.newUntitled('only'); const only = docs.active().id;
    docs.split();
    expect(docs.tabs()).toHaveLength(2);
    expect(editors[0].getContent()).toBe(''); expect(editors[1].getContent()).toBe('only');
    docs.newUntitled('another'); const another = docs.active().id;
    docs.cycle(-1); expect(docs.active().id).toBe(only);
    docs.moveTab(only, 0); expect(docs.active().id).toBe(only);
    expect(docs.groupTabs(1).map(t => t.id)).toEqual([another]);
    expect(docs.tabs().filter(t => t.id === only)).toHaveLength(1);
    docs.moveTab('missing', 1); expect(docs.tabs()).toHaveLength(3);
  });
});
