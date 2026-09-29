import { describe, it, expect } from 'vitest';
import { INITIAL_MENU_STATE, reduceMenu, moveIndex, clampMenuPosition } from './menuState.js';

const closed = INITIAL_MENU_STATE;
const openAt = (activeIndex) => ({ open: true, activeIndex });

describe('moveIndex', () => {
  it('moves down and wraps to the first item', () => {
    expect(moveIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(moveIndex(2, 3, 'ArrowDown')).toBe(0);
  });

  it('moves up and wraps to the last item', () => {
    expect(moveIndex(1, 3, 'ArrowUp')).toBe(0);
    expect(moveIndex(0, 3, 'ArrowUp')).toBe(2);
  });

  it('starts from the ends when nothing is active', () => {
    expect(moveIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(moveIndex(-1, 3, 'ArrowUp')).toBe(2);
  });

  it('jumps with Home and End', () => {
    expect(moveIndex(1, 3, 'Home')).toBe(0);
    expect(moveIndex(1, 3, 'End')).toBe(2);
  });

  it('keeps the index for other keys and for an empty menu', () => {
    expect(moveIndex(1, 3, 'a')).toBe(1);
    expect(moveIndex(-1, 0, 'ArrowDown')).toBe(-1);
  });
});

describe('reduceMenu', () => {
  it('toggle opens with the first item active, then closes', () => {
    const opened = reduceMenu(closed, { type: 'toggle' }, 3);
    expect(opened).toEqual({ open: true, activeIndex: 0, focusButton: false });
    expect(reduceMenu(opened, { type: 'toggle' }, 3)).toEqual({
      open: false,
      activeIndex: -1,
      focusButton: true,
    });
  });

  it('open with focus "last" activates the last item', () => {
    expect(reduceMenu(closed, { type: 'open', focus: 'last' }, 3)).toMatchObject({
      open: true,
      activeIndex: 2,
    });
  });

  it('Escape closes and returns focus to the button', () => {
    expect(reduceMenu(openAt(1), { type: 'key', key: 'Escape' }, 3)).toEqual({
      open: false,
      activeIndex: -1,
      focusButton: true,
    });
  });

  it('arrow keys move the active item while open', () => {
    expect(reduceMenu(openAt(0), { type: 'key', key: 'ArrowDown' }, 3)).toMatchObject({
      open: true,
      activeIndex: 1,
    });
    expect(reduceMenu(openAt(0), { type: 'key', key: 'ArrowUp' }, 3)).toMatchObject({ activeIndex: 2 });
  });

  it('arrow keys on a closed menu are ignored by key handling', () => {
    expect(reduceMenu(closed, { type: 'key', key: 'ArrowDown' }, 3)).toEqual({
      ...closed,
      focusButton: false,
    });
  });

  it('Tab closes without stealing focus back', () => {
    expect(reduceMenu(openAt(1), { type: 'key', key: 'Tab' }, 3)).toEqual({
      open: false,
      activeIndex: -1,
      focusButton: false,
    });
  });

  it('selecting an item closes and returns focus to the button', () => {
    expect(reduceMenu(openAt(1), { type: 'select' }, 3)).toEqual({
      open: false,
      activeIndex: -1,
      focusButton: true,
    });
  });

  it('an outside click closes without moving focus', () => {
    expect(reduceMenu(openAt(1), { type: 'outside' }, 3)).toEqual({
      open: false,
      activeIndex: -1,
      focusButton: false,
    });
  });

  it('an outside click on a closed menu changes nothing', () => {
    expect(reduceMenu(closed, { type: 'outside' }, 3)).toEqual({ ...closed, focusButton: false });
  });

  it('hover activation sets the active item', () => {
    expect(reduceMenu(openAt(0), { type: 'hover', index: 2 }, 3)).toMatchObject({ activeIndex: 2 });
  });
});

describe('clampMenuPosition', () => {
  const viewport = { viewportWidth: 800, viewportHeight: 600 };

  it('keeps the position when the menu fits', () => {
    expect(clampMenuPosition({ left: 10, top: 40, menuWidth: 180, menuHeight: 100, ...viewport })).toEqual({
      left: 10,
      top: 40,
    });
  });

  it('shifts left when it would overflow the right edge', () => {
    const { left } = clampMenuPosition({ left: 700, top: 40, menuWidth: 180, menuHeight: 100, ...viewport });
    expect(left).toBe(800 - 180 - 8);
  });

  it('never goes past the left edge margin', () => {
    const { left } = clampMenuPosition({ left: -50, top: 40, menuWidth: 180, menuHeight: 100, ...viewport });
    expect(left).toBe(8);
  });

  it('clamps vertically to stay inside the window', () => {
    const { top } = clampMenuPosition({ left: 10, top: 580, menuWidth: 180, menuHeight: 100, ...viewport });
    expect(top).toBe(600 - 100 - 8);
  });
});
