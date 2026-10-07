import { describe, it, expect } from 'vitest';
import { compareChoices } from './comparePicker.js';

const tab = (id, title) => ({ id, title, path: null, dirty: false, fromVault: false });

describe('compareChoices', () => {
  it('offers the other tabs, then a new Untitled or a file', () => {
    const choices = compareChoices([tab('a', 'a.json'), tab('b', 'Untitled 1')], 'a', null);
    expect(choices).toEqual([
      { kind: 'tab', id: 'b', label: 'Untitled 1', current: false },
      { kind: 'separator' },
      { kind: 'new', label: 'New Untitled' },
      { kind: 'open', label: 'Open file…' },
    ]);
  });

  it('skips the separator when only the active tab is open', () => {
    expect(compareChoices([tab('a', 'a.json')], 'a', null).map((c) => c.kind)).toEqual(['new', 'open']);
  });

  it('marks the compared tab and offers to close compare', () => {
    const choices = compareChoices([tab('a', 'A'), tab('b', 'B')], 'a', 'b');
    expect(choices[0]).toMatchObject({ id: 'b', current: true });
    expect(choices.at(-1)).toEqual({ kind: 'close', label: 'Close compare' });
  });
});
