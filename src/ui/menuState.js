/**
 * Pure state logic for the File dropdown menu: open/close transitions,
 * arrow-key navigation and viewport clamping. DOM wiring lives in
 * fileMenu.js; everything here is unit tested in menuState.test.js.
 */

const VIEWPORT_MARGIN = 8;

export const INITIAL_MENU_STATE = Object.freeze({ open: false, activeIndex: -1 });

/**
 * Next active item index for a navigation key, wrapping at both ends.
 * @param {number} current - current index, -1 when nothing is active
 * @param {number} count - number of menu items
 * @param {string} key
 * @returns {number}
 */
export function moveIndex(current, count, key) {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}

const closedResult = (focusButton) => ({ open: false, activeIndex: -1, focusButton });

/**
 * Transition the menu state. `focusButton` in the result says whether the
 * caller should move focus back to the File button (Escape, selecting an
 * item, toggling closed) or leave it alone (outside click, Tab).
 * @param {{ open: boolean, activeIndex: number }} state
 * @param {{ type: 'toggle' | 'open' | 'close' | 'select' | 'outside' | 'key' | 'hover',
 *   key?: string, focus?: 'first' | 'last', index?: number }} action
 * @param {number} count - number of menu items
 * @returns {{ open: boolean, activeIndex: number, focusButton: boolean }}
 */
export function reduceMenu(state, action, count) {
  switch (action.type) {
    case 'toggle':
      return state.open
        ? closedResult(true)
        : { open: true, activeIndex: count > 0 ? 0 : -1, focusButton: false };
    case 'open':
      return {
        open: true,
        activeIndex: count > 0 ? (action.focus === 'last' ? count - 1 : 0) : -1,
        focusButton: false,
      };
    case 'close':
    case 'select':
      return state.open ? closedResult(true) : { ...state, focusButton: false };
    case 'outside':
      return state.open ? closedResult(false) : { ...state, focusButton: false };
    case 'hover':
      return state.open
        ? { open: true, activeIndex: action.index ?? state.activeIndex, focusButton: false }
        : { ...state, focusButton: false };
    case 'key': {
      if (!state.open) return { ...state, focusButton: false };
      if (action.key === 'Escape') return closedResult(true);
      if (action.key === 'Tab') return closedResult(false);
      return {
        open: true,
        activeIndex: moveIndex(state.activeIndex, count, action.key),
        focusButton: false,
      };
    }
    default:
      return { ...state, focusButton: false };
  }
}

/**
 * Keep a fixed-position menu fully inside the window.
 * @param {{ left: number, top: number, menuWidth: number, menuHeight: number,
 *   viewportWidth: number, viewportHeight: number }} args
 * @returns {{ left: number, top: number }}
 */
export function clampMenuPosition({ left, top, menuWidth, menuHeight, viewportWidth, viewportHeight }) {
  const maxLeft = viewportWidth - menuWidth - VIEWPORT_MARGIN;
  const maxTop = viewportHeight - menuHeight - VIEWPORT_MARGIN;
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop)),
  };
}
