/**
 * Pure layout model for the two resizable side panels.
 *
 * No DOM, no storage globals: the splitter wiring (splitters.js) feeds it the
 * window width and the collapsed state, and writes the result to CSS custom
 * properties. Everything here is deterministic and unit tested.
 *
 * The limits mirror the `min-width` / `max-width` the stylesheet already put on
 * `.sidebar` (140-400) and `.right-panel` (220-480), and the defaults mirror
 * the `--sidebar-width` / `--right-panel-width` tokens (220 / 320). Keep the
 * CSS and these numbers in step.
 */

/** localStorage key holding the persisted widths. */
export const LAYOUT_STORAGE_KEY = 'json-scout.layout';

/** Keyboard step in px, and the larger step used with Shift. */
export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;

/**
 * Per-panel limits in px, the width the editor must always keep, and the width
 * of a collapsed panel's rail (`--rail-width`).
 */
export const LAYOUT_LIMITS = Object.freeze({
  sidebar: Object.freeze({ min: 140, max: 400, default: 220 }),
  right: Object.freeze({ min: 220, max: 480, default: 320 }),
  editorMin: 320,
  railWidth: 32,
});

/** Widths used when nothing valid is stored. */
export const DEFAULT_LAYOUT = Object.freeze({
  sidebar: LAYOUT_LIMITS.sidebar.default,
  right: LAYOUT_LIMITS.right.default,
});

const PANELS = ['sidebar', 'right'];

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const otherPanel = (panel) => (panel === 'sidebar' ? 'right' : 'sidebar');

/** One width, rounded and held inside the panel's own limits; default if unusable. */
function sanitizeWidth(panel, value) {
  const { min, max, default: dflt } = LAYOUT_LIMITS[panel];
  return isFiniteNumber(value) ? clamp(Math.round(value), min, max) : dflt;
}

function sanitizeWidths(widths) {
  return { sidebar: sanitizeWidth('sidebar', widths?.sidebar), right: sanitizeWidth('right', widths?.right) };
}

/** Width a panel takes from the row: its rail while collapsed, else its width. */
function occupied(panel, widths, ctx) {
  return ctx?.collapsed?.[panel] ? LAYOUT_LIMITS.railWidth : widths[panel];
}

/** Space available to the two panels together, or Infinity when the window is unknown. */
function panelBudget(ctx) {
  return isFiniteNumber(ctx?.windowWidth) ? ctx.windowWidth - LAYOUT_LIMITS.editorMin : Infinity;
}

/**
 * The range a panel may be resized to right now: its own limits, further
 * capped so the editor keeps its minimum next to the other panel.
 * @param {'sidebar'|'right'} panel
 * @param {{ sidebar: number, right: number }} widths
 * @param {{ windowWidth?: number, collapsed?: { sidebar?: boolean, right?: boolean } }} [ctx]
 * @returns {{ min: number, max: number }}
 */
export function panelBounds(panel, widths, ctx = {}) {
  const { min, max } = LAYOUT_LIMITS[panel];
  const other = otherPanel(panel);
  const room = panelBudget(ctx) - occupied(other, sanitizeWidths(widths), ctx);
  return { min, max: Math.max(min, Math.min(max, room)) };
}

/**
 * Fit both widths to the panel limits and the window. When the pair is too
 * wide for the window, the open panels give up space in proportion to how far
 * they sit above their minimum; a collapsed panel keeps its stored width.
 * @param {{ sidebar: number, right: number }} widths
 * @param {{ windowWidth?: number, collapsed?: { sidebar?: boolean, right?: boolean } }} [ctx]
 * @returns {{ sidebar: number, right: number }}
 */
export function clampLayout(widths, ctx = {}) {
  const result = sanitizeWidths(widths);
  const excess = PANELS.reduce((sum, panel) => sum + occupied(panel, result, ctx), 0) - panelBudget(ctx);
  if (!(excess > 0)) return result;

  const open = PANELS.filter((panel) => !ctx?.collapsed?.[panel]);
  const slack = (panel) => result[panel] - LAYOUT_LIMITS[panel].min;
  const totalSlack = open.reduce((sum, panel) => sum + slack(panel), 0);
  if (totalSlack <= excess) {
    for (const panel of open) result[panel] = LAYOUT_LIMITS[panel].min;
    return result;
  }

  let remaining = excess;
  for (const panel of open) {
    const cut = Math.floor((excess * slack(panel)) / totalSlack);
    result[panel] -= cut;
    remaining -= cut;
  }
  // Whole-pixel leftovers go to whichever open panel can still give.
  for (const panel of open) {
    if (remaining > 0 && result[panel] > LAYOUT_LIMITS[panel].min) {
      result[panel] -= 1;
      remaining -= 1;
    }
  }
  return result;
}

/**
 * Resize one panel to `requested`, clamped to its bounds. The other panel
 * keeps the width it has once the layout fits the window.
 * @param {'sidebar'|'right'} panel
 * @param {{ sidebar: number, right: number }} widths
 * @param {number} requested
 * @param {{ windowWidth?: number, collapsed?: { sidebar?: boolean, right?: boolean } }} [ctx]
 * @returns {{ sidebar: number, right: number }}
 */
export function resizePanel(panel, widths, requested, ctx = {}) {
  const base = clampLayout(widths, ctx);
  if (!isFiniteNumber(requested)) return base;
  const { min, max } = panelBounds(panel, base, ctx);
  return { ...base, [panel]: clamp(Math.round(requested), min, max) };
}

/**
 * Read a persisted layout. Anything that is not a usable `{ sidebar, right }`
 * object yields the defaults, and each value is held inside its own limits.
 * @param {unknown} raw
 * @returns {{ sidebar: number, right: number }}
 */
export function parseLayout(raw) {
  if (typeof raw !== 'string') return { ...DEFAULT_LAYOUT };
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_LAYOUT };
    return sanitizeWidths(parsed);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

/**
 * @param {{ sidebar: number, right: number }} widths
 * @returns {string} the JSON to persist, with whole in-range pixel widths only.
 */
export function serializeLayout(widths) {
  return JSON.stringify(sanitizeWidths(widths));
}

/**
 * Width a splitter should take for a key press, or null when the key is not
 * one it handles. Direction aware: a drag handle on the inner edge of the
 * right panel moves the opposite way to the left one, so ArrowLeft grows the
 * right panel. Home and End jump to the bounds.
 * @param {{ panel: 'sidebar'|'right', key: string, shiftKey?: boolean, width: number, min: number, max: number }} input
 * @returns {number|null}
 */
export function nextWidthForKey({ panel, key, shiftKey = false, width, min, max }) {
  if (key === 'Home') return min;
  if (key === 'End') return max;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const growKey = panel === 'sidebar' ? 'ArrowRight' : 'ArrowLeft';
  const step = shiftKey ? KEY_STEP_LARGE : KEY_STEP;
  return clamp(width + (key === growKey ? step : -step), min, max);
}

/**
 * @param {Pick<Storage, 'getItem'>|null|undefined} storage
 * @returns {{ sidebar: number, right: number }} the stored widths, or the
 *   defaults when storage is missing, empty, blocked or garbled.
 */
export function loadLayout(storage) {
  try {
    return parseLayout(storage ? storage.getItem(LAYOUT_STORAGE_KEY) : null);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

/**
 * @param {Pick<Storage, 'setItem'>|null|undefined} storage
 * @param {{ sidebar: number, right: number }} widths
 * @returns {boolean} whether the layout was written.
 */
export function saveLayout(storage, widths) {
  try {
    if (!storage) return false;
    storage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(widths));
    return true;
  } catch {
    return false;
  }
}
