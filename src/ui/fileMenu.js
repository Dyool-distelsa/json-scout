import { INITIAL_MENU_STATE, reduceMenu, clampMenuPosition } from './menuState.js';

/**
 * Build an accessible dropdown menu button ("File"). The state machine is
 * in menuState.js (unit tested); this is the thin DOM glue around it. The
 * menu is attached to <body> with fixed positioning because the toolbar
 * scrolls horizontally and would otherwise clip it.
 * @param {{ label: string, title?: string,
 *   items: Array<{ key: string, label: string, shortcut?: string }>,
 *   onSelect: (key: string) => void }} config
 * @returns {{ element: HTMLButtonElement }}
 */
export function createDropdownMenu({ label, title, items, onSelect }) {
  const menuId = `menu-${label.toLowerCase().replace(/\W+/g, '-')}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool-btn';
  button.textContent = label;
  if (title) button.title = title;
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', menuId);

  const menu = document.createElement('div');
  menu.id = menuId;
  menu.className = 'dropdown-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.hidden = true;

  const itemEls = items.map((item, index) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'dropdown-menu__item';
    el.setAttribute('role', 'menuitem');
    el.tabIndex = -1;
    const text = document.createElement('span');
    text.textContent = item.label;
    el.appendChild(text);
    if (item.shortcut) {
      const hint = document.createElement('span');
      hint.className = 'dropdown-menu__shortcut';
      hint.textContent = item.shortcut;
      el.appendChild(hint);
    }
    el.addEventListener('click', () => {
      apply({ type: 'select' });
      onSelect(item.key);
    });
    el.addEventListener('mousemove', () => apply({ type: 'hover', index }));
    menu.appendChild(el);
    return el;
  });
  document.body.appendChild(menu);

  let state = INITIAL_MENU_STATE;

  function position() {
    const rect = button.getBoundingClientRect();
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
  }

  function apply(action) {
    const next = reduceMenu(state, action, items.length);
    const wasOpen = state.open;
    state = { open: next.open, activeIndex: next.activeIndex };
    menu.hidden = !state.open;
    button.setAttribute('aria-expanded', String(state.open));
    if (state.open && !wasOpen) position();
    if (state.open) itemEls[state.activeIndex]?.focus();
    if (next.focusButton) button.focus();
  }

  button.addEventListener('click', () => apply({ type: 'toggle' }));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      apply({ type: 'open', focus: e.key === 'ArrowUp' ? 'last' : 'first' });
    }
  });
  menu.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(e.key)) e.preventDefault();
    apply({ type: 'key', key: e.key });
  });
  document.addEventListener('pointerdown', (e) => {
    if (state.open && !menu.contains(e.target) && !button.contains(e.target)) {
      apply({ type: 'outside' });
    }
  });
  window.addEventListener('resize', () => apply({ type: 'outside' }));
  window.addEventListener('blur', () => apply({ type: 'outside' }));

  return { element: button };
}
