import { describe, it, expect } from 'vitest';
import { sortKeysDeep } from './sortKeys.js';

describe('sortKeysDeep', () => {
  it('sorts top-level keys alphabetically', () => {
    expect(sortKeysDeep({ b: 1, a: 2, c: 3 })).toEqual({ a: 2, b: 1, c: 3 });
    expect(Object.keys(sortKeysDeep({ b: 1, a: 2, c: 3 }))).toEqual(['a', 'b', 'c']);
  });

  it('sorts nested object keys recursively', () => {
    const input = { z: { d: 1, a: 2 }, a: 1 };
    const result = sortKeysDeep(input);
    expect(Object.keys(result)).toEqual(['a', 'z']);
    expect(Object.keys(result.z)).toEqual(['a', 'd']);
  });

  it('sorts keys of objects nested inside arrays without reordering the array', () => {
    const input = [{ b: 1, a: 2 }, { d: 1, c: 2 }];
    const result = sortKeysDeep(input);
    expect(result).toEqual([{ a: 2, b: 1 }, { c: 2, d: 1 }]);
    expect(Object.keys(result[0])).toEqual(['a', 'b']);
  });

  it('leaves primitive values untouched', () => {
    expect(sortKeysDeep(42)).toBe(42);
    expect(sortKeysDeep('hello')).toBe('hello');
    expect(sortKeysDeep(true)).toBe(true);
    expect(sortKeysDeep(null)).toBe(null);
  });

  it('handles empty objects and arrays', () => {
    expect(sortKeysDeep({})).toEqual({});
    expect(sortKeysDeep([])).toEqual([]);
  });

  it('does not mutate the original input', () => {
    const input = { b: 1, a: 2 };
    const result = sortKeysDeep(input);
    expect(input).toEqual({ b: 1, a: 2 });
    expect(result).not.toBe(input);
  });

  it('sorts unicode keys using stable code-point ordering', () => {
    const input = { 'é': 1, a: 2, z: 3 };
    const result = sortKeysDeep(input);
    expect(Object.keys(result)).toEqual(Object.keys(input).sort());
  });

  it('handles deeply nested structures', () => {
    const input = { z: { y: { x: { b: 1, a: 2 } } } };
    const result = sortKeysDeep(input);
    expect(Object.keys(result.z.y.x)).toEqual(['a', 'b']);
  });
});
