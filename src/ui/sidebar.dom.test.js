// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSidebar } from './sidebar.js';

const file = (dir, name, size = 2048) => ({ name, path: `${dir}\\${name}`, size, modified: null });
const TREE = {
  truncated: false,
  root: {
    name: 'proj',
    path: 'C:\\proj',
    dirs: [
      {
        name: 'config',
        path: 'C:\\proj\\config',
        dirs: [],
        files: [file('C:\\proj\\config', 'dev.json')],
      },
    ],
    files: [file('C:\\proj', 'package.json')],
  },
};

const names = (container) => [...container.querySelectorAll('.file-tree__name')].map((el) => el.textContent);
const row = (container, name) =>
  [...container.querySelectorAll('[role="treeitem"]')].find((el) => el.querySelector('.file-tree__name').textContent === name);

let container;
let onSelect;
let sidebar;

beforeEach(() => {
  container = document.createElement('div');
  onSelect = vi.fn();
  sidebar = createSidebar(container, onSelect);
});

describe('createSidebar', () => {
  it('says no folder is loaded until a tree is set', () => {
    expect(container.textContent).toContain('No folder loaded');
  });

  it('shows the root expanded with folders first and subfolders collapsed', () => {
    sidebar.setTree(TREE);
    expect(names(container)).toEqual(['proj', 'config', 'package.json']);
    expect(row(container, 'config').getAttribute('aria-expanded')).toBe('false');
  });

  it('expands and collapses a folder on click', () => {
    sidebar.setTree(TREE);
    row(container, 'config').click();
    expect(names(container)).toEqual(['proj', 'config', 'dev.json', 'package.json']);
    row(container, 'config').click();
    expect(names(container)).not.toContain('dev.json');
  });

  it('opens a file by its full path and marks it active', () => {
    sidebar.setTree(TREE);
    row(container, 'package.json').click();
    expect(onSelect).toHaveBeenCalledWith('C:\\proj\\package.json');
    expect(row(container, 'package.json').classList.contains('active')).toBe(true);
  });

  it('reveals the active file inside a collapsed folder', () => {
    sidebar.setTree(TREE);
    sidebar.setActive('C:\\proj\\config\\dev.json');
    expect(row(container, 'dev.json').classList.contains('active')).toBe(true);
  });

  it('says when the folder has no JSON files or was cut short', () => {
    sidebar.setTree({ truncated: true, root: { name: 'empty', path: 'C:\\empty', dirs: [], files: [] } });
    expect(container.textContent).toContain('No JSON files in this folder');
    expect(container.textContent).toContain('only part of it is shown');
  });
});
