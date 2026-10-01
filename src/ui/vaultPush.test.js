import { describe, it, expect } from 'vitest';
import {
  MASK,
  environmentStyle,
  requiresTypedConfirmation,
  canConfirm,
  maskValue,
  diffRows,
  lineRows,
  changeRows,
  changeSummary,
  shortVersion,
  pushSuccessMessage,
} from './vaultPush.js';

describe('environmentStyle', () => {
  it('keeps dev neutral, flags qa and stg as caution, and prod and unknown as danger', () => {
    expect(environmentStyle('dev').tone).toBe('neutral');
    expect(environmentStyle('qa').tone).toBe('caution');
    expect(environmentStyle('stg').tone).toBe('caution');
    expect(environmentStyle('prod').tone).toBe('danger');
    expect(environmentStyle('unknown').tone).toBe('danger');
  });

  it('names every environment for people', () => {
    expect(environmentStyle('dev')).toMatchObject({ id: 'dev', label: 'Development', short: 'DEV' });
    expect(environmentStyle('qa')).toMatchObject({ id: 'qa', label: 'QA', short: 'QA' });
    expect(environmentStyle('stg')).toMatchObject({ id: 'stg', label: 'Staging', short: 'STG' });
    expect(environmentStyle('prod')).toMatchObject({ id: 'prod', label: 'Production', short: 'PROD' });
    expect(environmentStyle('unknown')).toMatchObject({
      id: 'unknown',
      label: 'Unknown environment',
      short: 'UNKNOWN',
    });
  });

  it('treats anything it does not recognise as unknown (never as a safe environment)', () => {
    for (const value of [undefined, null, '', 'DEV', 'production', 42, {}, 'main']) {
      expect(environmentStyle(value).id, String(value)).toBe('unknown');
      expect(environmentStyle(value).tone).toBe('danger');
    }
  });
});

describe('requiresTypedConfirmation', () => {
  it('is required for prod and unknown only', () => {
    expect(requiresTypedConfirmation('prod')).toBe(true);
    expect(requiresTypedConfirmation('unknown')).toBe(true);
    for (const env of ['dev', 'qa', 'stg']) expect(requiresTypedConfirmation(env), env).toBe(false);
  });

  it('is required for a value it does not recognise', () => {
    expect(requiresTypedConfirmation(undefined)).toBe(true);
    expect(requiresTypedConfirmation('staging')).toBe(true);
  });
});

describe('canConfirm', () => {
  it('needs no typing outside prod and unknown', () => {
    expect(canConfirm('dev', '', 'cfg')).toBe(true);
    expect(canConfirm('qa', 'whatever', 'cfg')).toBe(true);
    expect(canConfirm('stg', '', 'cfg')).toBe(true);
  });

  it('needs the secret name typed exactly for prod and unknown', () => {
    expect(canConfirm('prod', 'cfg', 'cfg')).toBe(true);
    expect(canConfirm('unknown', 'cfg', 'cfg')).toBe(true);
    expect(canConfirm('prod', '', 'cfg')).toBe(false);
    expect(canConfirm('prod', 'cf', 'cfg')).toBe(false);
    expect(canConfirm('prod', 'CFG', 'cfg')).toBe(false);
    expect(canConfirm('prod', ' cfg', 'cfg')).toBe(false);
    expect(canConfirm('prod', 'cfg ', 'cfg')).toBe(false);
    expect(canConfirm('prod', 'cfgx', 'cfg')).toBe(false);
  });

  it('never confirms an empty or missing name, whatever was typed', () => {
    expect(canConfirm('prod', '', '')).toBe(false);
    expect(canConfirm('prod', undefined, undefined)).toBe(false);
    expect(canConfirm('dev', '', '')).toBe(false);
  });

  it('never trusts a non-string typed value', () => {
    expect(canConfirm('prod', null, 'cfg')).toBe(false);
    expect(canConfirm('prod', 5, '5')).toBe(false);
  });
});

