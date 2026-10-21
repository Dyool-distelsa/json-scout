import { describe, it, expect } from 'vitest';
import {
  defaultFileName,
  dialogFilters,
  guessKind,
  isSupportedPath,
  kindForPath,
  resolveMarkdownView,
} from './docKind.js';

describe('kindForPath', () => {
  it('reads Markdown extensions in any case', () => {
    expect(kindForPath('C:\\docs\\README.md')).toBe('markdown');
    expect(kindForPath('/notes/plan.MARKDOWN')).toBe('markdown');
  });

  it('treats everything else as JSON', () => {
    expect(kindForPath('a.json')).toBe('json');
    expect(kindForPath('notes.txt')).toBe('json');
    expect(kindForPath(null)).toBe('json');
  });
});

describe('isSupportedPath', () => {
  it('accepts JSON and Markdown only', () => {
    expect(isSupportedPath('a.JSON')).toBe(true);
    expect(isSupportedPath('a.md')).toBe(true);
    expect(isSupportedPath('a.txt')).toBe(false);
    expect(isSupportedPath('md')).toBe(false);
  });
});

describe('guessKind', () => {
  it('keeps anything that could be JSON as JSON', () => {
    expect(guessKind('')).toBe('json');
    expect(guessKind('  {"a": 1}')).toBe('json');
    expect(guessKind('[1, 2]')).toBe('json');
    expect(guessKind('plain words')).toBe('json');
  });

  it('spots Markdown block syntax', () => {
    expect(guessKind('# Title\n\nBody')).toBe('markdown');
    expect(guessKind('Intro\n\n- one\n- two')).toBe('markdown');
    expect(guessKind('```js\nx\n```')).toBe('markdown');
  });
});

describe('defaultFileName and dialogFilters', () => {
  it('follow the document kind', () => {
    expect(defaultFileName('markdown')).toBe('untitled.md');
    expect(defaultFileName('json')).toBe('untitled.json');
    expect(dialogFilters('markdown')[1].name).toBe('Markdown');
    expect(dialogFilters('json')[1].name).toBe('JSON');
    expect(dialogFilters()[0].extensions).toEqual(['json', 'md', 'markdown']);
  });
});

describe('resolveMarkdownView', () => {
  it('falls back to split for unknown values', () => {
    expect(resolveMarkdownView('preview')).toBe('preview');
    expect(resolveMarkdownView('raw')).toBe('raw');
    expect(resolveMarkdownView(null)).toBe('split');
    expect(resolveMarkdownView('nope')).toBe('split');
  });
});
