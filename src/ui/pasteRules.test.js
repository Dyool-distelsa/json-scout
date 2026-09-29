import { describe, it, expect } from 'vitest';
import { shouldProcessPaste, describePasteSuccess, PASTE_FAILURE_MESSAGE } from './pasteRules.js';

describe('shouldProcessPaste', () => {
  it('processes a paste into an empty document', () => {
    expect(shouldProcessPaste(0, 0, 0)).toBe(true);
  });

  it('processes a paste when the selection covers the whole document', () => {
    expect(shouldProcessPaste(10, 0, 10)).toBe(true);
  });

  it('handles a backwards selection (from/to swapped)', () => {
    expect(shouldProcessPaste(10, 10, 0)).toBe(true);
  });

  it('does not process a caret paste inside a non-empty document', () => {
    expect(shouldProcessPaste(10, 5, 5)).toBe(false);
    expect(shouldProcessPaste(10, 0, 0)).toBe(false);
    expect(shouldProcessPaste(10, 10, 10)).toBe(false);
  });

  it('does not process a partial selection', () => {
    expect(shouldProcessPaste(10, 0, 9)).toBe(false);
    expect(shouldProcessPaste(10, 1, 10)).toBe(false);
  });
});

describe('describePasteSuccess', () => {
  it('describes a valid paste', () => {
    expect(describePasteSuccess(['sorted', 'formatted'])).toBe('Pasted, sorted keys and formatted');
  });

  it('mentions the repair when it happened', () => {
    expect(describePasteSuccess(['repaired', 'sorted', 'formatted'])).toBe(
      'Pasted, repaired, sorted keys and formatted'
    );
  });
});

describe('PASTE_FAILURE_MESSAGE', () => {
  it('explains that the raw text was kept', () => {
    expect(PASTE_FAILURE_MESSAGE).toMatch(/not valid JSON/);
    expect(PASTE_FAILURE_MESSAGE).toMatch(/repair/);
  });
});
