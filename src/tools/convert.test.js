import { describe, it, expect } from 'vitest';
import { jsonToYaml, yamlToJson, jsonToCsv, flattenObject } from './convert.js';
import YAML from 'yaml';

describe('jsonToYaml', () => {
  it('converts a flat object to YAML that round-trips back to the same value', () => {
    const yamlText = jsonToYaml('{"a":1,"b":"hello"}');
    expect(YAML.parse(yamlText)).toEqual({ a: 1, b: 'hello' });
  });

  it('converts nested objects and arrays', () => {
    const yamlText = jsonToYaml('{"list":[1,2,{"x":true}]}');
    expect(YAML.parse(yamlText)).toEqual({ list: [1, 2, { x: true }] });
  });

  it('preserves unicode content', () => {
    const yamlText = jsonToYaml('{"name":"café"}');
    expect(YAML.parse(yamlText)).toEqual({ name: 'café' });
  });

  it('strips a leading BOM before converting', () => {
    const yamlText = jsonToYaml('﻿{"a":1}');
    expect(YAML.parse(yamlText)).toEqual({ a: 1 });
  });

  it('throws on malformed JSON input', () => {
    expect(() => jsonToYaml('{"a":}')).toThrow();
  });
});

describe('yamlToJson', () => {
  it('converts a flat YAML mapping to a JSON string', () => {
    const json = yamlToJson('a: 1\nb: hello\n');
    expect(JSON.parse(json)).toEqual({ a: 1, b: 'hello' });
  });

  it('converts YAML sequences and nested mappings', () => {
    const json = yamlToJson('list:\n  - 1\n  - 2\n  - x: true\n');
    expect(JSON.parse(json)).toEqual({ list: [1, 2, { x: true }] });
  });

  it('formats the resulting JSON with the requested indent', () => {
    const json = yamlToJson('a: 1\n', { indent: 4 });
    expect(json).toBe('{\n    "a": 1\n}');
  });

  it('throws on malformed YAML input', () => {
    expect(() => yamlToJson('a: [1, 2\n')).toThrow();
  });
});

describe('flattenObject', () => {
  it('flattens nested objects using dot notation', () => {
    expect(flattenObject({ a: 1, nested: { x: 2, y: 3 } })).toEqual({
      a: 1,
      'nested.x': 2,
      'nested.y': 3,
    });
  });

  it('flattens arrays using numeric dot notation', () => {
    expect(flattenObject({ tags: ['x', 'y'] })).toEqual({ 'tags.0': 'x', 'tags.1': 'y' });
  });

  it('flattens arrays of nested objects', () => {
    expect(flattenObject({ items: [{ a: 1 }, { a: 2 }] })).toEqual({
      'items.0.a': 1,
      'items.1.a': 2,
    });
  });

  it('handles an empty object', () => {
    expect(flattenObject({})).toEqual({});
  });
});

describe('jsonToCsv', () => {
  it('converts an array of flat objects into CSV rows', () => {
    const csv = jsonToCsv('[{"a":1,"b":2},{"a":3,"b":4}]');
    expect(csv).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('flattens nested objects into dot-notation columns', () => {
    const csv = jsonToCsv('[{"a":1,"nested":{"x":2,"y":3}}]');
    expect(csv).toBe('a,nested.x,nested.y\r\n1,2,3');
  });

  it('flattens array-valued fields into indexed columns', () => {
    const csv = jsonToCsv('[{"tags":["x","y"]}]');
    expect(csv).toBe('tags.0,tags.1\r\nx,y');
  });

  it('unions columns across rows with different shapes, leaving gaps blank', () => {
    const csv = jsonToCsv('[{"a":1},{"b":2}]');
    const lines = csv.split('\r\n');
    expect(lines[0].split(',').sort()).toEqual(['a', 'b']);
  });

  it('quotes values containing commas or quotes', () => {
    const csv = jsonToCsv('[{"a":"hello, world"}]');
    expect(csv).toBe('a\r\n"hello, world"');
  });

  it('wraps a single top-level object into a one-row CSV', () => {
    const csv = jsonToCsv('{"a":1,"b":2}');
    expect(csv).toBe('a,b\r\n1,2');
  });

  it('throws on malformed JSON input', () => {
    expect(() => jsonToCsv('{"a":}')).toThrow();
  });
});
