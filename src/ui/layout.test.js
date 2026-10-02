import { describe, it, expect } from 'vitest';
import {
  LAYOUT_STORAGE_KEY,
  LAYOUT_LIMITS,
  DEFAULT_LAYOUT,
  KEY_STEP,
  KEY_STEP_LARGE,
  panelBounds,
  clampLayout,
  resizePanel,
  parseLayout,
  serializeLayout,
  nextWidthForKey,
  loadLayout,
  saveLayout,
} from './layout.js';

const WIDE = { windowWidth: 1600 };

describe('constants', () => {
  it('uses the documented storage key', () => {
    expect(LAYOUT_STORAGE_KEY).toBe('json-scout.layout');
  });

  it('keeps every default inside its own limits and the editor minimum reachable', () => {
    for (const panel of ['sidebar', 'right']) {
      const { min, max, default: dflt } = LAYOUT_LIMITS[panel];
      expect(min).toBeLessThanOrEqual(dflt);
      expect(dflt).toBeLessThanOrEqual(max);
      expect(DEFAULT_LAYOUT[panel]).toBe(dflt);
    }
    expect(LAYOUT_LIMITS.editorMin).toBeGreaterThan(0);
  });

  it('steps 16px, or 64px with Shift', () => {
    expect(KEY_STEP).toBe(16);
    expect(KEY_STEP_LARGE).toBe(64);
  });
});

describe('panelBounds', () => {
  it('returns the plain limits when the window is wide', () => {
    expect(panelBounds('sidebar', DEFAULT_LAYOUT, WIDE)).toEqual({
      min: LAYOUT_LIMITS.sidebar.min,
      max: LAYOUT_LIMITS.sidebar.max,
    });
    expect(panelBounds('right', DEFAULT_LAYOUT, WIDE)).toEqual({
      min: LAYOUT_LIMITS.right.min,
      max: LAYOUT_LIMITS.right.max,
    });
  });

  it('lowers the maximum so the editor keeps its minimum next to the other panel', () => {
    const windowWidth = 900;
    const widths = { sidebar: 200, right: 300 };
    // 900 - editorMin(320) - right(300) = 280
    expect(panelBounds('sidebar', widths, { windowWidth }).max).toBe(280);
    // 900 - 320 - 200 = 380
    expect(panelBounds('right', widths, { windowWidth }).max).toBe(380);
  });

  it('counts a collapsed neighbour as the slim rail, not as its stored width', () => {
    const widths = { sidebar: 200, right: 450 };
    const ctx = { windowWidth: 900, collapsed: { sidebar: false, right: true } };
    // 900 - 320 - rail(32) = 548, capped by the sidebar limit
    expect(panelBounds('sidebar', widths, ctx).max).toBe(LAYOUT_LIMITS.sidebar.max);
    const tight = { windowWidth: 600, collapsed: { sidebar: false, right: true } };
    expect(panelBounds('sidebar', widths, tight).max).toBe(600 - LAYOUT_LIMITS.editorMin - LAYOUT_LIMITS.railWidth);
  });

  it('never reports a maximum below the minimum, even in a tiny window', () => {
    const bounds = panelBounds('sidebar', DEFAULT_LAYOUT, { windowWidth: 300 });
    expect(bounds.max).toBe(bounds.min);
  });

  it('ignores the window when its width is unknown', () => {
    expect(panelBounds('right', DEFAULT_LAYOUT, {}).max).toBe(LAYOUT_LIMITS.right.max);
    expect(panelBounds('right', DEFAULT_LAYOUT, { windowWidth: Number.NaN }).max).toBe(LAYOUT_LIMITS.right.max);
  });
});

