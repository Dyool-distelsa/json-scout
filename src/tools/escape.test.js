import { describe, it, expect } from 'vitest';
import { escapeString, unescapeString } from './escape.js';

describe('escapeString', () => {
  it('escapes double quotes and backslashes', () => {
    expect(escapeString('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeString('a\\b')).toBe('a\\\\b');
  });

  it('escapes newlines, tabs, and carriage returns', () => {
    expect(escapeString('a\nb\tc\rd')).toBe('a\\nb\\tc\\rd');
  });

  it('leaves already-plain text untouched', () => {
    expect(escapeString('hello world')).toBe('hello world');
  });

  it('handles an empty string', () => {
    expect(escapeString('')).toBe('');
  });

  it('preserves unicode characters without escaping them', () => {
    expect(escapeString('café 😀')).toBe('café 😀');
  });

  it('round-trips through escape and unescape', () => {
    const original = 'line1\nline2\t"quoted"\\end';
    expect(unescapeString(escapeString(original))).toBe(original);
  });
});

describe('unescapeString', () => {
  it('unescapes standard JSON escape sequences', () => {
    expect(unescapeString('a\\nb')).toBe('a\nb');
    expect(unescapeString('say \\"hi\\"')).toBe('say "hi"');
  });

  it('unescapes unicode escape sequences', () => {
    expect(unescapeString('caf\\u00e9')).toBe('café');
  });

  it('handles an empty string', () => {
    expect(unescapeString('')).toBe('');
  });

  it('throws on an invalid/dangling escape sequence', () => {
    expect(() => unescapeString('bad \\')).toThrow();
  });
});
