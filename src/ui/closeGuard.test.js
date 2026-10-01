import { describe, it, expect } from 'vitest';
import { closeDecision, MAX_LISTED } from './closeGuard.js';

const change = (vault, name) => ({ vault, name });

describe('closeDecision', () => {
  it('lets the window close when no secret has unpushed edits', () => {
    expect(closeDecision([])).toEqual({ action: 'close' });
  });

  it('asks before closing when secrets have unpushed edits', () => {
    const decision = closeDecision([change('kv-dev', 'cfg'), change('kv-dev', 'db')]);

    expect(decision.action).toBe('ask');
    expect(decision.message).toBe('2 secrets have unpushed edits. Close and discard them?');
    expect(decision.entries).toEqual(['kv-dev/cfg', 'kv-dev/db']);
    expect(decision.hidden).toBe(0);
  });

  it('uses the singular for one secret', () => {
    const decision = closeDecision([change('kv-dev', 'cfg')]);
    expect(decision.message).toBe('1 secret has unpushed edits. Close and discard them?');
  });

  it('lists vault and name only, never anything else the entry carries', () => {
    const decision = closeDecision([{ vault: 'kv', name: 'cfg', value: 'top-secret', text: 'also-secret' }]);
    expect(JSON.stringify(decision)).not.toContain('top-secret');
    expect(JSON.stringify(decision)).not.toContain('also-secret');
    expect(decision.entries).toEqual(['kv/cfg']);
  });

  it('shortens a very long list and says how many are not shown', () => {
    const many = Array.from({ length: MAX_LISTED + 7 }, (_, i) => change('kv', `s${i}`));

    const decision = closeDecision(many);

    expect(decision.entries).toHaveLength(MAX_LISTED);
    expect(decision.hidden).toBe(7);
    expect(decision.message).toBe(`${MAX_LISTED + 7} secrets have unpushed edits. Close and discard them?`);
  });

  it('asks anyway, with a generic message, when the check failed', () => {
    for (const failure of [
      new Error('boom'),
      { kind: 'io', message: 'File system error: x' },
      { error: { kind: 'internal' } },
      'nope',
      null,
      undefined,
      42,
    ]) {
      const decision = closeDecision(failure);
      expect(decision.action, String(failure)).toBe('ask');
      expect(decision.message).toBe(
        'Could not check for unpushed edits. Close and discard any you may have?'
      );
      expect(decision.entries).toEqual([]);
    }
  });

  it('skips entries that are not a vault and a name, but still asks when any remain', () => {
    const decision = closeDecision([change('kv', 'cfg'), null, { vault: 'kv' }, 'x', { name: 'n' }]);
    expect(decision.action).toBe('ask');
    expect(decision.entries).toEqual(['kv/cfg']);
    expect(decision.message).toBe('1 secret has unpushed edits. Close and discard them?');
  });

  it('treats a list of only malformed entries as a failed check, not as nothing to lose', () => {
    expect(closeDecision([null, {}, 'x']).message).toContain('Could not check');
  });
});
