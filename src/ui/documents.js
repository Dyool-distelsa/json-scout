import {
  INITIAL_TABS,
  newTabId,
  activeTab,
  findTab,
  addUntitled,
  openFileTab,
  activate,
  closeTab,
  updateTab,
  markSaved,
  cycle,
} from './tabs.js';

/** Quiet time after the last keystroke before an Untitled draft is written. */
export const DRAFT_DELAY_MS = 500;

/**
 * The open documents: one editor view, one document state per tab (each keeps
 * its own undo history and selection), and Untitled text mirrored to the draft
 * store so it survives closing the app.
 *
 * @param {{
 *   editor: { createState: (text: string) => any, getState: () => any,
 *     setState: (state: any) => void, getContent: () => string },
 *   strip: { render: (state: import('./tabs.js').TabsState) => void },
 *   drafts: import('./drafts.js').DraftStore,
 *   askSave: (tab: import('./tabs.js').Tab) => Promise<'save'|'discard'|'cancel'>,
 *   saveActive: () => Promise<boolean>,
 *   onActiveChange: (tab: import('./tabs.js').Tab) => void,
 *   onError?: (message: string) => void,
 *   newId?: () => string,
 *   draftDelayMs?: number,
 * }} deps
 *   `saveActive` saves the active tab (asking for a path when it has none)
 *   and resolves whether it was saved.
 */
