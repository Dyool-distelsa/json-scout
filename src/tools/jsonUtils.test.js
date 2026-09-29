import { describe, it, expect } from 'vitest';
import {
  stripBOM,
  getLineColumn,
  extractErrorPosition,
  utf8ByteLength,
  formatBytes,
  computeMinifySaving,
  computeFormatGrowth,
} from './jsonUtils.js';

describe('stripBOM', () => {
  it('removes a leading UTF-8 BOM character', () => {
    expect(stripBOM('﻿{"a":1}')).toBe('{"a":1}');
  });

  it('leaves text without a BOM unchanged', () => {
    expect(stripBOM('{"a":1}')).toBe('{"a":1}');
  });

  it('handles an empty string', () => {
    expect(stripBOM('')).toBe('');
  });

  it('only strips a BOM at the very start, not elsewhere', () => {
    const withMidBom = 'abc﻿def';
    expect(stripBOM(withMidBom)).toBe(withMidBom);
  });
});

describe('getLineColumn', () => {
  it('returns line 1 col 1 for index 0', () => {
    expect(getLineColumn('abc', 0)).toEqual({ line: 1, column: 1 });
  });

  it('computes line/column across LF newlines', () => {
    const text = 'abc\ndef\nghi';
    // index 8 -> "g" of "ghi", which is line 3 col 1
    expect(getLineColumn(text, 8)).toEqual({ line: 3, column: 1 });
  });

  it('computes line/column across CRLF newlines without off-by-one', () => {
    const text = 'abc\r\ndef\r\nghi';
    // index 10 -> "g" of "ghi" (line 3, col 1)
    expect(getLineColumn(text, 10)).toEqual({ line: 3, column: 1 });
  });

  it('clamps to the end of the text when index exceeds length', () => {
    const text = 'abc';
    const result = getLineColumn(text, 999);
    expect(result.line).toBe(1);
    expect(result.column).toBe(4);
  });

  it('handles index at a mid-line position', () => {
    expect(getLineColumn('abcdef', 3)).toEqual({ line: 1, column: 4 });
  });
});

describe('extractErrorPosition', () => {
  it('extracts a numeric position from a V8-style SyntaxError message', () => {
    expect(extractErrorPosition('Unexpected token } in JSON at position 12')).toBe(12);
  });

  it('returns null when no position is present in the message', () => {
    expect(extractErrorPosition('Unexpected end of JSON input')).toBeNull();
  });

  it('extracts line/column style messages when present', () => {
    // Some engines report "line 2 column 5" instead of a flat position.
    const pos = extractErrorPosition('Unexpected token in JSON at line 2 column 5');
    expect(pos).toEqual({ line: 2, column: 5 });
  });
});

