import { describe, it, expect } from 'vitest';
import { computeStats, computeStatsFromValue } from './stats.js';

describe('computeStats', () => {
  it('computes stats for a flat single-line object', () => {
    const result = computeStats('{"a":1}');
    expect(result.byteSize).toBe(7);
    expect(result.lineCount).toBe(1);
    expect(result.maxDepth).toBe(2);
    expect(result.totalKeys).toBe(1);
    expect(result.arrayCount).toBe(0);
    expect(result.typeHistogram).toEqual({
      string: 0,
      number: 1,
      boolean: 0,
      null: 0,
      object: 1,
      array: 0,
    });
  });

  it('counts lines across a pretty-printed multi-line document', () => {
    const result = computeStats('{\n  "a": 1,\n  "b": 2\n}');
    expect(result.lineCount).toBe(4);
    expect(result.byteSize).toBe(22);
  });

  it('counts lines correctly for CRLF line endings without double-counting', () => {
    const result = computeStats('{"a":1,\r\n"b":2}');
    expect(result.lineCount).toBe(2);
  });

  it('computes byte size using UTF-8 byte length, not character length, for unicode', () => {
    const result = computeStats('{"emoji":"😀"}');
    expect(result.byteSize).toBe(16);
  });

  it('computes maxDepth for a nested object with a mix of value types', () => {
    const result = computeStats('{"a":1,"b":[1,2,{"c":true}],"d":null}');
    expect(result.maxDepth).toBe(4);
    expect(result.totalKeys).toBe(4);
    expect(result.arrayCount).toBe(1);
    expect(result.typeHistogram).toEqual({
      string: 0,
      number: 3,
      boolean: 1,
      null: 1,
      object: 2,
      array: 1,
    });
  });

  it('counts nested arrays and computes their depth', () => {
    const result = computeStats('[[1,2],[3,[4,5]]]');
    expect(result.arrayCount).toBe(4);
    expect(result.maxDepth).toBe(4);
    expect(result.totalKeys).toBe(0);
    expect(result.typeHistogram).toEqual({
      string: 0,
      number: 5,
      boolean: 0,
      null: 0,
      object: 0,
      array: 4,
    });
  });

  it('handles a scalar root value', () => {
    const result = computeStats('42');
    expect(result.maxDepth).toBe(1);
    expect(result.totalKeys).toBe(0);
    expect(result.typeHistogram.number).toBe(1);
  });

  it('handles empty object and empty array roots', () => {
    expect(computeStats('{}').maxDepth).toBe(1);
    expect(computeStats('{}').typeHistogram.object).toBe(1);
    expect(computeStats('[]').maxDepth).toBe(1);
    expect(computeStats('[]').typeHistogram.array).toBe(1);
  });

  it('strips a leading BOM before computing byte size and stats', () => {
    const result = computeStats('﻿{"a":1}');
    expect(result.byteSize).toBe(7);
    expect(result.totalKeys).toBe(1);
  });

  it('throws on malformed input', () => {
    expect(() => computeStats('{"a":}')).toThrow();
  });
});

describe('computeStatsFromValue', () => {
  it('matches computeStats when given the same already-parsed value and text', () => {
    const text = '{"a":1,"b":[1,2,{"c":true}],"d":null}';
    const fromText = computeStats(text);
    const fromValue = computeStatsFromValue(JSON.parse(text), text);
    expect(fromValue).toEqual(fromText);
  });

  it('strips a BOM from the text before computing byte size, without re-parsing', () => {
    const value = { a: 1 };
    const result = computeStatsFromValue(value, '﻿{"a":1}');
    expect(result.byteSize).toBe(7);
    expect(result.totalKeys).toBe(1);
  });

  it('computes byte size using UTF-8 byte length for unicode', () => {
    const value = { emoji: '😀' };
    const result = computeStatsFromValue(value, '{"emoji":"😀"}');
    expect(result.byteSize).toBe(16);
  });
});
