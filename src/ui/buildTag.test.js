import { describe, expect, it } from 'vitest';
import { formatBuildTag, readBuildInfo } from './buildTag.js';

describe('formatBuildTag', () => {
  it('joins the version and the short commit with a middle dot', () => {
    const { text } = formatBuildTag({ version: '0.2.2', commit: 'f95eac0' });
    expect(text).toBe('v0.2.2 · f95eac0');
  });

  it('keeps a dirty marker on the commit', () => {
    expect(formatBuildTag({ version: '0.2.2', commit: 'f95eac0-dirty' }).text).toBe(
      'v0.2.2 · f95eac0-dirty'
    );
  });

  it('puts the full commit and the build date in the tooltip', () => {
    const { title } = formatBuildTag({
      version: '0.2.2',
      commit: 'f95eac0',
      commitFull: 'f95eac0123456789abcdef0123456789abcdef01',
      date: '2026-10-01T12:00:00.000Z',
    });
    expect(title).toContain('0.2.2');
    expect(title).toContain('f95eac0123456789abcdef0123456789abcdef01');
    expect(title).toContain('2026-10-01T12:00:00.000Z');
  });

  it('leaves out what is unknown instead of printing "unknown"', () => {
    const { text, title } = formatBuildTag({ version: '0.2.2', commit: 'unknown', date: 'unknown' });
    expect(text).toBe('v0.2.2');
    expect(title).not.toContain('unknown');
  });

  it('does not prefix a non-numeric version such as "dev"', () => {
    expect(formatBuildTag({ version: 'dev', commit: 'unknown' }).text).toBe('dev');
  });

  it('survives missing input', () => {
    expect(formatBuildTag({}).text).toBe('dev');
    expect(formatBuildTag(undefined).text).toBe('dev');
  });
});

describe('readBuildInfo', () => {
  it('reads the constants Vite injects, so the test build reports the real version', () => {
    const info = readBuildInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof info.commit).toBe('string');
    expect(info.commit.length).toBeGreaterThan(0);
    expect(typeof info.date).toBe('string');
  });
});
