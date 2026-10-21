import { describe, it, expect } from 'vitest';
import {
  bulkSummary,
  bulkTitle,
  duplicateName,
  entryName,
  filesUnder,
  findDir,
  joinPath,
  nameProblem,
  namesIn,
  parentDir,
  withJsonExtension,
  withKeptExtension,
  withMarkdownExtension,
} from './fileActions.js';

const tree = {
  name: 'p',
  path: 'C:\\p',
  files: [{ name: 'a.json', path: 'C:\\p\\a.json' }],
  dirs: [
    {
      name: 'sub',
      path: 'C:\\p\\sub',
      files: [{ name: 'b.json', path: 'C:\\p\\sub\\b.json' }],
      dirs: [],
    },
  ],
};

describe('paths', () => {
  it('splits and joins with the separator the path uses', () => {
    expect(parentDir('C:\\p\\a.json')).toBe('C:\\p');
    expect(parentDir('/home/p/a.json')).toBe('/home/p');
    expect(entryName('C:\\p\\sub')).toBe('sub');
    expect(joinPath('C:\\p', 'x.json')).toBe('C:\\p\\x.json');
    expect(joinPath('/home/p', 'x.json')).toBe('/home/p/x.json');
  });
});

describe('duplicateName', () => {
  it('appends "copy", then a number, before the extension', () => {
    expect(duplicateName('a.json', ['a.json'])).toBe('a copy.json');
    expect(duplicateName('a.JSON', ['a.JSON', 'A Copy.json'])).toBe('a copy 2.JSON');
  });
});

describe('withJsonExtension', () => {
  it('adds .json only when missing', () => {
    expect(withJsonExtension('data')).toBe('data.json');
    expect(withJsonExtension('data.Json')).toBe('data.Json');
  });
});

describe('nameProblem', () => {
  it('rejects empty, invalid and taken names', () => {
    expect(nameProblem('', [])).toMatch(/Enter/);
    expect(nameProblem('a/b.json', [])).toMatch(/cannot contain/);
    expect(nameProblem('x.', [])).toMatch(/end with/);
    expect(nameProblem('A.json', ['a.json'])).toMatch(/already exists/);
  });

  it('allows a free name and a case-only change of the current one', () => {
    expect(nameProblem('b.json', ['a.json'])).toBeNull();
    expect(nameProblem('A.json', ['a.json'], 'a.json')).toBeNull();
  });
});

describe('tree helpers', () => {
  it('finds folders and lists the files under them at any depth', () => {
    expect(findDir(tree, 'C:\\p\\sub').name).toBe('sub');
    expect(findDir(tree, 'C:\\nope')).toBeNull();
    expect(filesUnder(tree)).toEqual(['C:\\p\\a.json', 'C:\\p\\sub\\b.json']);
    expect(namesIn(tree)).toEqual(['sub', 'a.json']);
  });
});

describe('bulk wording', () => {
  it('titles the confirmation and summarises the report', () => {
    expect(bulkTitle('minify', 1, 'sub')).toBe('Minify 1 JSON file in sub?');
    expect(bulkTitle('sort', 3, 'p')).toBe('Sort keys in 3 JSON files in p?');
    expect(bulkSummary('format', { changed: 2, unchanged: 1, failed: [{ path: 'x' }] }, 1)).toBe(
      '2 formatted, 1 already done, 1 not valid JSON, 1 skipped (unsaved edits)'
    );
  });
});

describe('Markdown file names', () => {
  it('duplicates keep a Markdown extension', () => {
    expect(duplicateName('README.md', ['README.md'])).toBe('README copy.md');
    expect(duplicateName('notes', ['notes'])).toBe('notes copy');
  });

  it('adds .md when no Markdown extension is given', () => {
    expect(withMarkdownExtension('plan')).toBe('plan.md');
    expect(withMarkdownExtension('plan.markdown')).toBe('plan.markdown');
  });

  it('a rename keeps the extension the file had unless one is typed', () => {
    expect(withKeptExtension('guide', 'README.md')).toBe('guide.md');
    expect(withKeptExtension('data', 'a.json')).toBe('data.json');
    expect(withKeptExtension('data.json', 'README.md')).toBe('data.json');
  });
});
