import { diff as jsondiffpatchDiff } from 'jsondiffpatch';

/**
 * Compute a structural jsondiffpatch delta between two already-parsed
 * JSON values.
 * @param {*} left
 * @param {*} right
 * @returns {object|undefined} a jsondiffpatch delta, or undefined if equal
 */
export function diffJson(left, right) {
  return jsondiffpatchDiff(left, right);
}

function describeNode(delta, path) {
  const changes = [];
  if (delta === undefined) return changes;

  if (Array.isArray(delta)) {
    if (delta.length === 1) {
      changes.push({ path, kind: 'added', newValue: delta[0] });
    } else if (delta.length === 2) {
      changes.push({ path, kind: 'modified', oldValue: delta[0], newValue: delta[1] });
    } else if (delta.length === 3) {
      if (delta[2] === 0) {
        changes.push({ path, kind: 'removed', oldValue: delta[0] });
      } else if (delta[2] === 2) {
        changes.push({ path, kind: 'modified', oldValue: undefined, newValue: delta[0] });
      } else if (delta[2] === 3) {
        changes.push({ path, kind: 'moved', toIndex: delta[1] });
      }
    }
    return changes;
  }

  if (delta && typeof delta === 'object') {
    if (delta._t === 'a') {
      for (const key of Object.keys(delta)) {
        if (key === '_t') continue;
        const isRemovalOrMove = key.startsWith('_');
        const index = isRemovalOrMove ? key.slice(1) : key;
        const childPath = `${path}[${index}]`;
        changes.push(...describeNode(delta[key], childPath));
      }
      return changes;
    }

    for (const key of Object.keys(delta)) {
      const childPath = path ? `${path}.${key}` : key;
      changes.push(...describeNode(delta[key], childPath));
    }
    return changes;
  }

  return changes;
}

/**
 * Turn a jsondiffpatch delta into a flat, readable list of changes:
 * `{ path, kind: 'added'|'removed'|'modified'|'moved', oldValue?, newValue? }`.
 * @param {object|undefined} delta
 * @returns {Array<object>}
 */
export function describeDiff(delta) {
  return describeNode(delta, '$');
}
