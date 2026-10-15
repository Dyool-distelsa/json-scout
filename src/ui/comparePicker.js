import { el } from './dom.js';
import { clampMenuPosition } from './menuState.js';

/**
 * What the Diff compare picker offers: every open tab except the active one,
 * then a new Untitled document or a file from disk, and leaving Diff mode when
 * it is on. Pure, so it is unit tested.
 * @param {import('./tabs.js').Tab[]} tabs
 * @param {string|null} activeId
 * @param {string|null} compareId
 * @returns {Array<{ kind: 'tab', id: string, label: string, current: boolean }
 *   | { kind: 'new'|'open'|'close', label: string } | { kind: 'separator' }>}
 */
export function compareChoices(tabs, activeId, compareId) {
  const others = tabs
    .filter((t) => t.id !== activeId)
    .map((t) => ({ kind: 'tab', id: t.id, label: t.title, current: t.id === compareId }));
  const items = [...others];
  if (others.length > 0) items.push({ kind: 'separator' });
  items.push({ kind: 'new', label: 'New Untitled' }, { kind: 'open', label: 'Open file…' });
  if (compareId !== null) {
    items.push({ kind: 'separator' }, { kind: 'close', label: 'Close compare' });
  }
  return items;
}

/**
 * What right-clicking a file in the Files panel offers: open it, and compare
 * it with the active tab unless it is the active tab. A file in the Changes
 * list also offers Show Changes, and only that once it is deleted. Pure, so
 * it is unit tested.
 * @param {string} path the clicked file
 * @param {string|null} activePath the active tab's file, if any
 * @param {{ changeKind?: string }} [options] set for a file in the Changes list
 * @returns {Array<{ kind: 'changes'|'open'|'compare'|'duplicate'|'rename', label: string } | { kind: 'separator' }>}
 */
export function fileChoices(path, activePath, { changeKind } = {}) {
  const items = [];
  if (changeKind) items.push({ kind: 'changes', label: 'Show Changes' });
  if (changeKind === 'deleted') return items;
  items.push({ kind: 'open', label: 'Open' });
  if (path !== activePath) items.push({ kind: 'compare', label: 'Compare with active tab' });
  items.push({ kind: 'separator' }, { kind: 'duplicate', label: 'Duplicate' }, { kind: 'rename', label: 'Rename…' });
  return items;
}

/**
 * What right-clicking a tab header offers. Close to the Right/Left only
 * appear when there are tabs on that side. Pure, so it is unit tested.
 * @param {import('./tabs.js').TabsState} state
 * @param {string} id the right-clicked tab
 * @returns {Array<{ kind: 'this'|'all'|'right'|'left', label: string }>}
 */
export function tabChoices(state, id) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return [];
  const items = [{ kind: 'this', label: 'Close' }, { kind: 'all', label: 'Close All' }];
  if (index < state.tabs.length - 1) items.push({ kind: 'right', label: 'Close to the Right' });
  if (index > 0) items.push({ kind: 'left', label: 'Close to the Left' });
  return items;
}

let openMenu = null;

/**
 * Show the picker under `anchor` (or at `options.point`, for a right-click
 * menu). Arrow keys move, Enter picks, Escape or a click elsewhere closes it.
 * @param {HTMLElement} anchor
 * @param {Array<{ kind: string, label?: string, current?: boolean }>} choices
 * @param {(choice: any) => void} onPick
 * @param {{ heading?: string, point?: { left: number, top: number } }} [options]
 */
export function openComparePicker(anchor, choices, onPick, { heading = 'Compare with', point } = {}) {
  openMenu?.close();
  const menu = el('div', 'dropdown-menu compare-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', heading);
  menu.appendChild(el('div', 'compare-menu__heading', heading));

  const items = [];
  for (const choice of choices) {
    if (choice.kind === 'separator') {
      menu.appendChild(el('div', 'compare-menu__separator'));
      continue;
    }
    const item = el('button', 'dropdown-menu__item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    item.appendChild(el('span', undefined, choice.label));
    if (choice.kind === 'tab' && choice.current) {
      item.appendChild(el('span', 'dropdown-menu__shortcut', 'shown'));
    }
    item.addEventListener('click', () => {
      close();
      onPick(choice);
    });
    item.addEventListener('mousemove', () => item.focus());
    menu.appendChild(item);
    items.push(item);
  }
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const { left, top } = clampMenuPosition({
    left: point?.left ?? rect.left,
    top: point?.top ?? rect.bottom + 4,
    menuWidth: menu.offsetWidth,
    menuHeight: menu.offsetHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  items[0]?.focus();

  function onKey(event) {
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
      anchor.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }
  function onOutside(event) {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) close();
  }
  function close() {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
    if (openMenu?.menu === menu) openMenu = null;
  }
  menu.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  openMenu = { menu, close };
  return { close };
}
