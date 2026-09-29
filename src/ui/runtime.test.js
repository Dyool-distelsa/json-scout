import { describe, it, expect, afterEach } from 'vitest';
import { isTauriRuntime, deriveDisplayFileName } from './runtime.js';

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