export function createDocuments({
  editor,
  strip,
  drafts,
  askSave,
  saveActive,
  onActiveChange,
  onError,
  newId = () => newTabId(),
  draftDelayMs = DRAFT_DELAY_MS,
}) {
  let state = INITIAL_TABS;
  /** Document states of the tabs that are not shown. */
  const stashed = new Map();
  const pendingDrafts = new Set();
  let draftTimer = null;
  let draftErrorShown = false;

  function render() {
    strip.render(state);
  }

  function textOf(id) {
    if (id === state.activeId) return editor.getContent();
    return stashed.get(id)?.doc.toString() ?? '';
  }

  /** Show `id` in the editor, stashing what was shown unless it is gone. */
  function show(id) {
    const previous = state.activeId;
    if (previous === id && !stashed.has(id)) {
      render();
      return;
    }
    if (previous !== null && previous !== id && findTab(state, previous)) {
      stashed.set(previous, editor.getState());
    }
    state = activate(state, id);
    const next = stashed.get(id);
    if (next) {
      stashed.delete(id);
      editor.setState(next);
    }
    render();
    onActiveChange(activeTab(state));
  }

  function isPristineUntitled(tab) {
    return tab && tab.path === null && !tab.dirty && textOf(tab.id) === '';
  }

  /** Remove a tab without asking. Keeps at least one tab open. */
  function drop(id) {
    const tab = findTab(state, id);
    if (!tab) return;
    if (tab.path === null) forgetDraft(id);
    const wasActive = state.activeId === id;
    state = closeTab(state, id);
    stashed.delete(id);
    if (state.tabs.length === 0) {
      newUntitled();
      return;
    }
    if (wasActive) show(state.activeId);
    else render();
  }

  function forgetDraft(id) {
    pendingDrafts.delete(id);
    drafts.remove(id).catch(() => {});
  }

  function scheduleDraft(id) {
    pendingDrafts.add(id);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      flushDrafts();
    }, draftDelayMs);
  }

  /** Write every pending Untitled draft now. An empty one is deleted instead. */
  async function flushDrafts() {
    clearTimeout(draftTimer);
    draftTimer = null;
    const ids = [...pendingDrafts];
    pendingDrafts.clear();
    await Promise.all(
      ids.map(async (id) => {
        const tab = findTab(state, id);
        if (!tab || tab.path !== null) return;
        const text = textOf(id);
        try {
          if (text === '') await drafts.remove(id);
          else await drafts.save(id, text);
          draftErrorShown = false;
        } catch (err) {
          if (!draftErrorShown) {
            draftErrorShown = true;
            onError?.(`Could not keep a recoverable copy of ${tab.title}: ${err}`);
          }
        }
      })
    );
  }

  /**
   * Open a new Untitled tab.
   * @param {string} [text]
   */
  function newUntitled(text = '') {
    const id = newId();
    const current = state.activeId;
    if (current !== null) stashed.set(current, editor.getState());
    state = addUntitled(state, id, { dirty: text !== '' });
    editor.setState(editor.createState(text));
    render();
    onActiveChange(activeTab(state));
    if (text !== '') scheduleDraft(id);
    return id;
  }

  /**
   * Show a file's contents in its own tab (reusing the tab already showing that
   * path). A reused tab gets the new contents unless it has unsaved edits;
   * `replace` forces it (a vault pull the user already confirmed). A pristine
   * empty Untitled tab that was active is closed, as Notepad does.
   * @param {string} path
   * @param {string} contents
   * @param {{ fromVault?: boolean, replace?: boolean }} [options]
   */
  function openFile(path, contents, { fromVault = false, replace = false } = {}) {
    const before = activeTab(state);
    const opened = openFileTab(state, newId(), path, { fromVault });
    const { tab, existed } = opened;
    if (existed) {
      if (!tab.dirty || replace) {
        if (state.activeId === tab.id) {
          editor.setState(editor.createState(contents));
        } else {
          stashed.set(tab.id, editor.createState(contents));
        }
        state = updateTab(state, tab.id, { dirty: false, fromVault: tab.fromVault || fromVault });
      }
      if (state.activeId === tab.id) {
        render();
        onActiveChange(activeTab(state));
      } else {
        show(tab.id);
      }
      return;
    }
    if (before) stashed.set(before.id, editor.getState());
    state = opened.state;
    editor.setState(editor.createState(contents));
    if (isPristineUntitled(before)) {
      // Its state is the empty doc just stashed; no draft exists for it.
      state = closeTab(state, before.id);
      state = activate(state, tab.id);
      stashed.delete(before.id);
    }
    render();
    onActiveChange(activeTab(state));
  }

  /** The active document changed through the editor. */
  function markEdited() {
    const tab = activeTab(state);
    if (!tab) return;
    if (!tab.dirty) {
      state = updateTab(state, tab.id, { dirty: true });
      render();
    }
    if (tab.path === null) scheduleDraft(tab.id);
  }

  /**
   * Close a tab, asking first when unsaved work would be lost.
   * @returns {Promise<boolean>} whether it was closed
   */
  async function requestClose(id = state.activeId) {
    const tab = findTab(state, id);
    if (!tab) return false;
    const loses = tab.dirty && (tab.path !== null || textOf(id) !== '');
    if (loses) {
      const choice = await askSave(tab);
      if (choice === 'cancel') return false;
      if (choice === 'save') {
        show(id);
        if (!(await saveActive())) return false;
      }
    }
    drop(id);
    return true;
  }

  /**
   * Restore the drafts of the last run as Untitled tabs. A pristine empty tab
   * opened meanwhile gives way to them.
   */
  async function restore() {
    let saved = [];
    try {
      saved = await drafts.list();
    } catch (err) {
      onError?.(`Could not restore unsaved documents: ${err}`);
      return;
    }
    const usable = saved.filter((d) => typeof d?.id === 'string' && typeof d.contents === 'string');
    if (usable.length === 0) return;
    const placeholder = activeTab(state);
    const replacePlaceholder = state.tabs.length === 1 && isPristineUntitled(placeholder);
    if (state.activeId !== null) stashed.set(state.activeId, editor.getState());
    for (const draft of usable) {
      if (findTab(state, draft.id)) continue;
      state = addUntitled(state, draft.id, { dirty: true, activate: false, atEnd: true });
      stashed.set(draft.id, editor.createState(draft.contents));
    }
    if (replacePlaceholder) {
      state = closeTab(state, placeholder.id);
      stashed.delete(placeholder.id);
      // Re-number from 1 now that the placeholder is gone.
      const restored = state.tabs.map((t, i) => ({ ...t, title: `Untitled ${i + 1}` }));
      state = { tabs: restored, activeId: null };
      show(restored[0].id);
      return;
    }
    // Keep showing what was shown.
    const current = state.activeId;
    stashed.delete(current);
    render();
  }

  return {
    newUntitled,
    openFile,
    markEdited,
    requestClose,
    restore,
    flushDrafts,
    /** Close without asking (the file is gone). */
    forceClose: drop,
    activate: (id) => {
      if (findTab(state, id)) show(id);
    },
    cycle: (step) => {
      const next = cycle(state, step);
      if (next.activeId !== state.activeId) show(next.activeId);
    },
    /** The active tab was saved to `path`. */
    markSaved(path) {
      const tab = activeTab(state);
      if (!tab) return;
      if (tab.path === null) forgetDraft(tab.id);
      state = markSaved(state, tab.id, path);
      render();
      onActiveChange(activeTab(state));
    },
    active: () => activeTab(state),
    tabs: () => state.tabs,
    /** Files (not Untitled drafts, which are kept) whose edits would be lost. */
    unsavedFiles: () => state.tabs.filter((t) => t.path !== null && t.dirty).map((t) => t.path),
  };
}
