import { describe, it, expect } from 'vitest';
import { formatJson } from './format.js';

describe('formatJson', () => {
  it('formats a simple object with the default 2-space indent', () => {
    expect(formatJson('{"a":1,"b":2}')).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('formats with 4-space indent', () => {
    expect(formatJson('{"a":1}', { indent: 4 })).toBe('{\n    "a": 1\n}');
  });

  it('formats with tab indent', () => {
    expect(formatJson('{"a":1}', { indent: 'tab' })).toBe('{\n\t"a": 1\n}');
  });

  it('formats nested objects and arrays of objects', () => {
    const input = '{"list":[{"a":1},{"b":2}]}';
    const out = formatJson(input, { indent: 2 });
    expect(out).toBe(
      '{\n  "list": [\n    {\n      "a": 1\n    },\n    {\n      "b": 2\n    }\n  ]\n}'
    );
  });

  it('strips a leading BOM before parsing', () => {
    expect(formatJson('﻿{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('handles CRLF line endings inside the raw input', () => {
    expect(formatJson('{\r\n"a":1\r\n}')).toBe('{\n  "a": 1\n}');
  });

  it('formats an empty object and empty array', () => {
    expect(formatJson('{}')).toBe('{}');
    expect(formatJson('[]')).toBe('[]');
  });

  it('preserves unicode characters', () => {
    expect(formatJson('{"emoji":"😀","name":"café"}')).toBe(
      '{\n  "emoji": "😀",\n  "name": "café"\n}'
    );
  });

  it('keeps only the last value for duplicate keys, per the JSON spec behavior of JSON.parse', () => {
    expect(formatJson('{"a":1,"a":2}')).toBe('{\n  "a": 2\n}');
  });

  it('throws a SyntaxError on malformed input', () => {
    expect(() => formatJson('{"a":}')).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => formatJson('')).toThrow();
  });

  it('deterministically round-trips large integers even though precision beyond 2^53 is lost (native JSON.parse limitation)', () => {
    const out = formatJson('{"big":12345678901234567890}');
    // Not exact to the source text -- documents the known lossy behavior.
    expect(out).toBe('{\n  "big": 12345678901234567000\n}');
  });

  it('preserves numeric precision within the safe integer range', () => {
    expect(formatJson('{"n":9007199254740991}')).toBe('{\n  "n": 9007199254740991\n}');
  });
});
