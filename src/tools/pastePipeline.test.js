import { describe, it, expect } from 'vitest';
import { processPastedJson } from './pastePipeline.js';

describe('processPastedJson', () => {
  it('sorts and formats valid input without marking it as repaired', () => {
    const result = processPastedJson('{"b":1,"a":2}', { indent: 2 });
    expect(result).toEqual({
      ok: true,
      text: '{\n  "a": 2,\n  "b": 1\n}',
      steps: ['sorted', 'formatted'],
    });
  });

  it('repairs trailing commas, single quotes and sorts (acceptance example)', () => {
    const result = processPastedJson("{'b':1,'a':[1,2,],}", { indent: 2 });
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual(['repaired', 'sorted', 'formatted']);
    expect(result.text).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": 1\n}');
    expect(() => JSON.parse(result.text)).not.toThrow();
  });

  it('repairs unquoted keys', () => {
    const result = processPastedJson('{name: "x", age: 3}', { indent: 2 });
    expect(result.ok).toBe(true);
    expect(result.steps).toContain('repaired');
    expect(JSON.parse(result.text)).toEqual({ age: 3, name: 'x' });
    expect(Object.keys(JSON.parse(result.text))).toEqual(['age', 'name']);
  });

  it('sorts nested keys, including objects inside arrays', () => {
    const result = processPastedJson('{"z":{"d":1,"a":2},"a":[{"y":1,"x":2}]}', { indent: 2 });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.text);
    expect(Object.keys(parsed)).toEqual(['a', 'z']);
    expect(Object.keys(parsed.z)).toEqual(['a', 'd']);
    expect(Object.keys(parsed.a[0])).toEqual(['x', 'y']);
  });

  it('keeps array order', () => {
    const result = processPastedJson('[3,1,2]', { indent: 2 });
    expect(JSON.parse(result.text)).toEqual([3, 1, 2]);
  });

  it.each([
    [2, '{\n  "a": 1\n}'],
    [4, '{\n    "a": 1\n}'],
    ['tab', '{\n\t"a": 1\n}'],
  ])('formats with indent %s', (indent, expected) => {
    expect(processPastedJson('{"a":1}', { indent })).toMatchObject({ ok: true, text: expected });
  });

  it('defaults to 2 spaces when no indent is given', () => {
    expect(processPastedJson('{"a":1}').text).toBe('{\n  "a": 1\n}');
  });

  it('ignores a leading BOM', () => {
    const result = processPastedJson('﻿{"b":1,"a":2}', { indent: 2 });
    expect(result.ok).toBe(true);
    expect(result.text.startsWith('{')).toBe(true);
  });

  it('defined behaviour: empty or whitespace-only input is not ok and returned untouched', () => {
    for (const input of ['', '   \n\t ']) {
      const result = processPastedJson(input, { indent: 2 });
      expect(result.ok).toBe(false);
      expect(result.text).toBe(input);
      expect(typeof result.error).toBe('string');
    }
  });

  it('defined behaviour: plain text that repair would turn into a bare string is not ok', () => {
    const input = 'this is not json at all';
    const result = processPastedJson(input, { indent: 2 });
    expect(result.ok).toBe(false);
    expect(result.text).toBe(input);
  });

  it('returns the original text untouched when it cannot be repaired', () => {
    const input = '{"a": ]]] nope [[[';
    const result = processPastedJson(input, { indent: 2 });
    expect(result.ok).toBe(false);
    expect(result.text).toBe(input);
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('accepts valid top-level primitives without treating them as repaired', () => {
    expect(processPastedJson('42', { indent: 2 })).toMatchObject({
      ok: true,
      text: '42',
      steps: ['sorted', 'formatted'],
    });
  });
});
