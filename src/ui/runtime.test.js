import { describe, it, expect, afterEach } from 'vitest';
import { isTauriRuntime, deriveDisplayFileName, supportsContextMenu } from './runtime.js';

describe('deriveDisplayFileName', () => {
  it('returns Untitled for a null path', () => {
    expect(deriveDisplayFileName(null)).toBe('Untitled');
  });

  it('returns Untitled for an undefined path', () => {
    expect(deriveDisplayFileName(undefined)).toBe('Untitled');
  });

  it('returns Untitled for an empty path', () => {
    expect(deriveDisplayFileName('')).toBe('Untitled');
  });

  it('extracts the file name from a Windows-style path', () => {
    expect(deriveDisplayFileName('C:\\Users\\dyool\\data.json')).toBe('data.json');
  });

  it('extracts the file name from a POSIX-style path', () => {
    expect(deriveDisplayFileName('/home/dyool/data.json')).toBe('data.json');
  });

  it('extracts the file name from a mixed-separator path', () => {
    expect(deriveDisplayFileName('C:\\Users\\dyool/data.json')).toBe('data.json');
  });

  it('returns the path itself when there is no separator', () => {
    expect(deriveDisplayFileName('data.json')).toBe('data.json');
  });
});

describe('isTauriRuntime', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  it('returns false when window is not defined (node/test environment)', () => {
    delete globalThis.window;
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns false when window exists but has no __TAURI_INTERNALS__', () => {
    globalThis.window = {};
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns true when window has __TAURI_INTERNALS__', () => {
    globalThis.window = { __TAURI_INTERNALS__: {} };
    expect(isTauriRuntime()).toBe(true);
  });
});

describe('supportsContextMenu', () => {
  it('is true for a Windows user agent', () => {
    expect(
      supportsContextMenu('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0'),
    ).toBe(true);
  });

  it('is false for a Linux user agent', () => {
    expect(
      supportsContextMenu('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'),
    ).toBe(false);
  });

  it('is false for a macOS user agent', () => {
    expect(supportsContextMenu('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
  });

  it('is false for an empty or non-string user agent', () => {
    expect(supportsContextMenu('')).toBe(false);
    expect(supportsContextMenu(undefined)).toBe(false);
    expect(supportsContextMenu(null)).toBe(false);
    expect(supportsContextMenu(42)).toBe(false);
  });
});
