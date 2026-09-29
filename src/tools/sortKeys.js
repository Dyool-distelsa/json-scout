/**
 * Recursively sort object keys alphabetically. Arrays keep their order,
 * but any objects found inside them are also sorted. Returns a new
 * value; the input is never mutated.
 * @param {*} value
 * @returns {*}
 */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    const result = {};
    for (const key of sortedKeys) {
      result[key] = sortKeysDeep(value[key]);
    }
    return result;
  }
  return value;
}
