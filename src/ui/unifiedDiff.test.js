import { describe, expect, it } from 'vitest';
import { unifiedDiff, hunkHeader } from './unifiedDiff.js';

const lines = (n, f = (i) => `l${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

describe('unifiedDiff', () => {
  it('finds no hunks for equal texts', () => {
    expect(unifiedDiff('a\nb\n', 'a\r\nb\r\n')).toEqual({ hunks: [], added: 0, removed: 0 });
  });

  it('prints a changed line as removal then addition with context', () => {
    const { hunks, added, removed } = unifiedDiff(lines(10), lines(10, (i) => (i === 5 ? 'X' : `l${i}`)));
    expect([added, removed]).toEqual([1, 1]);
    expect(hunks).toHaveLength(1);
    expect(hunkHeader(hunks[0])).toBe('@@ -2,7 +2,7 @@');
    expect(hunks[0].lines.map((l) => l.type + l.text)).toEqual([' l2', ' l3', ' l4', '-l5', '+X', ' l6', ' l7', ' l8']);
    expect(hunks[0].lines[3]).toMatchObject({ oldLine: 5, newLine: null });
    expect(hunks[0].lines[4]).toMatchObject({ oldLine: null, newLine: 5 });
  });

  it('splits changes far apart into separate hunks and joins close ones', () => {
    const far = unifiedDiff(lines(30), lines(30, (i) => (i === 2 || i === 25 ? 'X' : `l${i}`)));
    expect(far.hunks.map(hunkHeader)).toEqual(['@@ -1,5 +1,5 @@', '@@ -22,7 +22,7 @@']);
    const near = unifiedDiff(lines(30), lines(30, (i) => (i === 5 || i === 10 ? 'X' : `l${i}`)));
    expect(near.hunks).toHaveLength(1);
  });

  it('shows a whole new or deleted file', () => {
    expect(hunkHeader(unifiedDiff('', 'a\nb\n').hunks[0])).toBe('@@ -0,0 +1,2 @@');
    expect(hunkHeader(unifiedDiff('a\nb\n', '').hunks[0])).toBe('@@ -1,2 +0,0 @@');
  });

  it('aligns inserted lines without touching the common ones', () => {
    const { hunks, added, removed } = unifiedDiff('a\nb\nc\n', 'a\nb\nnew\nc\n');
    expect([added, removed]).toEqual([1, 0]);
    expect(hunks[0].lines.map((l) => l.type + l.text)).toEqual([' a', ' b', '+new', ' c']);
  });
});
