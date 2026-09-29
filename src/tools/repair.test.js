import { describe, it, expect } from 'vitest';
import { repairJson } from './repair.js';

describe('repairJson', () => {
  it('removes a trailing comma in an object', () => {
    expect(repairJson('{"a":1,"b":2,}')).toBe('{"a":1,"b":2}');
  });

  it('removes a trailing comma in an array', () => {
    expect(repairJson('[1,2,3,]')).toBe('[1,2,3]');
  });

  it('converts single-quoted strings to double-quoted', () => {
    expect(repairJson("{'a':1}")).toBe('{"a":1}');
  });

  it('quotes unquoted object keys', () => {
    expect(repairJson('{a:1,b:2}')).toBe('{"a":1,"b":2}');
  });

  it('closes a missing closing bracket', () => {
    expect(repairJson('{"a":1')).toBe('{"a":1}');
  });

  it('closes a missing closing square bracket', () => {
    expect(repairJson('[1,2,3')).toBe('[1,2,3]');
  });

  it('strips single-line comments', () => {
    const result = repairJson('{\n  "a": 1 // comment\n}');
    expect(JSON.parse(result)).toEqual({ a: 1 });
    expect(result).not.toContain('comment');
  });

  it('strips block comments', () => {
    expect(repairJson('{ "a": 1 /* comment */ }')).toBe('{ "a": 1  }');
  });

  it('wraps newline-delimited JSON objects into an array', () => {
    const ndjson = '{"a":1}\n{"a":2}\n{"a":3}';
    const result = repairJson(ndjson);
    expect(JSON.parse(result)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('strips a leading BOM before repairing', () => {
    expect(repairJson('﻿{"a":1,}')).toBe('{"a":1}');
  });

  it('produces text that JSON.parse can read back for a repaired document', () => {
    const repaired = repairJson("{a:1,'b':2,}");
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  it('throws on input that cannot be repaired at all', () => {
    expect(() => repairJson('{{{{')).toThrow();
  });

  describe('missing opening bracket repair', () => {
    // Table from the feature doc: jsonrepair throws its own internal
    // "Colon expected at position N" on three of these, and the fourth
    // (top-level) already worked. repairJson must now insert the missing
    // `[` at the point the value list actually begins and let jsonrepair
    // finish, producing valid, parseable JSON for all four.
    const cases = [
      { input: '{"tags": "a","b"]}', expected: { tags: ['a', 'b'] } },
      { input: '{"n": 1,2,3]}', expected: { n: [1, 2, 3] } },
      { input: '{"a":{"b": 1,2]}}', expected: { a: { b: [1, 2] } } },
      { input: '"a","b"]', expected: ['a', 'b'] },
    ];

    for (const { input, expected } of cases) {
      it(`repairs ${JSON.stringify(input)} into valid JSON instead of throwing`, () => {
        const repaired = repairJson(input);
        expect(() => JSON.parse(repaired)).not.toThrow();
        expect(JSON.parse(repaired)).toEqual(expected);
      });
    }

    it('does not regress the control case (missing CLOSING bracket)', () => {
      expect(JSON.parse(repairJson('{"a":[1,2}'))).toEqual({ a: [1, 2] });
    });
  });
});
