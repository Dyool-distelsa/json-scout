import { describe, it, expect } from 'vitest';
import { collapseToggleState, shouldToggleOnHeaderClick } from './collapsible.js';

describe('collapseToggleState', () => {
  it('offers to collapse an expanded panel', () => {
    expect(collapseToggleState(false, 'Files')).toEqual({
      title: 'Collapse Files',
      ariaExpanded: 'true',
    });
  });

  it('offers to expand a collapsed panel, naming it', () => {
    expect(collapseToggleState(true, 'Tools')).toEqual({
      title: 'Expand Tools',
      ariaExpanded: 'false',
    });
  });
});

describe('shouldToggleOnHeaderClick', () => {
  it('expands a collapsed rail on any click', () => {
    expect(shouldToggleOnHeaderClick(true, false)).toBe(true);
    expect(shouldToggleOnHeaderClick(true, true)).toBe(true);
  });

  it('collapses an expanded panel only when a button was clicked', () => {
    expect(shouldToggleOnHeaderClick(false, true)).toBe(true);
    expect(shouldToggleOnHeaderClick(false, false)).toBe(false);
  });
});
