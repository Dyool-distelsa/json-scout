// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStatusBar } from './statusbar.js';

let container;

beforeEach(() => {
  container = document.createElement('footer');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

const BUILD = {
  version: '0.2.2',
  commit: 'f95eac0',
  commitFull: 'f95eac0123456789abcdef0123456789abcdef01',
  date: '2026-10-01T12:00:00.000Z',
};

describe('status bar build tag', () => {
  it('shows the version and short commit as the last item, with the details as its tooltip', () => {
    createStatusBar(container, { build: BUILD });
    const tag = container.querySelector('.statusbar__build');
    expect(tag).not.toBeNull();
    expect(tag.textContent).toBe('v0.2.2 · f95eac0');
    expect(tag.title).toContain(BUILD.commitFull);
    expect(tag.title).toContain(BUILD.date);
    expect(container.lastElementChild).toBe(tag);
  });

  it('shows the injected build by default', () => {
    createStatusBar(container);
    expect(container.querySelector('.statusbar__build').textContent).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('keeps the other items working next to the tag', () => {
    const bar = createStatusBar(container, { build: BUILD });
    bar.setCursor(3, 7);
    expect(container.textContent).toContain('Ln 3, Col 7');
    expect(container.querySelector('.statusbar__build').textContent).toBe('v0.2.2 · f95eac0');
  });
});
