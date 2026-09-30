import { describe, it, expect, vi, afterEach } from 'vitest';
import { flashEditor, FLASH_CLASS, FLASH_DURATION_MS } from './feedback.js';

// Minimal stand-in for an element: only what the helper touches.
function fakeContainer() {
  const classes = new Set();
  return {
    classes,
    offsetWidth: 0,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
}

describe('flashEditor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds the flash class, then removes it after the flash duration', () => {
    vi.useFakeTimers();
    const el = fakeContainer();
    flashEditor(el);
    expect(el.classList.contains(FLASH_CLASS)).toBe(true);
    vi.advanceTimersByTime(FLASH_DURATION_MS - 1);
    expect(el.classList.contains(FLASH_CLASS)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains(FLASH_CLASS)).toBe(false);
  });

  it('restarts the window when retriggered mid-flash', () => {
    vi.useFakeTimers();
    const el = fakeContainer();
    flashEditor(el);
    vi.advanceTimersByTime(FLASH_DURATION_MS - 100);
    flashEditor(el);
    // The first timer would have fired here; the retrigger must outlive it.
    vi.advanceTimersByTime(100);
    expect(el.classList.contains(FLASH_CLASS)).toBe(true);
    vi.advanceTimersByTime(FLASH_DURATION_MS);
    expect(el.classList.contains(FLASH_CLASS)).toBe(false);
  });

  it('ignores a missing container', () => {
    expect(() => flashEditor(null)).not.toThrow();
  });
});
