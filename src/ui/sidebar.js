/**
 * Render the Files panel: the JSON files of the opened folder as a tree
 * (folders first, then files). Folders start collapsed except the root;
 * the folder holding the active file is expanded so it stays visible.
 * @param {HTMLElement} container
 * @param {(path: string) => void} onSelect called with the file's full path
 */
export function createSidebar(container, onSelect) {
  /** @type {{ root: TreeDir, truncated?: boolean } | null} */
  let tree = null;
  let activePath = null;
  /** Folder paths currently expanded. */
  const expanded = new Set();

  function render() {
    container.innerHTML = '';
    if (!tree) {
      container.appendChild(message('No folder loaded'));
      return;
    }
    const { root } = tree;
    const list = document.createElement('div');
    list.className = 'file-tree';
    list.setAttribute('role', 'tree');
    list.setAttribute('aria-label', root.name);
    list.appendChild(renderDir(root, 0));
    container.appendChild(list);
    if (root.dirs.length === 0 && root.files.length === 0) {
      container.appendChild(message('No JSON files in this folder'));
    }
    if (tree.truncated) {
      container.appendChild(message('Large folder: only part of it is shown'));
    }
  }

  function message(text) {
    const el = document.createElement('div');
    el.className = 'sidebar__item sidebar__item--message';
    el.textContent = text;
    return el;
  }

  /** @param {TreeDir} dir @param {number} depth */
  function renderDir(dir, depth) {
    const group = document.createElement('div');
    const open = expanded.has(dir.path);

    const row = document.createElement('div');
    row.className = 'sidebar__item file-tree__dir';
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-expanded', String(open));
    row.style.paddingLeft = indent(depth);
    row.title = dir.path;
    const chevron = document.createElement('span');
    chevron.className = 'file-tree__chevron';
    chevron.textContent = open ? '▾' : '▸';
    const name = document.createElement('span');
    name.className = 'file-tree__name';
    name.textContent = dir.name;
    row.append(chevron, name);
    row.addEventListener('click', () => {
      if (expanded.has(dir.path)) expanded.delete(dir.path);
      else expanded.add(dir.path);
      render();
    });
    group.appendChild(row);

    if (open) {
      const children = document.createElement('div');
      children.setAttribute('role', 'group');
      for (const child of dir.dirs) children.appendChild(renderDir(child, depth + 1));
      for (const file of dir.files) children.appendChild(renderFile(file, depth + 1));
      group.appendChild(children);
    }
    return group;
  }

  /** @param {TreeFile} file @param {number} depth */
  function renderFile(file, depth) {
    const item = document.createElement('div');
    item.className = 'sidebar__item file-tree__file';
    item.setAttribute('role', 'treeitem');
    if (file.path === activePath) {
      item.classList.add('active');
      item.setAttribute('aria-selected', 'true');
    }
    item.style.paddingLeft = indent(depth);
    item.title = file.path;

    const nameEl = document.createElement('span');
    nameEl.className = 'file-tree__name';
    nameEl.textContent = file.name;
    const metaEl = document.createElement('span');
    metaEl.className = 'file-tree__meta';
    metaEl.textContent = formatSize(file.size);
    item.append(nameEl, metaEl);
    item.addEventListener('click', () => {
      activePath = file.path;
      onSelect(file.path);
      render();
    });
    return item;
  }

  function indent(depth) {
    return `calc(var(--space-3) + ${depth * 12}px)`;
  }

  /** Expand every folder on the way to `path`; false when it is not in the tree. */
  function revealPath(dir, path) {
    if (dir.files.some((f) => f.path === path)) {
      expanded.add(dir.path);
      return true;
    }
    for (const child of dir.dirs) {
      if (revealPath(child, path)) {
        expanded.add(dir.path);
        return true;
      }
    }
    return false;
  }

  render();

  return {
    /** @param {{ root: TreeDir, truncated?: boolean } | null} next */
    setTree(next) {
      tree = next;
      expanded.clear();
      if (tree) {
        expanded.add(tree.root.path);
        if (activePath) revealPath(tree.root, activePath);
      }
      render();
    },
    /** @param {string | null} path */
    setActive(path) {
      activePath = path;
      if (tree && path) revealPath(tree.root, path);
      render();
    },
  };
}

/** @param {number} size */
export function formatSize(size) {
  return size ? `${Math.max(1, Math.round(size / 1024))} KB` : '';
}

/**
 * @typedef {{ name: string, path: string, size: number, modified: number | null }} TreeFile
 * @typedef {{ name: string, path: string, dirs: TreeDir[], files: TreeFile[] }} TreeDir
 */
