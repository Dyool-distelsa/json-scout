import { describe, it, expect } from 'vitest';
import { parseDocument } from './parseDocument.js';

describe('parseDocument', () => {
  it('parses valid JSON and locates an error precisely', () => {
    expect(parseDocument('{"a":[1,2]}')).toEqual({ valid: true, value: { a: [1, 2] } });
    const bad = parseDocument('{\n  "a": 1,\n}');
    expect(bad.valid).toBe(false);
    expect(bad.error.line).toBe(3);
  });

  it('returns the same result for the same text without parsing again', () => {
    const text = '{"big":true}';
    expect(parseDocument(text)).toBe(parseDocument(`${text}`));
    expect(parseDocument('{"big":false}')).not.toBe(parseDocument(text));
  });
});
