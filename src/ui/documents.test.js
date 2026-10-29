import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDocuments } from './documents.js';
import { defaultFileName } from './docKind.js';

/** An editor double: a state is `{ text }`, the shown one is mutable. */
function fakeEditor() {
  let shown = { text: '' };
  const wrap = (s) => ({ ...s, doc: { toString: () => s.text } });
  return {
    createState: (text) => ({ text }),
    getState: () => shown,
    setState: (next) => {
      shown = next;
    },
    getContent: () => shown.text,
    setKind: vi.fn(),
    type(text) {
      shown.text = text;
    },
    wrap,
  };
}

function memoryDrafts(initial = []) {
  const map = new Map(initial.map((d) => [d.id, d.contents]));
  return {
    map,
    list: vi.fn(async () => [...map].map(([id, contents]) => ({ id, contents }))),
    save: vi.fn(async (id, contents) => void map.set(id, contents)),
    remove: vi.fn(async (id) => void map.delete(id)),
  };
}

function setup({ drafts = memoryDrafts(), askSave = vi.fn(async () => 'discard'), saveActive } = {}) {
  const editor = fakeEditor();
  // The controller reads stashed states through `.doc.toString()`.
  const createState = editor.createState;
  editor.createState = (text) => editor.wrap(createState(text));
  const origGet = editor.getState;
  editor.getState = () => editor.wrap(origGet());
  let n = 0;
  const strip = { render: vi.fn() };
  const onActiveChange = vi.fn();
  const onCompareChange = vi.fn();
  // A second editor double for the compare pane, sharing state shapes.
  let compared = { text: '' };
  const compareEditor = {
    getState: () => editor.wrap(compared),
    setState: (next) => {
      compared = next;
    },
    getContent: () => compared.text,
    type(text) {
      compared.text = text;
    },
  };
  const docs = createDocuments({
    editor,
    strip,
    drafts,
    askSave,
    saveActive: saveActive ?? vi.fn(async () => true),
    onActiveChange,
    compareEditor,
    onCompareChange,
    newId: () => `id-${(n += 1)}`,
    draftDelayMs: 10,
  });
  return { docs, editor, compareEditor, drafts, askSave, onActiveChange, onCompareChange, strip };
}

