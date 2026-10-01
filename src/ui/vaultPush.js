/**
 * Pure helpers behind the push review dialog: how loudly to warn for an
 * environment, when a typed confirmation is needed and how a change is shown
 * without revealing the values in it. No DOM, no Tauri, no storage. Unit
 * tested in vaultPush.test.js.
 */

import { diffJson, describeDiff } from '../tools/diff.js';

/** What stands in for a value until the user asks to see it. A fixed length, so it says nothing about the value. */
export const MASK = '••••••';

/** Most rows a dialog renders; the rest are counted, not drawn. */
export const DEFAULT_ROW_LIMIT = 200;

/** A displayed value is cut here so one huge string cannot flood the dialog. */
const MAX_VALUE_LENGTH = 120;

/** Above this many line pairs the line diff is not computed exactly. */
const MAX_LINE_PAIRS = 4_000_000;

const ENVIRONMENTS = Object.freeze({
  dev: Object.freeze({ id: 'dev', label: 'Development', short: 'DEV', tone: 'neutral' }),
  qa: Object.freeze({ id: 'qa', label: 'QA', short: 'QA', tone: 'caution' }),
  stg: Object.freeze({ id: 'stg', label: 'Staging', short: 'STG', tone: 'caution' }),
  prod: Object.freeze({ id: 'prod', label: 'Production', short: 'PROD', tone: 'danger' }),
  unknown: Object.freeze({
    id: 'unknown',
    label: 'Unknown environment',
    short: 'UNKNOWN',
    tone: 'danger',
  }),
});

/**
 * How the dialog presents an environment. Anything unrecognised is treated as
 * unknown, which is as cautious as production.
 * @param {unknown} environment `dev|qa|stg|prod|unknown` from `vault_push_preview`
 * @returns {{ id: string, label: string, short: string, tone: 'neutral'|'caution'|'danger' }}
 */
export function environmentStyle(environment) {
  const known =
    typeof environment === 'string' && Object.prototype.hasOwnProperty.call(ENVIRONMENTS, environment);
  return ENVIRONMENTS[known ? environment : 'unknown'];
}

/**
 * Production and unknown vaults make the user type the secret's name before a
 * push; so does a value this code does not recognise.
 * @param {unknown} environment
 * @returns {boolean}
 */
export function requiresTypedConfirmation(environment) {
  return environmentStyle(environment).tone === 'danger';
}

/**
 * Whether the confirm control may be enabled. A typed confirmation must equal
 * the secret name exactly: case and surrounding spaces count.
 * @param {unknown} environment
 * @param {unknown} typed what is in the confirmation field
 * @param {unknown} name the secret's name
 * @returns {boolean}
 */
export function canConfirm(environment, typed, name) {
  if (typeof name !== 'string' || name === '') return false;
  if (!requiresTypedConfirmation(environment)) return true;
  return typeof typed === 'string' && typed === name;
}

/**
 * The mask shown instead of a present value; nothing for an absent one.
 * @param {unknown} value
 * @returns {string}
 */
export function maskValue(value) {
  return value === undefined ? '' : MASK;
}

