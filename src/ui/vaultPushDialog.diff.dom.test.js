// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The diff is the dialog's one expensive step; count how often it runs.
vi.mock('./vaultPush.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, changeRows: vi.fn(actual.changeRows) };
});

import { openPushDialog } from './vaultPushDialog.js';
import { changeRows } from './vaultPush.js';
import { createFakeInvoke, settle } from './testing/fakeBackend.js';

const VERSION = '0123456789abcdef0123456789abcdef';

function previewOf(overrides = {}) {
  return {
    changed: true,
    format: 'json',
    baseVersion: VERSION,
    baseText: '{"user":"ana","token":"old-token-value"}',
    workingText: '{"user":"ana","token":"new-token-value"}',
    remote: { currentVersion: VERSION, conflict: false, remoteText: null },
    environment: 'prod',
    contentHash: 'hash-1',
    ...overrides,
  };
}

let fake;
let handle;

beforeEach(() => {
  changeRows.mockClear();
  fake = createFakeInvoke();
  fake.on('vault_push', { newVersion: 'new' });
  document.body.appendChild(document.createElement('button')).focus();
});

afterEach(() => {
  handle?.close();
  handle = undefined;
  document.body.replaceChildren();
});

const dialog = () => document.querySelector('[role="dialog"]');
const buttonByText = (text) =>
  [...dialog().querySelectorAll('button')].find((node) => node.textContent === text);

function type(value) {
  const input = dialog().querySelector('input[type="text"]');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function open(preview = previewOf()) {
  handle = openPushDialog({
    vault: 'kv-prod',
    name: 'cfg',
    preview,
    invoke: fake.invoke,
    onPushed: vi.fn(),
    onRepull: vi.fn(),
  });
}

describe('push dialog: the diff is computed once per preview', () => {
  it('computes the changes once on open and not again for each keystroke', () => {
    open();
    expect(changeRows).toHaveBeenCalledTimes(1);

    for (const typed of ['c', 'cf', 'cfg', 'cf', 'cfg']) type(typed);

    expect(changeRows).toHaveBeenCalledTimes(1);
    expect(buttonByText('Push').disabled).toBe(false);
  });

  it('keeps the same rows when values are revealed and hidden again', () => {
    open();

    buttonByText('Reveal values').click();
    expect(dialog().textContent).toContain('new-token-value');
    buttonByText('Hide values').click();
    expect(dialog().textContent).not.toContain('new-token-value');

    expect(changeRows).toHaveBeenCalledTimes(1);
  });

  it('computes both sections once for a conflict preview', () => {
    open(
      previewOf({
        remote: {
          currentVersion: 'fedcba9876543210fedcba9876543210',
          conflict: true,
          remoteText: '{"user":"ana","token":"remote-edit-value"}',
        },
      })
    );

    type('cf');
    type('cfg');
    buttonByText('Reveal values').click();

    expect(changeRows).toHaveBeenCalledTimes(2);
  });

  it('computes again only when a new preview replaces the old one', async () => {
    open();
    fake.on('vault_push', () => {
      throw { kind: 'preview_required' };
    });
    type('cfg');
    buttonByText('Push').click();
    await settle();
    fake.on('vault_push_preview', previewOf({ workingText: '{"user":"bea","token":"x"}' }));
    expect(changeRows).toHaveBeenCalledTimes(1);

    buttonByText('Review again').click();
    await settle();
    type('c');
    type('cf');

    expect(changeRows).toHaveBeenCalledTimes(2);
    expect(dialog().textContent).toContain('2 changed');
  });
});
