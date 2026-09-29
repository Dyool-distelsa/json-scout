import YAML from 'yaml';
import { stripBOM } from './jsonUtils.js';

/**
 * Convert JSON text to a YAML document.
 * @param {string} text
 * @param {{ indent?: number }} [options]
 * @returns {string}
 */
export function jsonToYaml(text, options = {}) {
  const cleaned = stripBOM(text ?? '');
  const parsed = JSON.parse(cleaned);
  return YAML.stringify(parsed, { indent: options.indent ?? 2 });
}

/**
 * Convert a YAML document to JSON text.
 * @param {string} text
 * @param {{ indent?: 2 | 4 | 'tab' }} [options]
 * @returns {string}
 */
export function yamlToJson(text, options = {}) {
  const cleaned = stripBOM(text ?? '');
  const parsed = YAML.parse(cleaned);
  const { indent = 2 } = options;
  const space = indent === 'tab' ? '\t' : indent;
  return JSON.stringify(parsed, null, space);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flattenValue(value, prefix, out) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      if (prefix !== '') out[prefix] = '';
      return;
    }
    for (const key of keys) {
      flattenValue(value[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix !== '') out[prefix] = '';
      return;
    }
    value.forEach((item, index) => {
      flattenValue(item, prefix ? `${prefix}.${index}` : String(index), out);
    });
    return;
  }
  out[prefix] = value;
}

/**
 * Flatten a nested object into a single-level object using dot notation
 * for nested keys and array indices, e.g. `{ a: { b: 1 } }` becomes
 * `{ "a.b": 1 }`.
 * @param {object} obj
 * @returns {Record<string, *>}
 */
export function flattenObject(obj) {
  const out = {};
  flattenValue(obj, '', out);
  return out;
}

function csvEscape(value) {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (/["\r\n,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert JSON text to CSV. A top-level array of objects becomes one row
 * per element; a single top-level object becomes a single-row CSV.
 * Nested objects/arrays are flattened with dot notation.
 * @param {string} text
 * @returns {string} CSV text using CRLF line endings
 */
export function jsonToCsv(text) {
  const cleaned = stripBOM(text ?? '');
  const parsed = JSON.parse(cleaned);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const flatRows = rows.map((row) => flattenObject(isPlainObject(row) ? row : { value: row }));

  const headerSet = new Set();
  flatRows.forEach((row) => Object.keys(row).forEach((key) => headerSet.add(key)));
  const headers = [...headerSet];

  const lines = [headers.map(csvEscape).join(',')];
  flatRows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  });

  return lines.join('\r\n');
}