describe('clampLayout', () => {
  it('leaves a layout that fits untouched', () => {
    expect(clampLayout({ sidebar: 260, right: 360 }, WIDE)).toEqual({ sidebar: 260, right: 360 });
  });

  it('clamps each panel to its own limits', () => {
    expect(clampLayout({ sidebar: 10, right: 9999 }, WIDE)).toEqual({
      sidebar: LAYOUT_LIMITS.sidebar.min,
      right: LAYOUT_LIMITS.right.max,
    });
  });

  it('falls back to the default for a value that is not a finite number', () => {
    expect(clampLayout({ sidebar: Number.NaN, right: 'wide' }, WIDE)).toEqual(DEFAULT_LAYOUT);
  });

  it('rounds to whole pixels', () => {
    expect(clampLayout({ sidebar: 200.6, right: 300.4 }, WIDE)).toEqual({ sidebar: 201, right: 300 });
  });

  it('shrinks both panels, proportionally to their slack, until the editor keeps its minimum', () => {
    // Window 900: panels may take 900 - 320 = 580, but 400 + 480 = 880 is asked.
    const result = clampLayout({ sidebar: 400, right: 480 }, { windowWidth: 900 });
    expect(result.sidebar + result.right).toBe(900 - LAYOUT_LIMITS.editorMin);
    expect(result.sidebar).toBeGreaterThanOrEqual(LAYOUT_LIMITS.sidebar.min);
    expect(result.right).toBeGreaterThanOrEqual(LAYOUT_LIMITS.right.min);
    // The panel with more slack above its minimum gives up more.
    expect(400 - result.sidebar).toBeGreaterThan(0);
    expect(480 - result.right).toBeGreaterThan(0);
  });

  it('settles both panels at their minimum when the window is too small for anything else', () => {
    expect(clampLayout({ sidebar: 300, right: 400 }, { windowWidth: 500 })).toEqual({
      sidebar: LAYOUT_LIMITS.sidebar.min,
      right: LAYOUT_LIMITS.right.min,
    });
  });

  it('only shrinks the open panel when the other one is collapsed, and keeps the collapsed width', () => {
    const ctx = { windowWidth: 600, collapsed: { sidebar: true, right: false } };
    const result = clampLayout({ sidebar: 300, right: 400 }, ctx);
    expect(result.sidebar).toBe(300);
    // 600 - 320 - rail(32) = 248
    expect(result.right).toBe(600 - LAYOUT_LIMITS.editorMin - LAYOUT_LIMITS.railWidth);
  });

  it('is idempotent', () => {
    const ctx = { windowWidth: 760 };
    const once = clampLayout({ sidebar: 380, right: 470 }, ctx);
    expect(clampLayout(once, ctx)).toEqual(once);
  });

  it('re-clamps when the window shrinks and keeps the larger layout in a larger window', () => {
    const widths = { sidebar: 300, right: 400 };
    expect(clampLayout(widths, { windowWidth: 1400 })).toEqual(widths);
    const small = clampLayout(widths, { windowWidth: 800 });
    expect(small.sidebar + small.right).toBeLessThanOrEqual(800 - LAYOUT_LIMITS.editorMin);
  });
});

describe('resizePanel', () => {
  it('moves one panel and leaves the other as it was', () => {
    expect(resizePanel('sidebar', { sidebar: 220, right: 320 }, 300, WIDE)).toEqual({ sidebar: 300, right: 320 });
    expect(resizePanel('right', { sidebar: 220, right: 320 }, 400, WIDE)).toEqual({ sidebar: 220, right: 400 });
  });

  it('clamps to the panel limits', () => {
    expect(resizePanel('sidebar', DEFAULT_LAYOUT, 5000, WIDE).sidebar).toBe(LAYOUT_LIMITS.sidebar.max);
    expect(resizePanel('right', DEFAULT_LAYOUT, 1, WIDE).right).toBe(LAYOUT_LIMITS.right.min);
  });

  it('cannot squeeze the editor below its minimum', () => {
    const windowWidth = 900;
    const result = resizePanel('sidebar', { sidebar: 220, right: 320 }, 400, { windowWidth });
    expect(result.sidebar).toBe(windowWidth - LAYOUT_LIMITS.editorMin - 320);
    expect(result.right).toBe(320);
  });

  it('treats a non-numeric request as no change', () => {
    expect(resizePanel('sidebar', { sidebar: 250, right: 320 }, Number.NaN, WIDE)).toEqual({ sidebar: 250, right: 320 });
  });
});

describe('parseLayout', () => {
  it('reads a stored layout', () => {
    expect(parseLayout('{"sidebar":260,"right":360}')).toEqual({ sidebar: 260, right: 360 });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an empty string', ''],
    ['not JSON', 'sidebar=260'],
    ['a JSON array', '[1,2]'],
    ['a JSON string', '"wide"'],
    ['a JSON null', 'null'],
    ['an empty object', '{}'],
    ['wrong types', '{"sidebar":"260","right":null}'],
  ])('falls back to the defaults for %s', (_label, raw) => {
    expect(parseLayout(raw)).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps the good half and defaults the bad half', () => {
    expect(parseLayout('{"sidebar":260,"right":"huge"}')).toEqual({ sidebar: 260, right: DEFAULT_LAYOUT.right });
    expect(parseLayout('{"right":380}')).toEqual({ sidebar: DEFAULT_LAYOUT.sidebar, right: 380 });
  });

  it('clamps stored values to the panel limits', () => {
    expect(parseLayout('{"sidebar":1,"right":99999}')).toEqual({
      sidebar: LAYOUT_LIMITS.sidebar.min,
      right: LAYOUT_LIMITS.right.max,
    });
  });

  it('ignores unknown keys', () => {
    expect(parseLayout('{"sidebar":260,"right":360,"extra":1}')).toEqual({ sidebar: 260, right: 360 });
  });

  it('never returns the shared defaults object itself', () => {
    expect(parseLayout(null)).not.toBe(DEFAULT_LAYOUT);
  });
});

