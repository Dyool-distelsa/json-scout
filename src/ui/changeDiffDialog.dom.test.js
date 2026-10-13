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
  it('lists the key changes with their values shown', () => {
    openChangeDiffDialog({
      change: change('modified'),
      baseText: '{"db":{"password":"old-secret"},"port":1}',
      workingText: '{"db":{"password":"new-secret"},"port":1,"debug":true}',
      onOpen: vi.fn(),
    });
    const text = dialog().textContent;
    expect(dialog().querySelector('.modal__title').textContent).toBe('cfg/app.json');
    expect(text).toContain('old-secret');
    expect(text).toContain('new-secret');
    expect(text).toContain('1 added · 1 changed');
    expect(dialog().querySelector('.push-value--masked')).toBeNull();
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
