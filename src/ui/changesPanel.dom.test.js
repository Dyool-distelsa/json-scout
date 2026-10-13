// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChangesPanel } from './changesPanel.js';

const CHANGES = [
  { relative: 'a.json', path: '/p/a.json', kind: 'modified' },
  { relative: 'sub/gone.json', path: '/p/sub/gone.json', kind: 'deleted' },
];

let container;
let onShow;
let onContextMenu;

beforeEach(() => {
  container = document.createElement('section');
  onShow = vi.fn();
  onContextMenu = vi.fn();
});

const make = (load) => createChangesPanel(container, { load, onShow, onContextMenu });
const items = () => [...container.querySelectorAll('.changes__item')];

describe('createChangesPanel', () => {
  it('stays hidden until a folder is set', () => {
    make(vi.fn());
    expect(container.hidden).toBe(true);
  });

  it('stays hidden for a folder outside git', async () => {
    const panel = make(vi.fn(async () => null));
    await panel.setFolder('/p');
    expect(container.hidden).toBe(true);
  });

  it('lists the changes with their badge and a count', async () => {
    const panel = make(vi.fn(async () => CHANGES));
    await panel.setFolder('/p');
    expect(container.hidden).toBe(false);
    expect(container.querySelector('.changes__title').textContent).toBe('Changes (2)');
    expect(items().map((i) => i.textContent)).toEqual(['a.jsonM', 'sub/gone.jsonD']);
  });

  it('shows a change on click, deleted ones too, and reports a right-click', async () => {
    const panel = make(vi.fn(async () => CHANGES));
    await panel.setFolder('/p');
    const [modified, deleted] = items();
    modified.click();
    deleted.click();
    expect(onShow.mock.calls).toEqual([[CHANGES[0]], [CHANGES[1]]]);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    modified.dispatchEvent(event);
    expect(onContextMenu).toHaveBeenCalledWith(CHANGES[0], event);
  });

  it('says when nothing changed', async () => {
    const panel = make(vi.fn(async () => []));
    await panel.setFolder('/p');
    expect(container.textContent).toContain('No changed JSON files');
  });

  it('hides while another sidebar tab is shown', async () => {
    const panel = make(vi.fn(async () => CHANGES));
    await panel.setFolder('/p');
    panel.setVisible(false);
    expect(container.hidden).toBe(true);
    panel.setVisible(true);
    expect(container.hidden).toBe(false);
  });

  it('refreshes from the loader', async () => {
    const load = vi.fn(async () => CHANGES);
    const panel = make(load);
    await panel.setFolder('/p');
    load.mockResolvedValueOnce([]);
    await panel.refresh();
    expect(items()).toHaveLength(0);
    expect(load).toHaveBeenLastCalledWith('/p');
  });
});
