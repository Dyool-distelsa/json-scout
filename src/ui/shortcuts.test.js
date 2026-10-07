import { describe, it, expect } from 'vitest';
import { SHORTCUTS, matchShortcut, formatShortcut, shouldFireShortcut } from './shortcuts.js';

const ev = (key, mods = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('matchShortcut', () => {
  const cases = [
    ['open', 'o', {}],
    ['save', 's', {}],
    ['saveAs', 'S', { shiftKey: true }],
    ['format', 'F', { shiftKey: true }],
    ['minify', 'M', { shiftKey: true }],
    ['validate', 'Enter', { shiftKey: true }],
    ['repair', 'R', { shiftKey: true }],
    ['sortKeys', 'O', { shiftKey: true }],
    ['diffToggle', 'D', { shiftKey: true }],
    ['toggleSidebar', 'b', {}],
    ['toggleRightPanel', 'j', {}],
    ['themeToggle', 'T', { shiftKey: true }],
  ];

  it.each(cases)('matches %s with Ctrl', (action, key, mods) => {
    expect(matchShortcut(ev(key, { ctrlKey: true, ...mods }))).toBe(action);
  });

  it.each(cases)('matches %s with Meta like Ctrl', (action, key, mods) => {
    expect(matchShortcut(ev(key, { metaKey: true, ...mods }))).toBe(action);
  });

  it('keeps Mod+S and Mod+Shift+S distinct', () => {
    expect(matchShortcut(ev('s', { ctrlKey: true }))).toBe('save');
    expect(matchShortcut(ev('S', { ctrlKey: true, shiftKey: true }))).toBe('saveAs');
  });

  it('keeps Mod+O and Mod+Shift+O distinct', () => {
    expect(matchShortcut(ev('o', { ctrlKey: true }))).toBe('open');
    expect(matchShortcut(ev('O', { ctrlKey: true, shiftKey: true }))).toBe('sortKeys');
  });

  it('is case-insensitive regardless of shift state of the key string', () => {
    expect(matchShortcut(ev('f', { ctrlKey: true, shiftKey: true }))).toBe('format');
    expect(matchShortcut(ev('F', { ctrlKey: true, shiftKey: true }))).toBe('format');
  });

  it('returns null without a Mod key', () => {
    expect(matchShortcut(ev('s'))).toBeNull();
    expect(matchShortcut(ev('Enter'))).toBeNull();
    expect(matchShortcut(ev('F', { shiftKey: true }))).toBeNull();
  });

  it('returns null when Alt is held', () => {
    expect(matchShortcut(ev('s', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(ev('F', { metaKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });

  it('returns null for unbound combinations', () => {
    expect(matchShortcut(ev('f', { ctrlKey: true }))).toBeNull(); // CodeMirror search
    expect(matchShortcut(ev('z', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev('b', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(ev('Enter', { ctrlKey: true }))).toBeNull(); // CodeMirror insertBlankLine
  });

  it('has no duplicate bindings in the table', () => {
    const seen = new Set(SHORTCUTS.map((s) => `${s.key}|${!!s.shift}|${!!s.alt}`));
    expect(seen.size).toBe(SHORTCUTS.length);
  });
});

describe('formatShortcut', () => {
  it('formats with Ctrl+ words on non-Mac', () => {
    expect(formatShortcut('format', false)).toBe('Ctrl+Shift+F');
    expect(formatShortcut('save', false)).toBe('Ctrl+S');
    expect(formatShortcut('validate', false)).toBe('Ctrl+Shift+Enter');
  });

  it('formats with symbols on Mac', () => {
    expect(formatShortcut('format', true)).toBe('⌘⇧F');
    expect(formatShortcut('save', true)).toBe('⌘S');
    expect(formatShortcut('validate', true)).toBe('⌘⇧↵');
  });

  it('returns an empty string for unknown actions', () => {
    expect(formatShortcut('nope', false)).toBe('');
    expect(formatShortcut('nope', true)).toBe('');
  });
});

describe('shouldFireShortcut', () => {
  it('fires on the first press of a bound combination', () => {
    expect(shouldFireShortcut(ev('b', { ctrlKey: true }))).toBe('toggleSidebar');
  });

  it('ignores auto-repeat while the key is held', () => {
    expect(shouldFireShortcut(ev('b', { ctrlKey: true, repeat: true }))).toBeNull();
    expect(shouldFireShortcut(ev('F', { ctrlKey: true, shiftKey: true, repeat: true }))).toBeNull();
  });

  it('returns null for unbound combinations', () => {
    expect(shouldFireShortcut(ev('z', { ctrlKey: true }))).toBeNull();
  });
});

describe('document tab shortcuts', () => {
  it('maps New, Close Tab and tab cycling', () => {
    expect(matchShortcut({ key: 'n', ctrlKey: true })).toBe('new');
    expect(matchShortcut({ key: 'w', ctrlKey: true })).toBe('closeTab');
    expect(matchShortcut({ key: 'Tab', ctrlKey: true })).toBe('nextTab');
    expect(matchShortcut({ key: 'Tab', ctrlKey: true, shiftKey: true })).toBe('prevTab');
    expect(formatShortcut('prevTab', false)).toBe('Ctrl+Shift+Tab');
  });
});