const titles = (docs) => docs.tabs().map((t) => t.title);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('documents', () => {
  it('keeps original vault identity across tab switches and promotes a manually opened tab on Pull', () => {
    const { docs } = setup();
    docs.openFile('/ws/kv-prod/cfg.json', 'prod', { fromVault: true, vaultName: 'kv-prod' });
    const prod = docs.active().id;
    docs.openFile('/ws/kv-qa/cfg.json', 'qa');
    const qa = docs.active().id;
    docs.openFile('/ws/kv-qa/cfg.json', 'qa pulled', { fromVault: true, replace: true, vaultName: 'kv-qa' });
    expect(docs.active()).toMatchObject({ id: qa, fromVault: true, vaultName: 'kv-qa' });
    docs.activate(prod);
    expect(docs.active()).toMatchObject({ id: prod, vaultName: 'kv-prod' });
    docs.openFile('/ws/local.json', 'local');
    expect(docs.active().vaultName).toBeUndefined();
    expect(docs.active().fromVault).toBe(false);
  });

  it('inherits Markdown for empty new tabs and defaults their save name to .md', () => {
    const { docs } = setup();
    docs.newUntitled('', { kind: 'markdown' });
    docs.newUntitled();
    expect(docs.active().kind).toBe('markdown');
    expect(defaultFileName(docs.active().kind)).toBe('untitled.md');
  });

  it('detects the extension again when switching between saved tabs', () => {
    const { docs, onActiveChange } = setup();
    docs.openFile('/notes/readme.MD', '# Hello');
    const markdown = docs.active().id;
    docs.setActiveKind('json');
    docs.openFile('/notes/data.json', '{}');
    const json = docs.active().id;
    docs.activate(markdown);
    expect(onActiveChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'markdown' }));
    docs.markSaved('/notes/readme.json');
    docs.activate(json);
    docs.activate(markdown);
    expect(onActiveChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'json' }));
  });

  it('keeps each tab’s text when switching', () => {
    const { docs, editor } = setup();
    const first = docs.newUntitled();
    editor.type('one');
    docs.markEdited();
    docs.newUntitled();
    editor.type('two');
    docs.activate(first);
    expect(editor.getContent()).toBe('one');
    docs.cycle(1);
    expect(editor.getContent()).toBe('two');
  });

  it('writes an Untitled draft after a pause and deletes it once saved to a file', async () => {
    const { docs, editor, drafts } = setup();
    const id = docs.newUntitled();
    editor.type('{"a":1}');
    docs.markEdited();
    await vi.advanceTimersByTimeAsync(20);
    expect(drafts.map.get(id)).toBe('{"a":1}');

    docs.markSaved('C:\\out\\a.json');
    await vi.runAllTimersAsync();
    expect(drafts.map.has(id)).toBe(false);
    expect(docs.active()).toMatchObject({ path: 'C:\\out\\a.json', title: 'a.json', dirty: false });
  });

  it('replaces a pristine empty Untitled tab when a file is opened', () => {
    const { docs, editor } = setup();
    docs.newUntitled();
    docs.openFile('/x/a.json', '{}');
    expect(titles(docs)).toEqual(['a.json']);
    expect(editor.getContent()).toBe('{}');
  });

  it('reuses the tab of an already open file and reloads it unless it has edits', () => {
    const { docs, editor } = setup();
    docs.openFile('/x/a.json', 'v1');
    docs.openFile('/x/a.json', 'v2');
    expect(editor.getContent()).toBe('v2');
    editor.type('mine');
    docs.markEdited();
    docs.openFile('/x/a.json', 'v3');
    expect(editor.getContent()).toBe('mine');
    docs.openFile('/x/a.json', 'v4', { replace: true });
    expect(editor.getContent()).toBe('v4');
    expect(docs.tabs()).toHaveLength(1);
  });

  it('asks before closing unsaved work and honours cancel and save', async () => {
    const askSave = vi.fn(async () => 'cancel');
    const saveActive = vi.fn(async () => true);
    const { docs, editor } = setup({ askSave, saveActive });
    docs.openFile('/x/a.json', 'v1');
    editor.type('edited');
    docs.markEdited();

    expect(await docs.requestClose()).toBe(false);
    expect(docs.tabs()).toHaveLength(1);

    askSave.mockResolvedValueOnce('save');
    expect(await docs.requestClose()).toBe(true);
    expect(saveActive).toHaveBeenCalledTimes(1);
    // The last tab closing leaves a fresh Untitled one.
    expect(titles(docs)).toEqual(['Untitled 1']);
  });

  it('closes several tabs and stops at the first one whose close is cancelled', async () => {
    const askSave = vi.fn(async () => 'cancel');
    const { docs, editor } = setup({ askSave });
    docs.openFile('/x/a.json', 'a');
    docs.openFile('/x/b.json', 'b');
    editor.type('edited');
    docs.markEdited();
    docs.openFile('/x/c.json', 'c');
    const [a, b, c] = docs.tabs().map((t) => t.id);

    expect(await docs.closeMany([a, b, c])).toBe(false);
    expect(titles(docs)).toEqual(['b.json', 'c.json']);
    expect(askSave).toHaveBeenCalledTimes(1);

    askSave.mockResolvedValueOnce('discard');
    expect(await docs.closeMany([b, c])).toBe(true);
    expect(titles(docs)).toEqual(['Untitled 1']);
  });

  it('does not ask about an empty Untitled tab, and deletes the draft of a discarded one', async () => {
    const { docs, editor, askSave, drafts } = setup();
    const id = docs.newUntitled();
    editor.type('x');
    docs.markEdited();
    await vi.advanceTimersByTimeAsync(20);
    editor.type('');
    expect(await docs.requestClose(id)).toBe(true);
    expect(askSave).not.toHaveBeenCalled();
    expect(drafts.remove).toHaveBeenCalledWith(id);
  });

  it('restores drafts in place of the pristine startup tab', async () => {
    const drafts = memoryDrafts([
      { id: 'a', contents: 'first' },
      { id: 'b', contents: 'second' },
    ]);
    const { docs, editor } = setup({ drafts });
    docs.newUntitled();
    await docs.restore();
    expect(titles(docs)).toEqual(['Untitled 1', 'Untitled 2']);
    expect(docs.tabs().every((t) => t.dirty)).toBe(true);
    expect(editor.getContent()).toBe('first');
  });

  it('restores drafts beside a file that was already opened', async () => {
    const drafts = memoryDrafts([{ id: 'a', contents: 'draft' }]);
    const { docs, editor } = setup({ drafts });
    docs.newUntitled();
    docs.openFile('/x/a.json', 'file');
    await docs.restore();
    expect(titles(docs)).toEqual(['a.json', 'Untitled 1']);
    expect(editor.getContent()).toBe('file');
  });

  it('lists only file tabs with edits as unsaved files', () => {
    const { docs, editor } = setup();
    docs.openFile('/x/a.json', 'v1');
    editor.type('e');
    docs.markEdited();
    docs.newUntitled();
    editor.type('draft');
    docs.markEdited();
    expect(docs.unsavedFiles()).toEqual(['/x/a.json']);
  });

  it('closes vault tabs without asking', () => {
    const { docs, askSave } = setup();
    docs.openFile('/ws/kv/cfg.json', 'v', { fromVault: true });
    docs.markEdited();
    const id = docs.active().id;
    docs.forceClose(id);
    expect(askSave).not.toHaveBeenCalled();
    expect(titles(docs)).toEqual(['Untitled 1']);
  });

  describe('compare (Diff mode)', () => {
    it('shows another tab in the compare editor without changing the active one', () => {
      const { docs, editor, compareEditor, onCompareChange } = setup();
      const left = docs.newUntitled('left');
      const right = docs.newUntitled('right');
      docs.activate(left);
      docs.setCompare(right);
      expect(docs.active().id).toBe(left);
      expect(docs.compared().id).toBe(right);
      expect(editor.getContent()).toBe('left');
      expect(compareEditor.getContent()).toBe('right');
      expect(onCompareChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: right }));
    });

    it('opens a new Untitled tab straight into the compare pane', () => {
      const { docs, editor, compareEditor } = setup();
      docs.openFile('/x/a.json', 'file');
      docs.newUntitled('', { compare: true });
      expect(docs.active().title).toBe('a.json');
      expect(docs.compared().title).toBe('Untitled 1');
      expect(editor.getContent()).toBe('file');
      expect(compareEditor.getContent()).toBe('');
    });

    it('opens a file into the compare pane, but not the active file itself', () => {
      const { docs, compareEditor } = setup();
      docs.openFile('/x/a.json', 'a');
      expect(docs.openFile('/x/b.json', 'b', { compare: true })).toBe(true);
      expect(compareEditor.getContent()).toBe('b');
      expect(docs.active().title).toBe('a.json');
      expect(docs.openFile('/x/a.json', 'a', { compare: true })).toBe(false);
    });

    it('marks edits in the compare pane on the compared tab and keeps its text', async () => {
      const { docs, compareEditor, drafts } = setup();
      docs.newUntitled('main');
      const id = docs.newUntitled('', { compare: true });
      compareEditor.type('typed');
      docs.markEdited({ compare: true });
      await vi.advanceTimersByTimeAsync(20);
      expect(docs.compared().dirty).toBe(true);
      expect(docs.active().dirty).toBe(true);
      expect(drafts.map.get(id)).toBe('typed');
    });

    it('swaps the panes when the compared tab is activated', () => {
      const { docs, editor, compareEditor } = setup();
      const left = docs.newUntitled('left');
      const right = docs.newUntitled('right');
      docs.activate(left);
      docs.setCompare(right);
      docs.activate(right);
      expect(editor.getContent()).toBe('right');
      expect(compareEditor.getContent()).toBe('left');
      expect(docs.compared().id).toBe(left);
    });

    it('keeps a tab’s text when it leaves the compare pane', () => {
      const { docs, editor, compareEditor } = setup();
      const left = docs.newUntitled('left');
      const right = docs.newUntitled('right');
      docs.activate(left);
      docs.setCompare(right);
      compareEditor.type('right edited');
      docs.setCompare(null);
      expect(docs.compared()).toBeNull();
      docs.activate(right);
      expect(editor.getContent()).toBe('right edited');
    });

    it('leaves Diff mode when the compared tab is closed', () => {
      const { docs, onCompareChange } = setup();
      docs.newUntitled('left');
      const right = docs.newUntitled('', { compare: true });
      docs.forceClose(right);
      expect(docs.compared()).toBeNull();
      expect(onCompareChange).toHaveBeenLastCalledWith(null);
    });

    it('moves the compared tab into the main editor when the active one closes next to it', () => {
      const { docs, editor } = setup();
      const left = docs.newUntitled('left');
      docs.newUntitled('right', { compare: true });
      docs.forceClose(left);
      expect(editor.getContent()).toBe('right');
      expect(docs.compared()).toBeNull();
      expect(docs.tabs()).toHaveLength(1);
    });
  });
});