describe('maskValue', () => {
  it('replaces any present value with one fixed mask that does not reveal its length or type', () => {
    expect(MASK).not.toBe('');
    for (const value of ['secret', 's', '', 0, 12345, true, false, null, { a: 1 }, [1, 2, 3]]) {
      expect(maskValue(value), String(value)).toBe(MASK);
    }
  });

  it('shows nothing for a value that is absent', () => {
    expect(maskValue(undefined)).toBe('');
  });
});

describe('diffRows', () => {
  const rowAt = (rows, path) => rows.find((row) => row.path === path);

  it('lists added, removed and changed keys with masked values by default', () => {
    const base = JSON.stringify({ keep: 1, gone: 'old-secret', edit: 'before' });
    const working = JSON.stringify({ keep: 1, edit: 'after', fresh: 'new-secret' });

    const result = diffRows(base, working);

    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => [row.path, row.kind]).sort()).toEqual([
      ['$.edit', 'changed'],
      ['$.fresh', 'added'],
      ['$.gone', 'removed'],
    ]);
    const edit = rowAt(result.rows, '$.edit');
    expect(edit.before.masked).toBe(MASK);
    expect(edit.after.masked).toBe(MASK);
    expect(rowAt(result.rows, '$.gone').after).toBeNull();
    expect(rowAt(result.rows, '$.fresh').before).toBeNull();
  });

  it('carries the real values separately so the dialog can reveal them on request', () => {
    const result = diffRows('{"a":"one","b":2}', '{"a":"two","b":3}');
    const [a, b] = result.rows;
    expect([a.before.text, a.after.text]).toEqual(['"one"', '"two"']);
    expect([b.before.text, b.after.text]).toEqual(['2', '3']);
  });

  it('never puts a value into the masked field', () => {
    const result = diffRows('{"token":"abc123"}', '{"token":"xyz789"}');
    const serialised = JSON.stringify(result.rows.map((row) => [row.before.masked, row.after.masked]));
    expect(serialised).not.toContain('abc123');
    expect(serialised).not.toContain('xyz789');
  });

  it('reports nested paths and array positions', () => {
    const result = diffRows('{"a":{"b":[1,2]}}', '{"a":{"b":[1,3]}}');
    expect(result.ok).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((row) => row.path.startsWith('$.a.b'))).toBe(true);
  });

  it('shows an object or array value as compact JSON, shortened when long', () => {
    const long = 'x'.repeat(500);
    const result = diffRows('{"o":{"k":1}}', JSON.stringify({ o: { k: long } }));
    const row = result.rows[0];
    expect(row.before.text.length).toBeLessThan(200);
    expect(row.after.text.length).toBeLessThanOrEqual(121);
    expect(row.after.text.endsWith('…')).toBe(true);
  });

  it('finds no key-level difference between texts that differ only in layout or key order', () => {
    const result = diffRows('{"a":1,"b":2}', '{\n  "b": 2,\n  "a": 1\n}\n');
    expect(result).toEqual({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      counts: { added: 0, removed: 0, changed: 0, moved: 0 },
    });
  });

  it('is not ok when either side is not valid JSON, without throwing or echoing text', () => {
    expect(diffRows('{"a":', '{"a":1}')).toEqual({ ok: false });
    expect(diffRows('{"a":1}', 'nope')).toEqual({ ok: false });
    expect(diffRows(undefined, '{}')).toEqual({ ok: false });
  });

  it('caps the rows it returns and says how many there were', () => {
    const base = JSON.stringify(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])));
    const working = JSON.stringify(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i + 1])));

    const result = diffRows(base, working, { limit: 10 });

    expect(result.rows).toHaveLength(10);
    expect(result.total).toBe(30);
    expect(result.truncated).toBe(true);
  });

  it('describes a changed root value', () => {
    const result = diffRows('"a"', '"b"');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ path: '$', kind: 'changed' });
  });
});

