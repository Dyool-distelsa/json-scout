/**
 * A small, dependency-free trailing-edge debounce.
 *
 * The returned function delays invoking `fn` until `wait` milliseconds
 * have elapsed since the last time the debounced function was called.
 * Only the arguments of the last call are used. Exposes `cancel()` to
 * drop a pending call, and `flush()` to invoke it immediately (used
 * wherever an action must see up-to-date derived state right away,
 * e.g. Save or a toolbar action, instead of racing the timer).
 *
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} wait
 * @returns {F & { cancel: () => void, flush: () => void }}
 */
export function debounce(fn, wait) {
  let timerId = null;
  let pendingArgs = null;
  let pendingThis = null;

  function invokePending() {
    const args = pendingArgs;
    const thisArg = pendingThis;
    timerId = null;
    pendingArgs = null;
    pendingThis = null;
    fn.apply(thisArg, args);
  }

  function debounced(...args) {
    pendingArgs = args;
    pendingThis = this;
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(invokePending, wait);
  }

  debounced.cancel = function cancel() {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = null;
    pendingArgs = null;
    pendingThis = null;
  };

  debounced.flush = function flush() {
    if (timerId === null) return;
    clearTimeout(timerId);
    invokePending();
  };

  return debounced;
}
