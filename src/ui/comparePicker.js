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

let openMenu = null;

/**
 * Show the picker under `anchor`. Arrow keys move, Enter picks, Escape or a
 * click elsewhere closes it.
 * @param {HTMLElement} anchor
 * @param {ReturnType<typeof compareChoices>} choices
 * @param {(choice: ReturnType<typeof compareChoices>[number]) => void} onPick
 */
export function openComparePicker(anchor, choices, onPick) {
  openMenu?.close();
  const menu = el('div', 'dropdown-menu compare-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Compare with');
  menu.appendChild(el('div', 'compare-menu__heading', 'Compare with'));

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
    left: rect.left,
    top: rect.bottom + 4,
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
