import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDocuments } from './documents.js';

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
  const docs = createDocuments({
    editor,
    strip,
    drafts,
    askSave,
    saveActive: saveActive ?? vi.fn(async () => true),
    onActiveChange,
    newId: () => `id-${(n += 1)}`,
    draftDelayMs: 10,
  });
  return { docs, editor, drafts, askSave, onActiveChange, strip };
}

const titles = (docs) => docs.tabs().map((t) => t.title);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('documents', () => {
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
});
