// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHelpPanel, versionRows, REPO_URL } from './helpPanel.js';

afterEach(() => document.body.replaceChildren());

describe('versionRows', () => {
  it('shows the version, full commit and build date when known', () => {
    expect(versionRows({ version: '0.2.5', commit: 'abc', commitFull: 'abcdef', date: '2026-10-07' })).toEqual([
      ['Version', '0.2.5'],
      ['Commit', 'abcdef'],
      ['Built', '2026-10-07'],
    ]);
  });

  it('falls back to dev and drops unknown fields', () => {
    expect(versionRows({ version: 'unknown', commit: 'unknown', date: '' })).toEqual([['Version', 'dev']]);
  });
});

describe('createHelpPanel', () => {
  it('renders the repository, contributing steps and credits', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    createHelpPanel(container, { isTauri: false, notify: vi.fn() });
    const text = container.textContent;
    expect(text).toContain('github.com/Dyool-distelsa/json-scout');
    expect(text).toContain('Contributing');
    expect(text).toContain('npm run tauri dev');
    expect(text).toContain('Created and maintained by Dylan Yool, owner of the repository.');
    expect(text).toContain('Ctrl+N');
  });

  it('opens links in a new browser tab outside the desktop app', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const container = document.createElement('div');
    createHelpPanel(container, { isTauri: false, notify: vi.fn() });
    container.querySelector('.help-link').click();
    expect(open).toHaveBeenCalledWith(REPO_URL, '_blank', 'noopener');
  });
});
