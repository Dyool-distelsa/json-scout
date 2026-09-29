import { describe, it, expect, vi } from 'vitest';
import { TOAST_DURATIONS, getToastDuration, createToastId, ToastQueue } from './toast.js';

/**
 * A fake scheduler that never actually waits: it just records the callback
 * and delay so a test can trigger expiry manually and deterministically.
 */
function createFakeScheduler() {
  let nextHandle = 1;
  const pending = new Map();
  return {
    setTimeoutFn: (fn, delay) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, { fn, delay });
      return handle;
    },
    clearTimeoutFn: (handle) => {
      pending.delete(handle);
    },
    fire: (handle) => {
      const entry = pending.get(handle);
      if (!entry) return;
      pending.delete(handle);
      entry.fn();
    },
    isPending: (handle) => pending.has(handle),
    pendingCount: () => pending.size,
  };
}

describe('getToastDuration', () => {
  it('returns the success duration for the success variant', () => {
    expect(getToastDuration('success')).toBe(TOAST_DURATIONS.success);
  });

  it('returns the error duration for the error variant', () => {
    expect(getToastDuration('error')).toBe(TOAST_DURATIONS.error);
  });

  it('returns the info duration for the info variant', () => {
    expect(getToastDuration('info')).toBe(TOAST_DURATIONS.info);
  });

  it('falls back to the info duration for an unknown variant', () => {
    expect(getToastDuration('mystery')).toBe(TOAST_DURATIONS.info);
  });

  it('makes success shorter than info, and info shorter than error', () => {
    expect(TOAST_DURATIONS.success).toBeLessThan(TOAST_DURATIONS.info);
    expect(TOAST_DURATIONS.info).toBeLessThan(TOAST_DURATIONS.error);
  });
});

describe('createToastId', () => {
  it('returns a string id', () => {
    expect(typeof createToastId()).toBe('string');
  });

  it('returns a different id on each call', () => {
    const ids = new Set([createToastId(), createToastId(), createToastId()]);
    expect(ids.size).toBe(3);
  });
});

describe('ToastQueue', () => {
  it('starts empty', () => {
    const queue = new ToastQueue();
    expect(queue.list()).toEqual([]);
  });

  it('adds a toast with message, variant and a generated id', () => {
    const queue = new ToastQueue();
    const toast = queue.add('Saved.', 'success');
    expect(toast.message).toBe('Saved.');
    expect(toast.variant).toBe('success');
    expect(typeof toast.id).toBe('string');
    expect(queue.list()).toEqual([toast]);
  });

  it('defaults the variant to info when none is given', () => {
    const queue = new ToastQueue();
    const toast = queue.add('Something happened.');
    expect(toast.variant).toBe('info');
  });

  it('schedules auto-dismiss using the duration for the given variant', () => {
    const { setTimeoutFn, clearTimeoutFn } = createFakeScheduler();
    const scheduleSpy = vi.fn(setTimeoutFn);
    const queue = new ToastQueue({ setTimeoutFn: scheduleSpy, clearTimeoutFn });
    queue.add('Oops.', 'error');
    expect(scheduleSpy).toHaveBeenCalledWith(expect.any(Function), TOAST_DURATIONS.error);
  });

  it('removes a toast once its scheduled timer fires', () => {
    const scheduler = createFakeScheduler();
    const queue = new ToastQueue(scheduler);
    const toast = queue.add('Valid JSON', 'success');
    expect(queue.list()).toHaveLength(1);
    scheduler.fire(1);
    expect(queue.list()).toEqual([]);
  });

  it('dismiss(id) removes the toast and clears its pending timer', () => {
    const scheduler = createFakeScheduler();
    const queue = new ToastQueue(scheduler);
    const toast = queue.add('Copied.', 'info');
    expect(scheduler.pendingCount()).toBe(1);
    const removed = queue.dismiss(toast.id);
    expect(removed).toBe(true);
    expect(queue.list()).toEqual([]);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('dismiss(id) is a no-op and returns false for an unknown id', () => {
    const queue = new ToastQueue();
    expect(queue.dismiss('does-not-exist')).toBe(false);
  });

  it('dismissVariant removes only toasts of that variant', () => {
    const queue = new ToastQueue(createFakeScheduler());
    queue.add('bad', 'error');
    queue.add('ok', 'success');
    queue.add('also bad', 'error');
    queue.dismissVariant('error');
    const remaining = queue.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe('ok');
  });

  it('dismissAll clears every toast', () => {
    const queue = new ToastQueue(createFakeScheduler());
    queue.add('a', 'info');
    queue.add('b', 'error');
    queue.dismissAll();
    expect(queue.list()).toEqual([]);
  });

  it('notifies subscribers with the current list on every change', () => {
    const queue = new ToastQueue(createFakeScheduler());
    const listener = vi.fn();
    queue.subscribe(listener);
    const toast = queue.add('hi', 'info');
    expect(listener).toHaveBeenLastCalledWith([toast]);
    queue.dismiss(toast.id);
    expect(listener).toHaveBeenLastCalledWith([]);
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const queue = new ToastQueue(createFakeScheduler());
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    unsubscribe();
    queue.add('hi', 'info');
    expect(listener).not.toHaveBeenCalled();
  });

  it('list() returns a snapshot that does not mutate on further changes', () => {
    const queue = new ToastQueue(createFakeScheduler());
    queue.add('a', 'info');
    const snapshot = queue.list();
    queue.add('b', 'info');
    expect(snapshot).toHaveLength(1);
  });
});

describe('ToastQueue default (non-injected) timers', () => {
  /**
   * Regression guard for a bug that shipped invisibly: the constructor used
   * to store a bare `setTimeout` reference and later call it as
   * `this._setTimeout(...)`, which re-binds the receiver to the ToastQueue
   * instance. A browser refuses that with "Illegal invocation", so the very
   * first toast threw and NO toast ever appeared — while this suite stayed
   * green, because every other test injects fake timers and Node's timers
   * do not care about their receiver.
   *
   * These tests therefore exercise the DEFAULT path with timers that model
   * the browser contract.
   */
  function withStrictGlobalTimers(run) {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const illegal = (receiver) => receiver !== undefined && receiver !== globalThis;
    globalThis.setTimeout = function strictSetTimeout(fn, ms) {
      if (illegal(this)) throw new TypeError('Illegal invocation');
      return realSetTimeout(fn, ms);
    };
    globalThis.clearTimeout = function strictClearTimeout(handle) {
      if (illegal(this)) throw new TypeError('Illegal invocation');
      return realClearTimeout(handle);
    };
    try {
      run();
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  }

  it('adds a toast without an Illegal invocation when no timers are injected', () => {
    withStrictGlobalTimers(() => {
      const queue = new ToastQueue();
      expect(() => queue.add('Valid JSON', 'success')).not.toThrow();
      expect(queue.list()).toHaveLength(1);
      queue.dismissAll();
    });
  });

  it('dismisses a toast without an Illegal invocation when no timers are injected', () => {
    withStrictGlobalTimers(() => {
      const queue = new ToastQueue();
      const toast = queue.add('Line 3, Col 5: Unexpected token', 'error');
      expect(() => queue.dismiss(toast.id)).not.toThrow();
      expect(queue.list()).toHaveLength(0);
    });
  });
});
