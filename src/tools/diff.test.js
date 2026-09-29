import { describe, it, expect } from 'vitest';
import { diffJson, describeDiff } from './diff.js';

describe('diffJson', () => {
  it('returns undefined when both values are identical', () => {
    expect(diffJson({ a: 1 }, { a: 1 })).toBeUndefined();
  });

  it('produces a delta for a changed value', () => {
    expect(diffJson({ a: 1 }, { a: 2 })).toEqual({ a: [1, 2] });
  });

  it('produces a delta for an added key', () => {
    expect(diffJson({ a: 1 }, { a: 1, b: 2 })).toEqual({ b: [2] });
  });

  it('produces a delta for a removed key', () => {
    expect(diffJson({ a: 1, b: 2 }, { a: 1 })).toEqual({ b: [2, 0, 0] });
  });
});

describe('describeDiff', () => {
  it('returns an empty list when there is no delta', () => {
    expect(describeDiff(undefined)).toEqual([]);
  });

  it('describes a modified scalar value', () => {
    const delta = diffJson({ a: 1 }, { a: 2 });
    expect(describeDiff(delta)).toEqual([
      { path: '$.a', kind: 'modified', oldValue: 1, newValue: 2 },
    ]);
  });

  it('describes an added key', () => {
    const delta = diffJson({ a: 1 }, { a: 1, b: 2 });
    expect(describeDiff(delta)).toEqual([{ path: '$.b', kind: 'added', newValue: 2 }]);
  });

  it('describes a removed key', () => {
    const delta = diffJson({ a: 1, b: 2 }, { a: 1 });
    expect(describeDiff(delta)).toEqual([{ path: '$.b', kind: 'removed', oldValue: 2 }]);
  });

  it('describes an item added to an array', () => {
    const delta = diffJson({ list: [1, 2, 3] }, { list: [1, 2, 3, 4] });
    expect(describeDiff(delta)).toEqual([
      { path: '$.list[3]', kind: 'added', newValue: 4 },
    ]);
  });

  it('describes an item removed from an array', () => {
    const delta = diffJson([1, 2, 3], [1, 3]);
    const changes = describeDiff(delta);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('removed');
    expect(changes[0].oldValue).toBe(2);
  });

  it('describes a nested object change inside an array item', () => {
    const delta = diffJson([{ a: 1 }], [{ a: 2 }]);
    expect(describeDiff(delta)).toEqual([
      { path: '$[0].a', kind: 'modified', oldValue: 1, newValue: 2 },
    ]);
  });

  it('describes multiple changes together', () => {
    const delta = diffJson({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4 });
    const changes = describeDiff(delta);
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
    expect(byPath['$.b']).toEqual({ path: '$.b', kind: 'modified', oldValue: 2, newValue: 5 });
    expect(byPath['$.c']).toEqual({ path: '$.c', kind: 'removed', oldValue: 3 });
    expect(byPath['$.d']).toEqual({ path: '$.d', kind: 'added', newValue: 4 });
  });
});
