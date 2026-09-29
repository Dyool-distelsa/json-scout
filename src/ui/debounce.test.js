import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce.js';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call the function before the wait elapses', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 250);
    debounced();
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls the function once the wait elapses (trailing edge)', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 250);
    debounced();
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('collapses rapid-fire calls into a single trailing call', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 250);
    for (let i = 0; i < 20; i += 1) {
      debounced();
      vi.advanceTimersByTime(50); // never lets the 250ms window close
    }
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls the function with the arguments of the last invocation', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 250);
    debounced('first');
    debounced('second');
    debounced('third');
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('schedules a fresh window for calls made after the previous one fired', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 250);
    debounced('first');
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced('second');
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');
  });

  describe('cancel', () => {
    it('prevents a pending call from firing', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 250);
      debounced();
      debounced.cancel();
      vi.advanceTimersByTime(250);
      expect(fn).not.toHaveBeenCalled();
    });

    it('is a no-op when nothing is pending', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 250);
      expect(() => debounced.cancel()).not.toThrow();
      expect(fn).not.toHaveBeenCalled();
    });

    it('allows a later call to schedule normally after a cancel', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 250);
      debounced('cancelled');
      debounced.cancel();
      debounced('kept');
      vi.advanceTimersByTime(250);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('kept');
    });
  });

  describe('flush', () => {
    it('immediately invokes a pending call without waiting', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 250);
      debounced('now');
      debounced.flush();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('now');
    });

    it('prevents the original timer from firing a second time', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 250);
      debounced('now');
      debounced.flush();
      vi.advanceTimersByTime(250);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when nothing is pending', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 250);
      expect(() => debounced.flush()).not.toThrow();
      expect(fn).not.toHaveBeenCalled();
    });

    it('allows scheduling again after a flush', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 250);
      debounced('first');
      debounced.flush();
      debounced('second');
      vi.advanceTimersByTime(250);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('second');
    });
  });
});