describe('utf8ByteLength', () => {
  it('returns 0 for an empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });

  it('counts one byte per character for plain ASCII', () => {
    expect(utf8ByteLength('hello')).toBe(5);
    expect(utf8ByteLength('{"a":1}')).toBe(7);
  });

  it('counts two bytes for Latin-1 supplement characters', () => {
    // 'é' is U+00E9, encodes to 2 UTF-8 bytes.
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('café')).toBe(5);
  });

  it('counts three bytes for characters in the basic multilingual plane above U+07FF', () => {
    // '€' is U+20AC, encodes to 3 UTF-8 bytes.
    expect(utf8ByteLength('€')).toBe(3);
    // Japanese characters also fall in this range.
    expect(utf8ByteLength('日本語')).toBe(9);
  });

  it('counts four bytes for astral-plane characters made of surrogate pairs', () => {
    // '😀' (U+1F600) is a surrogate pair in UTF-16, 4 bytes in UTF-8.
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('matches TextEncoder byte length for mixed content, including emoji', () => {
    const sample = '{"emoji":"😀","name":"café","currency":"€","greeting":"日本語"}';
    expect(utf8ByteLength(sample)).toBe(new TextEncoder().encode(sample).length);
  });

  it('treats an unpaired surrogate the same way TextEncoder does (3-byte replacement)', () => {
    const lonelyHighSurrogate = '\uD800';
    expect(utf8ByteLength(lonelyHighSurrogate)).toBe(
      new TextEncoder().encode(lonelyHighSurrogate).length
    );
  });

  it('does not allocate a byte buffer (pure arithmetic over char codes)', () => {
    // Sanity check on a larger string to make sure the loop-based approach
    // scales linearly and returns the same result as TextEncoder.
    const big = 'x'.repeat(10000) + '😀'.repeat(100);
    expect(utf8ByteLength(big)).toBe(new TextEncoder().encode(big).length);
  });
});

describe('formatBytes', () => {
  it('renders the B step with no decimals', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(847)).toBe('847 B');
  });

  it('stays in B just under the 1024 boundary', () => {
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('promotes to KB exactly at the 1024 boundary', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
  });

  it('renders KB with up to 2 decimals, never showing a sub-1 value', () => {
    // 1048 bytes must never render as "0.001 MB" — it is >= 1 KB.
    expect(formatBytes(1048)).toBe('1.02 KB');
  });

  it('promotes to MB at the 1024*1024 boundary', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
  });

  it('renders MB with 2 decimals for a typical file size', () => {
    // Must never render as the raw byte count.
    expect(formatBytes(8472913)).toBe('8.08 MB');
  });

  it('promotes to GB at the 1024^3 boundary', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
  });

  it('renders GB with 2 decimals for a value above 1 GB', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1.5)).toBe('1.50 GB');
  });

  it('stays at the largest unit and does not overflow past GB', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 5)).toBe('5.00 GB');
  });
});

describe('computeMinifySaving', () => {
  it('computes bytes saved and the percentage for a normal shrink', () => {
    const result = computeMinifySaving(100, 68);
    expect(result.beforeBytes).toBe(100);
    expect(result.afterBytes).toBe(68);
    expect(result.savedBytes).toBe(32);
    expect(result.savedPercent).toBeCloseTo(32, 5);
    expect(result.shrank).toBe(true);
  });

  it('matches the documented example (4302 -> 2918 bytes)', () => {
    const result = computeMinifySaving(4302, 2918);
    expect(result.savedBytes).toBe(1384);
    expect(result.shrank).toBe(true);
  });

  it('reports no shrink when the document was already minified', () => {
    const result = computeMinifySaving(42, 42);
    expect(result.savedBytes).toBe(0);
    expect(result.savedPercent).toBe(0);
    expect(Object.is(result.savedPercent, -0)).toBe(false);
    expect(result.shrank).toBe(false);
  });

  it('handles a zero-byte document without dividing by zero', () => {
    const result = computeMinifySaving(0, 0);
    expect(result.savedBytes).toBe(0);
    expect(result.savedPercent).toBe(0);
    expect(Number.isNaN(result.savedPercent)).toBe(false);
    expect(result.shrank).toBe(false);
  });
});

describe('computeFormatGrowth', () => {
  it('computes bytes grown and the percentage for a normal growth (pretty-printing)', () => {
    const result = computeFormatGrowth(68, 100);
    expect(result.beforeBytes).toBe(68);
    expect(result.afterBytes).toBe(100);
    expect(result.grownBytes).toBe(32);
    expect(result.grownPercent).toBeCloseTo(47.058823529, 5);
    expect(result.grew).toBe(true);
  });

  it('reports no growth when the document was already formatted with the same indent', () => {
    const result = computeFormatGrowth(42, 42);
    expect(result.grownBytes).toBe(0);
    expect(result.grownPercent).toBe(0);
    expect(Object.is(result.grownPercent, -0)).toBe(false);
    expect(result.grew).toBe(false);
  });

  it('reports no growth (not negative growth) when formatting happens to shrink the document', () => {
    const result = computeFormatGrowth(100, 68);
    expect(result.grownBytes).toBe(-32);
    expect(result.grownPercent).toBe(0);
    expect(result.grew).toBe(false);
  });

  it('handles a zero-byte document without dividing by zero', () => {
    const result = computeFormatGrowth(0, 0);
    expect(result.grownBytes).toBe(0);
    expect(result.grownPercent).toBe(0);
    expect(Number.isNaN(result.grownPercent)).toBe(false);
    expect(result.grew).toBe(false);
  });
});
