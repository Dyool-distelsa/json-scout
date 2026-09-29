import { describe, it, expect, vi } from 'vitest';
import { isCopyable, copyText } from './clipboard.js';

describe('isCopyable', () => {
  it('is false for empty or whitespace-only text', () => {
    expect(isCopyable('')).toBe(false);
    expect(isCopyable('  \n\t')).toBe(false);
    expect(isCopyable(undefined)).toBe(false);
  });

  it('is true when there is any visible content', () => {
    expect(isCopyable('{}')).toBe(true);
  });
});

describe('copyText', () => {
  it('uses the async clipboard API when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fallback = vi.fn();
    await expect(copyText('abc', { clipboard: { writeText }, fallback })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back when the async API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const fallback = vi.fn().mockReturnValue(true);
    await expect(copyText('abc', { clipboard: { writeText }, fallback })).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledWith('abc');
  });

  it('falls back when the async API is unavailable', async () => {
    const fallback = vi.fn().mockReturnValue(true);
    await expect(copyText('abc', { clipboard: undefined, fallback })).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledWith('abc');
  });

  it('reports failure when both paths fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const fallback = vi.fn().mockReturnValue(false);
    await expect(copyText('abc', { clipboard: { writeText }, fallback })).resolves.toBe(false);
  });

  it('reports failure when the fallback throws', async () => {
    const fallback = vi.fn(() => {
      throw new Error('boom');
    });
    await expect(copyText('abc', { clipboard: undefined, fallback })).resolves.toBe(false);
  });
});
