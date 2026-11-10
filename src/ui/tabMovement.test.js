// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { addUntitled, INITIAL_TABS, reorderTab } from './tabs.js';
import { createTabStrip } from './tabStrip.js';

it('reorders without changing active identity, metadata or input state', () => {
  let state = addUntitled(INITIAL_TABS, 'a', { dirty: true });
  state = addUntitled(state, 'b');
  state = addUntitled(state, 'c');
  const moved = reorderTab(state, 'c', 'a');
  expect(moved.tabs.map(t => t.id)).toEqual(['c', 'a', 'b']);
  expect(moved.activeId).toBe('c');
  expect(moved.tabs[1]).toBe(state.tabs[0]);
  expect(state.tabs.map(t => t.id)).toEqual(['a', 'b', 'c']);
  expect(reorderTab(state, 'missing', 'a')).toBe(state);
  expect(reorderTab(state, 'a', 'missing')).toBe(state);
  expect(reorderTab(state, 'a', 'a')).toBe(state);
  expect(reorderTab(state, 'a', null).tabs.map(t => t.id)).toEqual(['b', 'c', 'a']);
});

it('supports drag/drop and keyboard reorder while retaining activate and close', () => {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const onMove = vi.fn(); const onActivate = vi.fn(); const onClose = vi.fn();
  let state = addUntitled(INITIAL_TABS, 'a'); state = addUntitled(state, 'b');
  const strip = createTabStrip(container, { onMove, onActivate, onClose, onNew() {} });
  strip.render(state);
  const tabs = [...container.querySelectorAll('[role=tab]')];
  expect(tabs[0].draggable).toBe(true);
  const data = new Map();
  const dataTransfer = { setData: (k,v) => data.set(k,v), getData: k => data.get(k), types: ['application/x-json-scout-tab'] };
  const drag = new Event('dragstart', { bubbles: true }); Object.defineProperty(drag, 'dataTransfer', { value: dataTransfer });
  tabs[0].dispatchEvent(drag);
  const drop = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
  tabs[1].dispatchEvent(drop);
  expect(onMove).toHaveBeenCalledWith('a', 'b');
  tabs[1].focus();
  tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, shiftKey: true, bubbles: true }));
  expect(onMove).toHaveBeenLastCalledWith('b', 'a');
  tabs[0].click(); expect(onActivate).toHaveBeenCalledWith('a');
  tabs[0].querySelector('button').click(); expect(onClose).toHaveBeenCalledWith('a');
});