describe('serializeLayout', () => {
  it('round-trips through parseLayout', () => {
    const widths = { sidebar: 275, right: 410 };
    expect(parseLayout(serializeLayout(widths))).toEqual(widths);
  });

  it('writes whole, in-range pixels only', () => {
    expect(JSON.parse(serializeLayout({ sidebar: 200.4, right: 99999 }))).toEqual({
      sidebar: 200,
      right: LAYOUT_LIMITS.right.max,
    });
  });

  it('writes the defaults for garbage input', () => {
    expect(JSON.parse(serializeLayout({ sidebar: 'x' }))).toEqual(DEFAULT_LAYOUT);
    expect(JSON.parse(serializeLayout(null))).toEqual(DEFAULT_LAYOUT);
  });
});

describe('nextWidthForKey', () => {
  const bounds = { min: 140, max: 400 };
  const args = (over) => ({ panel: 'sidebar', key: 'ArrowRight', shiftKey: false, width: 220, ...bounds, ...over });

  it('grows the left sidebar with ArrowRight and shrinks it with ArrowLeft', () => {
    expect(nextWidthForKey(args({ key: 'ArrowRight' }))).toBe(236);
    expect(nextWidthForKey(args({ key: 'ArrowLeft' }))).toBe(204);
  });

  it('is direction aware: the right panel grows with ArrowLeft', () => {
    expect(nextWidthForKey(args({ panel: 'right', key: 'ArrowLeft', width: 320 }))).toBe(336);
    expect(nextWidthForKey(args({ panel: 'right', key: 'ArrowRight', width: 320 }))).toBe(304);
  });

  it('steps 64px with Shift', () => {
    expect(nextWidthForKey(args({ key: 'ArrowRight', shiftKey: true }))).toBe(284);
    expect(nextWidthForKey(args({ panel: 'right', key: 'ArrowLeft', shiftKey: true, width: 320 }))).toBe(384);
  });

  it('jumps to the minimum with Home and the maximum with End', () => {
    expect(nextWidthForKey(args({ key: 'Home' }))).toBe(140);
    expect(nextWidthForKey(args({ key: 'End' }))).toBe(400);
    expect(nextWidthForKey(args({ panel: 'right', key: 'Home', min: 220, max: 480, width: 320 }))).toBe(220);
    expect(nextWidthForKey(args({ panel: 'right', key: 'End', min: 220, max: 480, width: 320 }))).toBe(480);
  });

  it('clamps a step at the bounds', () => {
    expect(nextWidthForKey(args({ key: 'ArrowRight', width: 395 }))).toBe(400);
    expect(nextWidthForKey(args({ key: 'ArrowLeft', width: 145 }))).toBe(140);
    expect(nextWidthForKey(args({ key: 'ArrowLeft', shiftKey: true, width: 150 }))).toBe(140);
  });

  it('returns null for a key the splitter does not handle', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'a', 'Tab', ' ']) {
      expect(nextWidthForKey(args({ key }))).toBeNull();
    }
  });
});

describe('loadLayout / saveLayout', () => {
  const memoryStorage = (initial = {}) => {
    const data = { ...initial };
    return {
      data,
      getItem: (key) => (key in data ? data[key] : null),
      setItem: (key, value) => {
        data[key] = String(value);
      },
    };
  };

  it('loads the stored layout', () => {
    const storage = memoryStorage({ [LAYOUT_STORAGE_KEY]: '{"sidebar":250,"right":350}' });
    expect(loadLayout(storage)).toEqual({ sidebar: 250, right: 350 });
  });

  it('falls back to the defaults when nothing is stored or there is no storage', () => {
    expect(loadLayout(memoryStorage())).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  it('falls back to the defaults when reading throws', () => {
    const storage = {
      getItem() {
        throw new Error('blocked');
      },
    };
    expect(loadLayout(storage)).toEqual(DEFAULT_LAYOUT);
  });

  it('saves under the layout key and reports success', () => {
    const storage = memoryStorage();
    expect(saveLayout(storage, { sidebar: 250, right: 350 })).toBe(true);
    expect(JSON.parse(storage.data[LAYOUT_STORAGE_KEY])).toEqual({ sidebar: 250, right: 350 });
  });

  it('reports failure instead of throwing when the write is refused or there is no storage', () => {
    const full = {
      setItem() {
        throw new Error('quota');
      },
    };
    expect(saveLayout(full, DEFAULT_LAYOUT)).toBe(false);
    expect(saveLayout(null, DEFAULT_LAYOUT)).toBe(false);
  });
});
