import { describe, it, expect } from 'vitest';
import { queryJson } from './query.js';

const data = {
  store: {
    book: [
      { category: 'fiction', author: 'Author A', price: 8.95 },
      { category: 'fiction', author: 'Author B', price: 12.99 },
      { category: 'reference', author: 'Author C', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
};

describe('queryJson', () => {
  it('returns matched values for a wildcard path', () => {
    const results = queryJson(data, '$.store.book[*].author');
    expect(results.map((r) => r.value)).toEqual(['Author A', 'Author B', 'Author C']);
  });

  it('returns every value for a recursive descent path', () => {
    const results = queryJson(data, '$..price');
    expect(results.map((r) => r.value).sort()).toEqual([8.95, 12.99, 19.95, 22.99].sort());
  });

  it('includes a normalized path string alongside each matched value', () => {
    const results = queryJson(data, '$.store.bicycle');
    expect(results).toHaveLength(1);
    expect(results[0].value).toEqual({ color: 'red', price: 19.95 });
    expect(typeof results[0].path).toBe('string');
  });

  it('returns an empty array when nothing matches', () => {
    expect(queryJson(data, '$.store.nonexistent')).toEqual([]);
  });

  it('supports filter expressions', () => {
    const results = queryJson(data, '$.store.book[?(@.price < 10)]');
    expect(results).toHaveLength(1);
    expect(results[0].value.author).toBe('Author A');
  });

  it('throws a descriptive error for a malformed JSONPath expression', () => {
    expect(() => queryJson(data, '$..[?(')).toThrow();
  });

  it('throws for an empty expression', () => {
    expect(() => queryJson(data, '')).toThrow();
  });

  it('handles querying arrays at the root', () => {
    const arr = [{ id: 1 }, { id: 2 }];
    const results = queryJson(arr, '$[*].id');
    expect(results.map((r) => r.value)).toEqual([1, 2]);
  });
});
