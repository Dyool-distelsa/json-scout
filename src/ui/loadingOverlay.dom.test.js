// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createLoadingOverlay } from './loadingOverlay.js';

describe('createLoadingOverlay', () => {
  it('shows the file name and stays up until every open has finished', () => {
    const overlay = createLoadingOverlay();
    const root = document.querySelector('.loading-overlay');
    expect(root.hidden).toBe(true);
    overlay.show('a.json');
    overlay.show('b.json');
    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain('b.json');
    overlay.hide();
    expect(root.hidden).toBe(false);
    overlay.hide();
    expect(root.hidden).toBe(true);
  });
});
