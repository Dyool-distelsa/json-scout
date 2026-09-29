import { describe, it, expect } from 'vitest';
import { parseJsonStrict, JsonSyntaxError, detectUnmatchedCloser } from './jsonParser.js';

describe('parseJsonStrict', () => {
  it('parses a simple object', () => {
    expect(parseJsonStrict('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
  });

  it('parses nested objects and arrays of objects', () => {
    expect(parseJsonStrict('{"list":[{"a":1},{"b":2}]}')).toEqual({
      list: [{ a: 1 }, { b: 2 }],
    });
  });

  it('parses deeply nested structures (50 levels)', () => {
    let value = 0;
    for (let i = 0; i < 50; i += 1) {
      value = { nested: value };
    }
    expect(parseJsonStrict(JSON.stringify(value))).toEqual(value);
  });

  it('parses unicode strings, including surrogate pairs', () => {
    expect(parseJsonStrict('{"emoji":"😀","name":"café"}')).toEqual({
      emoji: '😀',
      name: 'café',
    });
  });

  it('parses escaped unicode sequences', () => {
    expect(parseJsonStrict('{"a":"\\u00e9"}')).toEqual({ a: 'é' });
  });

  it('keeps only the last value for duplicate keys', () => {
    expect(parseJsonStrict('{"a":1,"a":2}')).toEqual({ a: 2 });
  });

  it('parses large integers with the same precision-loss behavior as JSON.parse', () => {
    expect(parseJsonStrict('{"big":12345678901234567890}')).toEqual(
      JSON.parse('{"big":12345678901234567890}')
    );
  });

  it('parses negative numbers, decimals, and exponents', () => {
    expect(parseJsonStrict('[-1, 0.5, 1e10, -2.5e-3]')).toEqual([-1, 0.5, 1e10, -2.5e-3]);
  });

  it('parses true, false, and null', () => {
    expect(parseJsonStrict('[true,false,null]')).toEqual([true, false, null]);
  });

  it('parses empty object and empty array', () => {
    expect(parseJsonStrict('{}')).toEqual({});
    expect(parseJsonStrict('[]')).toEqual([]);
  });

  it('throws JsonSyntaxError with an index on unexpected end of input', () => {
    expect(() => parseJsonStrict('')).toThrow(JsonSyntaxError);
    try {
      parseJsonStrict('');
    } catch (err) {
      expect(err.index).toBe(0);
    }
  });

  it('throws with an index pointing at a trailing comma in an object', () => {
    try {
      parseJsonStrict('{"a":1,}');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSyntaxError);
      expect(typeof err.index).toBe('number');
    }
  });

  it('rejects single-quoted keys', () => {
    expect(() => parseJsonStrict("{'a':1}")).toThrow(JsonSyntaxError);
  });

  it('rejects unquoted keys', () => {
    expect(() => parseJsonStrict('{a:1}')).toThrow(JsonSyntaxError);
  });

  it('rejects trailing commas in arrays', () => {
    expect(() => parseJsonStrict('[1,2,]')).toThrow(JsonSyntaxError);
  });

  it('rejects unterminated strings', () => {
    expect(() => parseJsonStrict('{"a":"unterminated}')).toThrow(JsonSyntaxError);
  });

  it('rejects trailing characters after a valid value', () => {
    expect(() => parseJsonStrict('{"a":1} garbage')).toThrow(JsonSyntaxError);
  });

  it('rejects a bare NaN or undefined-like token', () => {
    expect(() => parseJsonStrict('{"a":undefined}')).toThrow(JsonSyntaxError);
  });

  describe('missing opening bracket diagnostics (unmatched closer)', () => {
    // Each of these four inputs is missing an opening `[` somewhere. The
    // parser used to report a misleading downstream symptom far from the
    // real cause (see the feature doc for the "before" messages). It must
    // now report the unmatched closing bracket itself, unambiguously.
    const cases = [
      { input: '{"tags": "a","b"]}', index: 16 },
      { input: '{"n": 1,2,3]}', index: 11 },
      { input: '{"a":{"b": 1,2]}}', index: 14 },
      { input: '"a","b"]', index: 7 },
    ];

    for (const { input, index } of cases) {
      it(`reports the unmatched ']' at index ${index} for ${JSON.stringify(input)}`, () => {
        try {
          parseJsonStrict(input);
          throw new Error('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(JsonSyntaxError);
          expect(err.index).toBe(index);
          expect(err.message).toBe("Unmatched ']': missing opening '['");
        }
      });
    }

    it('does not misdiagnose the control case: a missing CLOSING bracket', () => {
      // `{"a":[1,2}` is missing `]`, not `[` — the `}` here closes the
      // outer object correctly (a `{` is open somewhere), so this must
      // NOT be reported as an unmatched closer.
      try {
        parseJsonStrict('{"a":[1,2}');
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JsonSyntaxError);
        expect(err.message).not.toMatch(/^Unmatched/);
      }
    });
  });

  describe('detectUnmatchedCloser', () => {
    it('finds the unmatched "]" and the position a missing "[" belongs at, for a top-level array value', () => {
      expect(detectUnmatchedCloser('{"tags": "a","b"]}')).toEqual({
        index: 16,
        closer: ']',
        missingOpener: '[',
        insertAt: 9,
      });
    });

    it('finds the value-start position inside a nested object', () => {
      expect(detectUnmatchedCloser('{"a":{"b": 1,2]}}')).toEqual({
        index: 14,
        closer: ']',
        missingOpener: '[',
        insertAt: 11,
      });
    });

    it('finds a document-root unmatched closer (missing leading "[")', () => {
      expect(detectUnmatchedCloser('"a","b"]')).toEqual({
        index: 7,
        closer: ']',
        missingOpener: '[',
        insertAt: 0,
      });
    });

    it('returns null when brackets are balanced (even if the JSON is otherwise invalid)', () => {
      expect(detectUnmatchedCloser('{"a":1,}')).toBeNull();
      expect(detectUnmatchedCloser('{"a":[1,2}')).toBeNull();
      expect(detectUnmatchedCloser('{{{{')).toBeNull();
    });

    it('ignores brackets that appear inside string literals', () => {
      expect(detectUnmatchedCloser('{"a":"]"}')).toBeNull();
    });
  });
});
