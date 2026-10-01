// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askDiscardOnClose, closeDecision, installCloseGuard } from './closeGuard.js';
import { createFakeInvoke, settle } from './testing/fakeBackend.js';

let trigger;

beforeEach(() => {
  trigger = document.createElement('button');
  trigger.textContent = 'window';
  document.body.appendChild(trigger);
  trigger.focus();
});

afterEach(() => {
  for (const node of document.querySelectorAll('.modal-backdrop')) node.remove();
  document.body.replaceChildren();
});

const dialog = () => document.querySelector('[role="dialog"]');
const buttonByText = (text) =>
  [...dialog().querySelectorAll('button')].find((node) => node.textContent === text);
const escape = () =>
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );

const TWO = [
  { vault: 'kv-dev', name: 'cfg' },
  { vault: 'kv-qa', name: 'db' },
];

describe('askDiscardOnClose', () => {
  it('shows what would be lost: the count and each vault/name, with no values', async () => {
    const answer = askDiscardOnClose(closeDecision(TWO));

    expect(dialog()).not.toBeNull();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().textContent).toContain('2 secrets have unpushed edits. Close and discard them?');
    const items = [...dialog().querySelectorAll('li')].map((node) => node.textContent);
    expect(items).toEqual(['kv-dev/cfg', 'kv-qa/db']);
    buttonByText('Keep editing').click();
    await answer;
  });

  it('puts the default focus on Keep editing, the safe choice', async () => {
    const answer = askDiscardOnClose(closeDecision(TWO));
    expect(document.activeElement).toBe(buttonByText('Keep editing'));
    buttonByText('Keep editing').click();
    await answer;
  });

  it('resolves false for Keep editing and gives focus back', async () => {
    const answer = askDiscardOnClose(closeDecision(TWO));

    buttonByText('Keep editing').click();

    expect(await answer).toBe(false);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('resolves true only for Discard and close', async () => {
    const answer = askDiscardOnClose(closeDecision(TWO));

    buttonByText('Discard and close').click();

    expect(await answer).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('treats Escape as Keep editing', async () => {
    const answer = askDiscardOnClose(closeDecision(TWO));
    escape();
    expect(await answer).toBe(false);
  });

  it('keeps focus in the dialog when Tab is pressed on the last button', async () => {
    const answer = askDiscardOnClose(closeDecision(TWO));
    buttonByText('Discard and close').focus();

    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    );

    expect(dialog().contains(document.activeElement)).toBe(true);
    buttonByText('Keep editing').click();
    await answer;
  });

  it('shows the generic message and no list when the check failed', async () => {
    const answer = askDiscardOnClose(closeDecision(new Error('boom')));

    expect(dialog().textContent).toContain('Could not check for unpushed edits');
    expect(dialog().querySelector('ul')).toBeNull();
    buttonByText('Keep editing').click();
    await answer;
  });

  it('mentions how many entries are not listed', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ vault: 'kv', name: `s${i}` }));
    const answer = askDiscardOnClose(closeDecision(many));

    expect(dialog().textContent).toMatch(/and \d+ more/);
    buttonByText('Keep editing').click();
    await answer;
  });
});

