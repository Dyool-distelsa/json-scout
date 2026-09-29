import { describe, it, expect } from 'vitest';
import { validateJson } from './validate.js';

describe('validateJson', () => {
  it('reports valid: true for well-formed JSON', () => {
    expect(validateJson('{"a":1}')).toEqual({ valid: true });
  });

  it('reports valid: true for a BOM-prefixed, otherwise valid document', () => {
    expect(validateJson('﻿{"a":1}')).toEqual({ valid: true });
  });

  it('reports an error with line and column for malformed JSON', () => {
    const result = validateJson('{\n  "a": 1,\n  "b":\n}');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(typeof result.error.message).toBe('string');
    expect(typeof result.error.line).toBe('number');
    expect(typeof result.error.column).toBe('number');
    expect(result.error.line).toBeGreaterThanOrEqual(1);
    expect(result.error.column).toBeGreaterThanOrEqual(1);
  });

  it('reports line 1 column 1 for empty input', () => {
    const result = validateJson('');
    expect(result.valid).toBe(false);
    expect(result.error.line).toBe(1);
    expect(result.error.column).toBe(1);
  });

  it('correctly locates an error on the second line', () => {
    const result = validateJson('{\n  "a": ,\n}');
    expect(result.valid).toBe(false);
    expect(result.error.line).toBe(2);
  });

  it('handles CRLF input when locating the error line', () => {
    const result = validateJson('{\r\n  "a": ,\r\n}');
    expect(result.valid).toBe(false);
    expect(result.error.line).toBe(2);
  });

  it('flags trailing commas as invalid', () => {
    const result = validateJson('{"a":1,}');
    expect(result.valid).toBe(false);
  });

  it('flags single-quoted strings as invalid', () => {
    const result = validateJson("{'a':1}");
    expect(result.valid).toBe(false);
  });

  it('validates deeply nested structures as valid', () => {
    let value = 0;
    for (let i = 0; i < 50; i += 1) {
      value = { nested: value };
    }
    expect(validateJson(JSON.stringify(value))).toEqual({ valid: true });
  });

  it('validates an array of objects as valid', () => {
    expect(validateJson('[{"a":1},{"b":2}]')).toEqual({ valid: true });
  });

  describe('missing opening bracket diagnostics', () => {
    // Table from the feature doc: each input is missing a `[`. Verify the
    // validator now names the missing opener and points at the unmatched
    // closer, at line 1 (all fixtures are single-line).
    const cases = [
      { input: '{"tags": "a","b"]}', column: 17 },
      { input: '{"n": 1,2,3]}', column: 12 },
      { input: '{"a":{"b": 1,2]}}', column: 15 },
      { input: '"a","b"]', column: 8 },
    ];

    for (const { input, column } of cases) {
      it(`reports line 1, column ${column} and names the missing '[' for ${JSON.stringify(input)}`, () => {
        const result = validateJson(input);
        expect(result.valid).toBe(false);
        expect(result.error.line).toBe(1);
        expect(result.error.column).toBe(column);
        expect(result.error.message).toBe("Unmatched ']': missing opening '['");
      });
    }

    it('leaves the control case (missing CLOSING bracket) with its own message', () => {
      const result = validateJson('{"a":[1,2}');
      expect(result.valid).toBe(false);
      expect(result.error.message).not.toMatch(/^Unmatched/);
    });
  });
});
