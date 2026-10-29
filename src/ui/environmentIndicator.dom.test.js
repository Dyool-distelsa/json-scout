// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnvironmentIndicator } from './environmentIndicator.js';

function setup(options = {}) {
  document.title = 'JSON Scout';
  const container = document.createElement('div');
  document.body.append(container);
  return { container, indicator: createEnvironmentIndicator(container, options) };
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.vaultEnvironment;
});

describe('vault environment chrome', () => {
  it('keeps a decorative environment dot attached to the logo across target changes', () => {
    const { container, indicator } = setup();
    const logo = container.querySelector('.environment-brand__logo');
    const dot = logo.querySelector('.environment-brand__dot');
    expect(dot).not.toBeNull();
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    for (const vault of ['kv-prod', 'kv-qa', 'kv-dev', null]) {
      indicator.setVault(vault);
      expect(logo.querySelector('.environment-brand__dot')).toBe(dot);
    }
  });

  it('starts neutral, with an explicit no-vault label and unchanged title', () => {
    const { container } = setup();
    expect(container.textContent).toContain('JSON Scout');
    expect(container.textContent).toContain('No vault');
    expect(document.documentElement.dataset.vaultEnvironment).toBe('none');
    expect(document.title).toBe('JSON Scout');
  });

  it.each([
    ['kv-team-dev', 'dev', 'DEV'],
    ['kv-team-QA', 'qa', 'QA'],
    ['kv-team-stg', 'stg', 'STG'],
    ['kv-team-prod', 'prod', 'PROD'],
    ['kv-team-main', 'prod', 'PROD'],
    ['kv-dev-other', 'unknown', 'UNKNOWN'],
    ['prod', 'unknown', 'UNKNOWN'],
  ])('reflects %s in the label, stripe state, tooltip and title', (vault, environment, label) => {
    const { container, indicator } = setup();
    indicator.setVault(vault);
    expect(container.querySelector('[role="status"]').textContent).toBe(`Vault · ${label}`);
    expect(container.title).toContain(vault);
    expect(container.title).toContain('inferred');
    expect(document.documentElement.dataset.vaultEnvironment).toBe(environment);
    expect(document.title).toBe(`[Vault: ${label}] JSON Scout`);
  });

  it('keeps the file title when switching environments and clears stale production state', () => {
    const { indicator, container } = setup();
    indicator.setDocumentTitle('config.json — JSON Scout');
    indicator.setVault('kv-prod');
    expect(document.title).toBe('[Vault: PROD] config.json — JSON Scout');
    indicator.setDocumentTitle('notes.md — JSON Scout');
    expect(document.title).toBe('[Vault: PROD] notes.md — JSON Scout');
    indicator.setVault('kv-qa');
    expect(document.title).toBe('[Vault: QA] notes.md — JSON Scout');
    indicator.setVault(null);
    expect(document.title).toBe('notes.md — JSON Scout');
    expect(container.textContent).toContain('No vault');
    expect(document.documentElement.dataset.vaultEnvironment).toBe('none');
  });

  it('sends the same title to the desktop window in order and reports title failures', async () => {
    const onTitleError = vi.fn();
    const setWindowTitle = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue();
    const { indicator } = setup({ setWindowTitle, onTitleError });
    indicator.setVault('kv-prod');
    indicator.setDocumentTitle('config.json — JSON Scout');
    await vi.waitFor(() => expect(setWindowTitle).toHaveBeenLastCalledWith('[Vault: PROD] config.json — JSON Scout'));
    expect(setWindowTitle.mock.calls.map(([title]) => title)).toEqual([
      'JSON Scout', '[Vault: PROD] JSON Scout', '[Vault: PROD] config.json — JSON Scout',
    ]);
    expect(onTitleError).toHaveBeenCalledTimes(1);
  });
});
