import { describe, it, expect } from 'vitest';
import { minifyJson } from './minify.js';

describe('minifyJson', () => {
  it('removes insignificant whitespace', () => {
    expect(minifyJson('{\n  "a": 1,\n  "b": 2\n}')).toBe('{"a":1,"b":2}');
  });

  it('minifies nested structures', () => {
    expect(minifyJson('{ "list": [ { "a": 1 }, { "b": 2 } ] }')).toBe(
      '{"list":[{"a":1},{"b":2}]}'
    );
  });

  it('strips a leading BOM before parsing', () => {
    expect(minifyJson('﻿{ "a" : 1 }')).toBe('{"a":1}');
  });

  it('handles CRLF line endings', () => {
    expect(minifyJson('{\r\n  "a": 1\r\n}')).toBe('{"a":1}');
  });

  it('minifies an already-minified value idempotently', () => {
    expect(minifyJson('{"a":1}')).toBe('{"a":1}');
  });

  it('preserves unicode characters', () => {
    expect(minifyJson('{ "name": "café" }')).toBe('{"name":"café"}');
  });

  it('handles empty containers', () => {
    expect(minifyJson('{ }')).toBe('{}');
    expect(minifyJson('[ ]')).toBe('[]');
  });

  it('throws a SyntaxError on malformed input', () => {
    expect(() => minifyJson('{"a":}')).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => minifyJson('')).toThrow();
  });
});
