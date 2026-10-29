// @vitest-environment jsdom
import html from '../index.html?raw';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('boots the real app with a neutral indicator and keeps the untitled file title', async () => {
  document.documentElement.innerHTML = html;
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await import('../main.js');
  expect(document.querySelector('.environment-badge').textContent).toBe('No vault');
  expect(document.documentElement.dataset.vaultEnvironment).toBe('none');
  expect(document.title).toBe('JSON Scout — Untitled 1');
  // Importing the real editor/app competes with every suite worker on CI.
}, 15_000);
