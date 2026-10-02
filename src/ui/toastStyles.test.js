import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * Contract tests for the toast stylesheet. A jsdom test cannot compute the
 * cascade, so these read main.css and check the declarations that carry the
 * behaviour: where the stack is anchored, that a toast never intercepts a click
 * except on its own controls, that the surface is translucent, and that the
 * exit stays sequenced (fade, then collapse).
 */
const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every [property, value] declared by a rule whose selector list names `selector`, in file order. */
function declarations(selector) {
  const found = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some((candidate) => candidate.trim() === selector)) continue;
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon > 0) found.push([declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]);
    }
  }
  return found;
}

/** The value that wins in the cascade for `property` (the last one declared). */
const effective = (selector, property) =>
  declarations(selector)
    .filter(([name]) => name === property)
    .at(-1)?.[1];

describe('toast container placement', () => {
  it('is anchored bottom-right, above the status bar', () => {
    expect(effective('.toast-container', 'position')).toBe('fixed');
    expect(effective('.toast-container', 'right')).toBeDefined();
    expect(effective('.toast-container', 'top')).toBeUndefined();
    expect(effective('.toast-container', 'bottom')).toContain('var(--statusbar-height)');
  });

  it('stacks oldest first, so the newest toast sits nearest the corner and the stack grows upward', () => {
    expect(effective('.toast-container', 'flex-direction')).toBe('column');
  });

  it('stays above the rest of the app', () => {
    expect(effective('.toast-container', 'z-index')).toBe('var(--z-toast)');
  });
});

describe('toast click-through', () => {
  it('lets clicks pass through the container and the toast body', () => {
    expect(effective('.toast-container', 'pointer-events')).toBe('none');
    expect(effective('.toast', 'pointer-events')).toBe('none');
  });

  it('keeps the close button and any action button clickable', () => {
    expect(effective('.toast__close', 'pointer-events')).toBe('auto');
    expect(effective('.toast button', 'pointer-events')).toBe('auto');
  });
});

describe('toast surface', () => {
  it('is a translucent glass surface that still blurs what is underneath', () => {
    const background = effective('.toast', 'background');
    expect(background).toContain('color-mix');
    expect(background).toContain('transparent');
    expect(effective('.toast', 'backdrop-filter')).toContain('blur(');
  });

  it('keeps the text itself opaque, so it stays readable in both themes', () => {
    expect(effective('.toast', 'opacity')).toBe('0');
    expect(effective('.toast--visible', 'opacity')).toBe('1');
    expect(effective('.toast', 'color')).toBe('var(--color-text)');
  });

  it('never gives the text colour an alpha, mix or transparent component', () => {
    // Whatever declaration wins, and any other that could win, must be a plain
    // colour: the glass effect belongs to the background only.
    const alpha = /color-mix|transparent|rgba\(|hsla\(|(?:rgb|hsl|oklch|oklab|lab|lch|hwb)\([^)]*\/|#[0-9a-f]{4}\b|#[0-9a-f]{8}\b/i;
    const colors = declarations('.toast')
      .filter(([name]) => name === 'color')
      .map(([, value]) => value);
    expect(colors.length).toBeGreaterThan(0);
    for (const value of colors) expect(value).not.toMatch(alpha);
    expect(effective('.toast', 'color')).not.toMatch(alpha);
    // Nothing inside dims the message text either.
    for (const selector of ['.toast__message', '.toast--visible']) {
      for (const value of declarations(selector).filter(([name]) => name === 'color').map(([, v]) => v)) {
        expect(value).not.toMatch(alpha);
      }
    }
    expect(effective('.toast__message', 'opacity')).toBeUndefined();
  });
});

describe('toast motion', () => {
  it('enters from the corner side (below) and leaves toward it', () => {
    expect(effective('.toast', 'transform')).toMatch(/translateY\(\d/);
    expect(effective('.toast--leaving', 'transform')).toMatch(/translateY\(\d/);
  });

  it('still sequences the exit: fade over the exit duration, then collapse after it', () => {
    const transition = effective('.toast--leaving', 'transition');
    expect(transition).toContain('opacity var(--motion-duration-exit)');
    expect(transition).toMatch(/height var\(--motion-duration-base\) var\(--motion-ease-standard\) var\(--motion-duration-exit\)/);
  });

  it('leaves reduced-motion handling to the single global rule', () => {
    expect(css.match(/@media \(prefers-reduced-motion: reduce\)/g)).toHaveLength(1);
  });
});
