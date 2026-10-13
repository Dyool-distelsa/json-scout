// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChangeDiffDialog } from './changeDiffDialog.js';

const change = (kind) => ({ relative: 'cfg/app.json', path: '/p/cfg/app.json', kind, head: 'cfg/app.json' });
const dialog = () => document.querySelector('.change-diff');
const buttons = () => [...dialog().querySelectorAll('.modal__footer button')].map((b) => b.textContent);

afterEach(() => {
  document.body.replaceChildren();
});

describe('openChangeDiffDialog', () => {
  it('shows the lines that changed like git diff, values included', () => {
    openChangeDiffDialog({
      change: change('modified'),
      baseText: ['{', '  "password": "old-secret",', '  "port": 1', '}', ''].join('\n'),
      workingText: ['{', '  "password": "new-secret",', '  "port": 1,', '  "debug": true', '}', ''].join('\n'),
      onOpen: vi.fn(),
    });
    expect(dialog().querySelector('.modal__title').textContent).toBe('cfg/app.json');
    expect(dialog().querySelector('.git-diff__hunk').textContent).toBe('@@ -1,4 +1,5 @@');
    const rows = [...dialog().querySelectorAll('.git-diff__line')].map(
      (r) => r.querySelector('.git-diff__sign').textContent + r.querySelector('.git-diff__text').textContent
    );
    expect(rows).toEqual(['{', '-  "password": "old-secret",', '-  "port": 1', '+  "password": "new-secret",', '+  "port": 1,', '+  "debug": true', '}'].map((r) => (/^[-+]/.test(r) ? r : ' ' + r)));
    expect(dialog().querySelector('.change-diff__stat--add').textContent).toBe('+3');
  });

  it('formats single-line JSON before comparing it', () => {
    openChangeDiffDialog({ change: change('modified'), baseText: '{"a":1,"b":2}', workingText: '{"a":1,"b":3}' });
    expect(dialog().textContent).toContain('formatted to compare');
    expect(dialog().querySelectorAll('.git-diff__line--del')).toHaveLength(1);
  });

  it('opens the file from the dialog', () => {
    const onOpen = vi.fn();
    openChangeDiffDialog({ change: change('modified'), baseText: '{}', workingText: '{"a":1}', onOpen });
    expect(buttons()).toEqual(['Close', 'Open file']);
    dialog().querySelector('.modal__footer .primary').click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('offers only Close for a deleted file', () => {
    openChangeDiffDialog({ change: change('deleted'), baseText: '{"a":1}', workingText: '', onOpen: vi.fn() });
    expect(buttons()).toEqual(['Close']);
    expect(dialog().textContent).toContain('Deleted');
  });
});