describe('lineRows', () => {
  it('lists the lines that were removed and added, with their line numbers', () => {
    const result = lineRows('one\ntwo\nthree', 'one\n2\nthree\nfour');

    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => [row.kind, row.line])).toEqual([
      ['removed', 2],
      ['added', 2],
      ['added', 4],
    ]);
    expect(result.rows[0].before.text).toBe('two');
    expect(result.rows[1].after.text).toBe('2');
    expect(result.rows[0].before.masked).toBe(MASK);
  });

  it('reports no rows for identical text', () => {
    expect(lineRows('same\ntext', 'same\ntext')).toEqual({
      ok: true,
      rows: [],
      total: 0,
      truncated: false,
      counts: { added: 0, removed: 0, changed: 0, moved: 0 },
    });
  });

  it('treats CRLF and LF line endings as the same lines', () => {
    expect(lineRows('a\r\nb', 'a\nb').rows).toEqual([]);
  });

  it('caps the rows and reports the total', () => {
    const base = Array.from({ length: 40 }, (_, i) => `a${i}`).join('\n');
    const working = Array.from({ length: 40 }, (_, i) => `b${i}`).join('\n');
    const result = lineRows(base, working, { limit: 15 });
    expect(result.rows).toHaveLength(15);
    expect(result.total).toBe(80);
    expect(result.truncated).toBe(true);
  });

  it('copes with a very large rewrite without comparing every pair of lines', () => {
    const base = Array.from({ length: 5000 }, (_, i) => `a${i}`).join('\n');
    const working = Array.from({ length: 5000 }, (_, i) => `b${i}`).join('\n');
    const result = lineRows(base, working);
    expect(result.total).toBe(10000);
    expect(result.rows.length).toBeLessThanOrEqual(200);
  });
});

describe('changeRows', () => {
  it('uses the key-level diff for JSON and says so', () => {
    const result = changeRows('json', '{"a":1}', '{"a":2}');
    expect(result.mode).toBe('keys');
    expect(result.rows).toHaveLength(1);
  });

  it('uses a line summary for text', () => {
    const result = changeRows('text', 'a\nb', 'a\nc');
    expect(result.mode).toBe('lines');
    expect(result.rows.map((row) => row.kind)).toEqual(['removed', 'added']);
  });

  it('falls back to lines when JSON cannot be parsed', () => {
    const result = changeRows('json', '{"a":', '{"a":1}');
    expect(result.mode).toBe('lines');
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

describe('changeSummary', () => {
  it('counts each kind of change for keys', () => {
    const rows = changeRows('json', '{"a":1,"b":2,"c":3}', '{"a":9,"c":3,"d":4}');
    expect(changeSummary(rows)).toBe('1 added · 1 changed · 1 removed');
  });

  it('counts lines for text', () => {
    const rows = changeRows('text', 'a\nb\nc', 'a\nx');
    expect(changeSummary(rows)).toBe('1 line added · 2 lines removed');
  });

  it('says so when only formatting or key order changed', () => {
    const rows = changeRows('json', '{"a":1,"b":2}', '{"b":2,"a":1}');
    expect(changeSummary(rows)).toBe('No key-level changes (formatting or key order only)');
  });

  it('names a truncated list', () => {
    const base = JSON.stringify(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, i])));
    const working = JSON.stringify(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, 9])));
    const rows = changeRows('json', base, working, { limit: 2 });
    expect(changeSummary(rows)).toBe('5 changed (showing 2)');
  });
});

describe('shortVersion and pushSuccessMessage', () => {
  it('shortens a version id to its first 8 characters', () => {
    expect(shortVersion('0123456789abcdef0123456789abcdef')).toBe('01234567');
    expect(shortVersion('v7')).toBe('v7');
    expect(shortVersion(undefined)).toBe('');
  });

  it('words the success toast with the secret name and the short version, never a value', () => {
    expect(pushSuccessMessage('cfg', '0123456789abcdef0123456789abcdef')).toBe(
      'Pushed cfg (v 01234567…)'
    );
    expect(pushSuccessMessage('cfg', 'v7')).toBe('Pushed cfg (v v7)');
    expect(pushSuccessMessage('cfg', undefined)).toBe('Pushed cfg');
  });
});
