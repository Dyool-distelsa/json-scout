import { stripBOM, utf8ByteLength } from './jsonUtils.js';

/**
 * @typedef {{ string: number, number: number, boolean: number, null: number, object: number, array: number }} TypeHistogram
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object'
}

function walk(value, depth, acc) {
  acc.maxDepth = Math.max(acc.maxDepth, depth);
  const type = typeOf(value);
  acc.typeHistogram[type] += 1;

  if (type === 'array') {
    acc.arrayCount += 1;
    for (const item of value) {
      walk(item, depth + 1, acc);
    }
  } else if (type === 'object') {
    const keys = Object.keys(value);
    acc.totalKeys += keys.length;
    for (const key of keys) {
      walk(value[key], depth + 1, acc);
    }
  }
}

function computeStatsCore(parsed, cleaned) {
  const byteSize = utf8ByteLength(cleaned);
  const lineCount = cleaned.split(/\r\n|\r|\n/).length;

  const acc = {
    maxDepth: 0,
    totalKeys: 0,
    arrayCount: 0,
    typeHistogram: { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 },
  };
  walk(parsed, 1, acc);

  return {
    byteSize,
    lineCount,
    maxDepth: acc.maxDepth,
    totalKeys: acc.totalKeys,
    arrayCount: acc.arrayCount,
    typeHistogram: acc.typeHistogram,
  };
}

/**
 * Compute size/shape statistics for a JSON document.
 * @param {string} text
 * @returns {{
 *   byteSize: number,
 *   lineCount: number,
 *   maxDepth: number,
 *   totalKeys: number,
 *   arrayCount: number,
 *   typeHistogram: TypeHistogram
 * }}
 * @throws {SyntaxError} if the input is not valid JSON
 */
export function computeStats(text) {
  const cleaned = stripBOM(text ?? '');
  const parsed = JSON.parse(cleaned);
  return computeStatsCore(parsed, cleaned);
}

/**
 * Same as `computeStats`, but for a caller that already parsed the text
 * (e.g. as part of a shared validate/tree/stats refresh cycle) and wants
 * to avoid paying for a second `JSON.parse` of the same document.
 * @param {*} value - an already-parsed JSON value
 * @param {string} text - the original (possibly BOM-prefixed) source text
 * @returns {{
 *   byteSize: number,
 *   lineCount: number,
 *   maxDepth: number,
 *   totalKeys: number,
 *   arrayCount: number,
 *   typeHistogram: TypeHistogram
 * }}
 */
export function computeStatsFromValue(value, text) {
  const cleaned = stripBOM(text ?? '');
  return computeStatsCore(value, cleaned);
}