function shorten(text) {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

function displayValue(value) {
  const text = JSON.stringify(value);
  return text === undefined ? '' : shorten(text);
}

/** One side of a changed line: the line as it is, and its mask. */
function lineCell(text) {
  return { text: shorten(text), masked: MASK };
}

/** One side of a changed row: the real text (shown only on request) and its mask. */
function cell(value) {
  return value === undefined ? null : { text: displayValue(value), masked: maskValue(value) };
}

function parseJson(text) {
  if (typeof text !== 'string') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function emptyCounts() {
  return { added: 0, removed: 0, changed: 0, moved: 0 };
}

const KIND_OF_DIFF = { added: 'added', removed: 'removed', modified: 'changed', moved: 'moved' };

/**
 * The key-level differences between two JSON texts, built on `diffJson`. The
 * values are for display only (a parsed number loses its exact spelling);
 * what is pushed is decided by the backend.
 * @param {string} fromText
 * @param {string} toText
 * @param {{ limit?: number }} [options]
 * @returns {{ ok: false } | { ok: true, rows: Array<{
 *   path: string, kind: 'added'|'removed'|'changed'|'moved',
 *   before: {text: string, masked: string}|null, after: {text: string, masked: string}|null }>,
 *   total: number, truncated: boolean }}
 */
export function diffRows(fromText, toText, { limit = DEFAULT_ROW_LIMIT } = {}) {
  const from = parseJson(fromText);
  const to = parseJson(toText);
  if (!from.ok || !to.ok) return { ok: false };

  const all = describeDiff(diffJson(from.value, to.value)).map((change) => {
    const kind = KIND_OF_DIFF[change.kind] ?? 'changed';
    return {
      path: change.path,
      kind,
      before: kind === 'moved' ? null : cell(change.oldValue),
      after: kind === 'moved' ? null : cell(change.newValue),
    };
  });
  const counts = emptyCounts();
  for (const row of all) counts[row.kind] += 1;
  return {
    ok: true,
    rows: all.slice(0, Math.max(0, limit)),
    total: all.length,
    truncated: all.length > limit,
    counts,
  };
}

function splitLines(text) {
  return String(text ?? '').split(/\r?\n/);
}

/**
 * The lines removed and added between two texts, with their line numbers.
 * Common lines at the start and end are skipped; the lines in between are
 * matched exactly unless there are too many to compare pairwise, in which
 * case the middle is reported as removed and then added.
 * @param {string} fromText
 * @param {string} toText
 * @param {{ limit?: number }} [options]
 * @returns {{ ok: true, rows: Array<{ kind: 'added'|'removed', line: number,
 *   before: {text: string, masked: string}|null, after: {text: string, masked: string}|null }>,
 *   total: number, truncated: boolean }}
 */
export function lineRows(fromText, toText, { limit = DEFAULT_ROW_LIMIT } = {}) {
  const a = splitLines(fromText);
  const b = splitLines(toText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const rows = [];
  const counts = emptyCounts();
  let total = 0;
  const push = (kind, line, text) => {
    total += 1;
    counts[kind] += 1;
    if (rows.length >= limit) return;
    rows.push(
      kind === 'removed'
        ? { kind, line, before: lineCell(text), after: null }
        : { kind, line, before: null, after: lineCell(text) }
    );
  };

  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_LINE_PAIRS) {
    for (let i = 0; i < n; i += 1) push('removed', start + i + 1, a[start + i]);
    for (let j = 0; j < m; j += 1) push('added', start + j + 1, b[start + j]);
  } else {
    // lcs[i][j]: length of the longest common subsequence of a[i..] and b[j..].
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i * width + j] =
          a[start + i] === b[start + j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        i += 1;
        j += 1;
      } else if (j >= m || (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
        push('removed', start + i + 1, a[start + i]);
        i += 1;
      } else {
        push('added', start + j + 1, b[start + j]);
        j += 1;
      }
    }
  }
  return { ok: true, rows, total, truncated: total > rows.length, counts };
}

function withoutOk({ rows, total, truncated, counts }) {
  return { rows, total, truncated, counts };
}

/**
 * The changes between two versions of a secret, ready to list: key by key for
 * JSON, line by line for text and for JSON that cannot be parsed.
 * @param {'json'|'text'|string} format
 * @param {string} fromText
 * @param {string} toText
 * @param {{ limit?: number }} [options]
 * @returns {{ mode: 'keys'|'lines', rows: object[], total: number, truncated: boolean }}
 */
export function changeRows(format, fromText, toText, options) {
  if (format === 'json') {
    const keys = diffRows(fromText, toText, options);
    if (keys.ok) return { mode: 'keys', ...withoutOk(keys) };
  }
  const lines = lineRows(fromText, toText, options);
  return { mode: 'lines', ...withoutOk(lines) };
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * One line that says what a list of changes amounts to. The counts cover every
 * change, including those that are not drawn.
 * @param {{ mode: 'keys'|'lines', rows: object[], total: number, truncated: boolean,
 *   counts: { added: number, removed: number, changed: number, moved: number } }} change
 * @returns {string}
 */
export function changeSummary(change) {
  if (change.total === 0) {
    return change.mode === 'keys'
      ? 'No key-level changes (formatting or key order only)'
      : 'No line changes';
  }
  const { added, removed, changed, moved } = change.counts;
  const parts = [];
  if (change.mode === 'keys') {
    if (added) parts.push(`${added} added`);
    if (changed) parts.push(`${changed} changed`);
    if (removed) parts.push(`${removed} removed`);
    if (moved) parts.push(`${moved} moved`);
  } else {
    if (added) parts.push(`${plural(added, 'line', 'lines')} added`);
    if (removed) parts.push(`${plural(removed, 'line', 'lines')} removed`);
  }
  const text = parts.join(' · ');
  return change.truncated ? `${text} (showing ${change.rows.length})` : text;
}

/**
 * The first 8 characters of a version id.
 * @param {unknown} version
 * @returns {string}
 */
export function shortVersion(version) {
  return typeof version === 'string' ? version.slice(0, 8) : '';
}

/**
 * Success toast for a push: the name and the short new version, never a value.
 * @param {string} name
 * @param {unknown} newVersion
 * @returns {string}
 */
export function pushSuccessMessage(name, newVersion) {
  const short = shortVersion(newVersion);
  if (short === '') return `Pushed ${name}`;
  const ellipsis = newVersion.length > short.length ? '…' : '';
  return `Pushed ${name} (v ${short}${ellipsis})`;
}