describe('installCloseGuard', () => {
  /** A window that behaves like Tauri's: the handler runs for each close request. */
  function fakeWindow() {
    const win = {
      handler: null,
      destroy: vi.fn(async () => {}),
      onCloseRequested: vi.fn(async (handler) => {
        win.handler = handler;
        return () => {};
      }),
    };
    return win;
  }

  function closeRequest() {
    return {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
      isPreventDefault() {
        return this.prevented;
      },
    };
  }

  async function install({ changes = [], win = fakeWindow() } = {}) {
    const fake = createFakeInvoke();
    fake.on('vault_local_changes', changes);
    const notify = vi.fn();
    await installCloseGuard({ invoke: fake.invoke, getWindow: async () => win, notify });
    return { fake, win, notify };
  }

  it('registers one close handler on the window', async () => {
    const { win } = await install();
    expect(win.onCloseRequested).toHaveBeenCalledTimes(1);
  });

  it('lets the window close without asking when nothing is unpushed', async () => {
    const { fake, win } = await install({ changes: [] });
    const event = closeRequest();

    await win.handler(event);

    expect(fake.callsOf('vault_local_changes')).toEqual([
      { command: 'vault_local_changes', args: undefined },
    ]);
    expect(event.prevented).toBe(false);
    expect(dialog()).toBeNull();
    expect(win.destroy).not.toHaveBeenCalled();
  });

  it('holds the close and asks when a secret has unpushed edits', async () => {
    const { win } = await install({ changes: TWO });
    const event = closeRequest();

    const handled = win.handler(event);
    await settle();

    expect(dialog()).not.toBeNull();
    expect(dialog().textContent).toContain('2 secrets have unpushed edits');
    expect(win.destroy).not.toHaveBeenCalled();

    buttonByText('Keep editing').click();
    await handled;

    expect(event.prevented).toBe(true);
    expect(win.destroy).not.toHaveBeenCalled();
  });

  it('destroys the window when the user chooses to discard', async () => {
    const { win } = await install({ changes: TWO });
    const event = closeRequest();

    const handled = win.handler(event);
    await settle();
    buttonByText('Discard and close').click();
    await handled;

    expect(win.destroy).toHaveBeenCalledTimes(1);
    // The library would destroy a window that was not prevented; preventing
    // keeps that from happening a second time.
    expect(event.prevented).toBe(true);
  });

  it('asks anyway when the unpushed edits could not be listed', async () => {
    const win = fakeWindow();
    const fake = createFakeInvoke();
    fake.on('vault_local_changes', () => {
      throw { kind: 'io', message: 'File system error: x' };
    });
    await installCloseGuard({ invoke: fake.invoke, getWindow: async () => win, notify: vi.fn() });
    const event = closeRequest();

    const handled = win.handler(event);
    await settle();

    expect(dialog().textContent).toContain('Could not check for unpushed edits');
    buttonByText('Keep editing').click();
    await handled;
    expect(event.prevented).toBe(true);
    expect(win.destroy).not.toHaveBeenCalled();
  });

  it('refuses a second close request while the question is open', async () => {
    const { win } = await install({ changes: TWO });
    const first = closeRequest();
    const handledFirst = win.handler(first);
    await settle();

    const second = closeRequest();
    await win.handler(second);

    expect(second.prevented).toBe(true);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    buttonByText('Keep editing').click();
    await handledFirst;
  });

  it('can ask again for a later close request after the first was answered', async () => {
    const { win } = await install({ changes: TWO });
    const first = win.handler(closeRequest());
    await settle();
    buttonByText('Keep editing').click();
    await first;

    const second = win.handler(closeRequest());
    await settle();

    expect(dialog()).not.toBeNull();
    buttonByText('Keep editing').click();
    await second;
  });

  it('says so when the window could not be closed after discarding', async () => {
    const win = fakeWindow();
    win.destroy = vi.fn(async () => {
      throw new Error('denied');
    });
    const { notify } = await install({ changes: TWO, win });

    const handled = win.handler(closeRequest());
    await settle();
    buttonByText('Discard and close').click();
    await handled;

    expect(notify).toHaveBeenCalledWith('Could not close the window. Try again.', 'error');
  });

  it('does not throw when the window API is unavailable, so the app keeps working', async () => {
    const fake = createFakeInvoke();
    await expect(
      installCloseGuard({
        invoke: fake.invoke,
        getWindow: async () => {
          throw new Error('not in Tauri');
        },
        notify: vi.fn(),
      })
    ).resolves.toBeTypeOf('function');
  });

  it('lets the window close if the guard itself fails, rather than trapping the user', async () => {
    const win = fakeWindow();
    const { fake } = await install({ changes: TWO, win });
    // A decision that cannot be rendered must not leave the window stuck open.
    const openModal = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
      throw new Error('cannot render');
    });
    const event = closeRequest();

    await win.handler(event);
    openModal.mockRestore();

    expect(event.prevented).toBe(false);
    expect(fake.callsOf('vault_local_changes')).toHaveLength(1);
  });
});
