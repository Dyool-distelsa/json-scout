import { el } from './dom.js';

/** One-letter badge per change kind, as git and editors show them. */
const BADGES = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: '!',
};

/**
 * The "Changes" section under the Files tree: the opened folder's JSON files
 * that git reports as changed. Hidden while no folder is open, when the
 * folder is not in a git repository, or while another sidebar tab is shown.
 * @param {HTMLElement} container
 * @param {{
 *   load: (dir: string) => Promise<Array<{ relative: string, path: string, kind: string }> | null>,
 *   onSelect: (path: string) => void,
 *   onContextMenu?: (path: string, event: MouseEvent) => void,
 * }} deps
 */
export function createChangesPanel(container, { load, onSelect, onContextMenu }) {
  container.replaceChildren();
  container.classList.add('changes');
  const title = el('div', 'changes__title', 'Changes');
  const list = el('div', 'changes__list');
  list.setAttribute('role', 'list');
  container.append(title, list);

  let dir = null;
  let changes = null;
  let visible = true;
  let activePath = null;
  let seq = 0;

  function sync() {
    container.hidden = !visible || changes === null;
  }

  function render() {
    sync();
    if (changes === null) return;
    title.textContent = changes.length ? `Changes (${changes.length})` : 'Changes';
    if (changes.length === 0) {
      list.replaceChildren(el('div', 'sidebar__item sidebar__item--message', 'No changed JSON files'));
      return;
    }
    list.replaceChildren(
      ...changes.map((change) => {
        const deleted = change.kind === 'deleted';
        const item = el('div', `sidebar__item changes__item changes__item--${change.kind}`);
        item.setAttribute('role', 'listitem');
        item.title = `${change.path} (${change.kind})`;
        if (change.path === activePath) item.classList.add('active');
        const name = el('span', 'file-tree__name', change.relative);
        const badge = el('span', 'changes__badge', BADGES[change.kind] ?? '?');
        badge.setAttribute('aria-label', change.kind);
        item.append(name, badge);
        if (deleted) {
          item.setAttribute('aria-disabled', 'true');
        } else {
          item.addEventListener('click', () => onSelect(change.path));
          if (onContextMenu) {
            item.addEventListener('contextmenu', (event) => {
              event.preventDefault();
              onContextMenu(change.path, event);
            });
          }
        }
        return item;
      })
    );
  }

  /** Re-read the changes of the current folder. Stale answers are dropped. */
  async function refresh() {
    if (dir === null) return;
    const mine = ++seq;
    let next = null;
    try {
      next = await load(dir);
    } catch {
      next = null;
    }
    if (mine !== seq) return;
    changes = next ?? null;
    render();
  }

  sync();

  return {
    /** @param {string|null} next the folder shown in the Files panel */
    setFolder(next) {
      dir = next;
      changes = null;
      seq += 1;
      render();
      return refresh();
    },
    refresh,
    /** @param {boolean} next whether the Files tab is the one shown */
    setVisible(next) {
      visible = next;
      sync();
    },
    /** @param {string|null} path */
    setActive(path) {
      activePath = path;
      render();
    },
  };
}
