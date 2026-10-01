/**
 * Test doubles for the Tauri bridge, shared by the DOM tests. Not bundled into
 * the app: nothing in the app imports this file.
 */

/**
 * A promise whose settlement the test controls.
 * @template T
 * @returns {{ promise: Promise<T>, resolve: (value: T) => void, reject: (reason?: any) => void }}
 */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every already-settled promise continuation run. */
export function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A fake `invoke(command, args)` that records every call.
 *
 * - `on(command, handler)`: how a command answers. `handler` is a value or a
 *   function `(args) => value | Promise`; a throw or a rejected promise is a
 *   failed call. A command without a handler rejects.
 * - `hold(command)`: the next call of that command stays pending until the
 *   returned deferred is settled.
 * - `calls`: every `{ command, args }`, in order.
 */
export function createFakeInvoke() {
  const calls = [];
  const handlers = new Map();
  const held = new Map();

  async function invoke(command, args) {
    calls.push({ command, args });
    const queue = held.get(command);
    if (queue?.length) return queue.shift().promise;
    if (!handlers.has(command)) throw new Error(`unexpected command: ${command}`);
    const handler = handlers.get(command);
    return typeof handler === 'function' ? handler(args) : handler;
  }

  return {
    invoke,
    calls,
    on(command, handler) {
      handlers.set(command, handler);
      return this;
    },
    hold(command) {
      const pending = deferred();
      if (!held.has(command)) held.set(command, []);
      held.get(command).push(pending);
      return pending;
    },
    callsOf(command) {
      return calls.filter((call) => call.command === command);
    },
  };
}
