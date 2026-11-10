import { createDocuments } from './documents.js';

/** Coordinate at most two independent document collections. */
export function createEditorGroups({ editors, strips, onActiveChange, onLayout = () => {}, ...deps }) {
  let focused = 0;
  let split = false;
  let transferring = false;
  // Every operation for an id is serialized across both owners. In particular,
  // an old in-flight write must finish before a moved draft is saved or removed.
  const pending = new Map();
  function enqueue(id, operation) {
    const previous = pending.get(id);
    const next = previous ? previous.catch(() => {}).then(operation) : Promise.resolve().then(operation);
    pending.set(id, next);
    next.finally(() => { if (pending.get(id) === next) pending.delete(id); }).catch(() => {});
    return next;
  }
  const drafts = {
    list: () => deps.drafts.list(),
    save: (id, text) => enqueue(id, () => deps.drafts.save(id, text)),
    remove: (id) => enqueue(id, () => deps.drafts.remove(id)),
  };
  const groups = editors.map((editor, index) => createDocuments({
    ...deps, drafts, editor, strip: strips[index], keepEmpty: true,
    onActiveChange: (tab) => {
      if (!transferring && index === focused) onActiveChange?.(tab);
    },
  }));
  const current = () => groups[focused];
  const owner = (id) => groups.findIndex((group) => group.tabs().some((tab) => tab.id === id));
  function focusGroup(index) {
    if (index !== 0 && (!split || index !== 1)) return;
    focused = index;
    onActiveChange?.(current().active());
  }
  function join() {
    if (!split) return;
    const active = current().active()?.id;
    transferring = true;
    for (const tab of [...groups[1].tabs()]) groups[0].adopt(groups[1].take(tab.id));
    if (active) groups[0].activate(active);
    focused = 0;
    split = false;
    transferring = false;
    onLayout(false);
    onActiveChange?.(current().active());
  }
  function moveTab(id, target, before = null) {
    const source = owner(id);
    if (source < 0 || !split || (target !== 0 && target !== 1)) return;
    if (source === target) {
      groups[target].reorder(id, before);
      return;
    }
    transferring = true;
    const transfer = groups[source].take(id);
    groups[target].adopt(transfer, before);
    focused = target;
    transferring = false;
    if (!groups[source].tabs().length) join();
    else onActiveChange?.(current().active());
  }
  function startSplit() {
    if (split) return;
    groups[0].setCompare(null);
    const id = groups[0].active()?.id;
    if (!id) return;
    if (groups[0].tabs().length === 1) {
      groups[0].newUntitled();
      groups[0].activate(id);
    }
    split = true;
    onLayout(true);
    moveTab(id, 1);
  }
  async function requestClose(id = current().active()?.id) {
    const index = owner(id);
    if (index < 0) return false;
    focusGroup(index);
    const closed = await groups[index].requestClose(id);
    if (closed && !groups[index].tabs().length) {
      if (split) {
        if (index === 0) join();
        else { split = false; focused = 0; onLayout(false); onActiveChange?.(current().active()); }
      }
      if (!current().tabs().length) current().newUntitled();
    }
    return closed;
  }
  return {
    split: startSplit, join, isSplit: () => split, focusGroup, activeGroup: () => focused,
    groupTabs: (index) => groups[index].tabs(), moveTab,
    tabs: () => groups.flatMap((group) => group.tabs()),
    active: () => current().active(), compared: () => groups[0].compared(),
    newUntitled(text, options = {}) {
      if (options.compare) join();
      return current().newUntitled(text, options);
    },
    openFile(path, contents, options = {}) {
      if (options.compare) join();
      const index = groups.findIndex((group) => group.tabs().some((tab) => tab.path === path));
      if (index >= 0 && !options.compare) focusGroup(index);
      return current().openFile(path, contents, options);
    },
    activate(id) { const index = owner(id); if (index >= 0) { focusGroup(index); current().activate(id); } },
    reorder: (id, before) => current().reorder(id, before),
    cycle: (step) => current().cycle(step),
    markEdited: ({ group = focused, ...options } = {}) => groups[group].markEdited(options),
    markSaved: (path) => current().markSaved(path),
    setActiveKind: (kind) => current().setActiveKind(kind),
    setCompare(id) { if (id !== null) join(); groups[0].setCompare(id); },
    requestClose,
    async closeMany(ids) { for (const id of ids) if (!(await requestClose(id))) return false; return true; },
    forceClose(id) {
      const index = owner(id);
      if (index < 0) return;
      groups[index].forceClose(id);
      if (!groups[index].tabs().length) {
        if (split) join();
        if (!current().tabs().length) current().newUntitled();
      }
    },
    restore: () => groups[0].restore(),
    async flushDrafts() {
      await Promise.all(groups.map((group) => group.flushDrafts()));
      await Promise.all([...pending.values()]);
    },
    unsavedFiles: () => groups.flatMap((group) => group.unsavedFiles()),
    retarget: (from, to) => groups.forEach((group) => group.retarget(from, to)),
    reloadClean: (path, contents) => groups.forEach((group) => group.reloadClean(path, contents)),
  };
}
