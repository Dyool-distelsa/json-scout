import { describe, it, expect } from 'vitest';
import { collapseToggleState } from './collapsible.js';

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
