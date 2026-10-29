import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Structural CSS contracts, not proof of browser rendering. Follow the
// existing toastStyles tests: jsdom does not compute custom-property mixes.
const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function value(selector, property) {
  const found = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some(candidate => candidate.trim() === selector)) continue;
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (declaration.slice(0, colon).trim() === property) found.push(declaration.slice(colon + 1).trim());
    }
  }
  return found.at(-1);
}

describe('environment chrome CSS contracts', () => {
  it('tints normal and hovered scroll thumbs from the active environment, not the tab origin', () => {
    const selector = ":root[data-vault-environment]:not([data-vault-environment='none'])";
    expect(value(selector, '--color-scrollbar')).toContain('var(--vault-color)');
    expect(value(selector, '--color-scrollbar-hover')).toContain('var(--vault-color)');
    expect(value('*', 'scrollbar-color')).toBe('var(--color-scrollbar) transparent');
    expect(value('::-webkit-scrollbar-thumb', 'background')).toBe('var(--color-scrollbar)');
    expect(value('::-webkit-scrollbar-thumb:hover', 'background')).toBe('var(--color-scrollbar-hover)');
    expect(value('.cm-scroller', 'scrollbar-color')).toBe('unset');
    expect(value('.cm-scroller::-webkit-scrollbar', 'width')).toBe('18px');
    expect(value(":root[data-theme='light']", '--color-scrollbar')).toBeDefined();
    expect(value(':root', '--color-scrollbar')).toBeDefined();
  });

  it('colors the logo dot and retained tab borders with their respective environment', () => {
    expect(value('.environment-brand__dot', 'background')).toBe('var(--vault-color)');
    expect(value('.doc-tab[data-vault-environment]', 'box-shadow')).toContain('var(--vault-color)');
    expect(value('[data-vault-environment=\'prod\']', '--vault-color')).toBe('var(--color-error)');
    expect(value('[data-vault-environment=\'qa\']', '--vault-color')).toBe('var(--color-warning)');
    expect(value('[data-vault-environment=\'dev\']', '--vault-color')).toBe('var(--vault-dev)');
  });

  it('animates the logo once using the shared motion scale and global reduced-motion rule', () => {
    const animation = value('.environment-brand__logo', 'animation');
    expect(animation).toContain('scout-arrive');
    expect(animation).toContain('var(--motion-duration-slow)');
    expect(animation).not.toContain('infinite');
    expect(css).toContain('@keyframes scout-arrive');
    expect(css.match(/@media \(prefers-reduced-motion: reduce\)/g)).toHaveLength(1);
    expect(css).toMatch(/animation-duration:\s*0\.001ms !important/);
    expect(css).toMatch(/animation-iteration-count:\s*1 !important/);
  });
});
