import { describe, it, expect } from 'vitest';
import { buildTree, pathToString } from './tree.js';

describe('buildTree', () => {
  it('builds a leaf node for a scalar value', () => {
    const node = buildTree(42);
    expect(node).toEqual({ key: '$', type: 'number', path: '$', value: 42 });
  });

  it('builds children for a flat object', () => {
    const node = buildTree({ a: 1, b: 'hello' });
    expect(node.type).toBe('object');
    expect(node.children).toHaveLength(2);
    expect(node.children[0]).toEqual({ key: 'a', type: 'number', path: '$.a', value: 1 });
    expect(node.children[1]).toEqual({ key: 'b', type: 'string', path: '$.b', value: 'hello' });
  });

  it('builds indexed children for an array', () => {
    const node = buildTree([10, 20]);
    expect(node.type).toBe('array');
    expect(node.children[0]).toEqual({ key: '0', type: 'number', path: '$[0]', value: 10 });
    expect(node.children[1]).toEqual({ key: '1', type: 'number', path: '$[1]', value: 20 });
  });

  it('builds a nested tree with objects inside arrays', () => {
    const node = buildTree({ list: [{ a: 1 }] });
    const listNode = node.children[0];
    expect(listNode.path).toBe('$.list');
    const itemNode = listNode.children[0];
    expect(itemNode.path).toBe('$.list[0]');
    const aNode = itemNode.children[0];
    expect(aNode).toEqual({ key: 'a', type: 'number', path: '$.list[0].a', value: 1 });
  });

  it('marks null as its own type rather than "object"', () => {
    const node = buildTree({ a: null });
    expect(node.children[0].type).toBe('null');
    expect(node.children[0].value).toBe(null);
  });

  it('handles empty objects and arrays as childless containers', () => {
    expect(buildTree({}).children).toEqual([]);
    expect(buildTree([]).children).toEqual([]);
  });

  it('handles deeply nested structures without error', () => {
    let value = 0;
    for (let i = 0; i < 30; i += 1) {
      value = { nested: value };
    }
    const node = buildTree(value);
    let cursor = node;
    let depth = 0;
    while (cursor.children) {
      cursor = cursor.children[0];
      depth += 1;
    }
    expect(depth).toBe(30);
  });
});

describe('pathToString', () => {
  it('joins simple identifier keys with dot notation', () => {
    expect(pathToString(['$', 'a', 'b'])).toBe('$.a.b');
  });

  it('uses bracket notation for array indices', () => {
    expect(pathToString(['$', 'list', 0, 'name'])).toBe('$.list[0].name');
  });

  it('uses quoted bracket notation for keys that are not valid identifiers', () => {
    expect(pathToString(['$', 'foo-bar'])).toBe('$["foo-bar"]');
  });

  it('handles a bare root path', () => {
    expect(pathToString(['$'])).toBe('$');
  });
});
