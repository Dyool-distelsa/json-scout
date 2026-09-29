import { describe, it, expect } from 'vitest';
import { resolveLineColumnOffset } from './editorPosition.js';

describe('resolveLineColumnOffset', () => {
  it('resolves the first character of a single-line document', () => {
    expect(resolveLineColumnOffset('hello', 1, 1)).toBe(0);
  });

  it('resolves a mid-line column', () => {
    expect(resolveLineColumnOffset('hello', 1, 3)).toBe(2);
  });

  it('resolves a position on the second line', () => {
    expect(resolveLineColumnOffset('abc\ndef', 2, 1)).toBe(4);
  });

  it('resolves a column on the second line', () => {
    expect(resolveLineColumnOffset('abc\ndef', 2, 3)).toBe(6);
  });

  it('treats CRLF as a single line boundary, matching jsonUtils.getLineColumn', () => {
    expect(resolveLineColumnOffset('abc\r\ndef', 2, 1)).toBe(5);
  });

  it('treats a lone CR as a line boundary', () => {
    expect(resolveLineColumnOffset('abc\rdef', 2, 1)).toBe(4);
  });

  it('clamps a line number beyond the document end to the last line', () => {
    expect(resolveLineColumnOffset('abc\ndef', 99, 1)).toBe(4);
  });

  it('clamps a line number below 1 to the first line', () => {
    expect(resolveLineColumnOffset('abc\ndef', 0, 1)).toBe(0);
  });

  it('clamps a column beyond the line length to the end of that line', () => {
    expect(resolveLineColumnOffset('abc\ndef', 1, 99)).toBe(3);
  });

  it('clamps a column below 1 to the start of the line', () => {
    expect(resolveLineColumnOffset('abc\ndef', 1, -5)).toBe(0);
  });

  it('handles an empty document', () => {
    expect(resolveLineColumnOffset('', 1, 1)).toBe(0);
    expect(resolveLineColumnOffset('', 5, 5)).toBe(0);
  });

  it('handles a document ending with a trailing newline', () => {
    // "abc\n" has two logical lines: "abc" and "" (the empty line after it).
    expect(resolveLineColumnOffset('abc\n', 2, 1)).toBe(4);
  });
});
