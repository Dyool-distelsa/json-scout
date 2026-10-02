/**
 * Splitter wiring for the two resizable side panels.
 *
 * The widths live in the pure model (layout.js); this module only connects
 * it to the page:
 *  - widths are published as the `--sidebar-width` / `--right-panel-width`
 *    custom properties on the workspace, so the stylesheet's existing width,
 *    transition and `.collapsed` rules stay in charge (a collapsed panel keeps
 *    its rail width, and expanding it returns to the stored width);
 *  - each handle is a keyboard-operable `role="separator"` (arrows, Shift,
 *    Home/End), draggable with pointer capture, and resets on double-click;
 *  - the layout is re-clamped when the window resizes, and whenever the
 *    caller reports a collapse change through `sync()`.
 */
import {
  LAYOUT_LIMITS,
  clampLayout,
  loadLayout,
  nextWidthForKey,
  panelBounds,
  resizePanel,
  saveLayout,
} from './layout.js';

const DRAGGING_BODY_CLASS = 'is-resizing';
const ACTIVE_SPLITTER_CLASS = 'splitter--active';

/**
 * @param {{
 *   workspace: HTMLElement,
 *   sidebar: HTMLElement,
 *   rightPanel: HTMLElement,
 *   sidebarSplitter: HTMLElement,
 *   rightSplitter: HTMLElement,
 *   storage?: Storage | null,
 *   getWindowWidth?: () => number,
 *   scheduleFrame?: (callback: () => void) => unknown,
 *   cancelFrame?: (handle: unknown) => void,
 *   windowTarget?: Window,
 * }} options
 * @returns {{
 *   sync: () => void,
 *   destroy: () => void,
 *   getWidths: () => { sidebar: number, right: number },
 *   setSidebarLabel: (name: string) => void,
 * }}
 */
export function mountSplitters({
  workspace,
  sidebar,
  rightPanel,
  sidebarSplitter,
  rightSplitter,
  storage = null,
  getWindowWidth = () => window.innerWidth,
  scheduleFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (handle) => window.cancelAnimationFrame(handle),
  windowTarget = window,
}) {
  const panels = [
    {
      name: 'sidebar',
      panel: sidebar,
      splitter: sidebarSplitter,
      cssVar: '--sidebar-width',
      label: 'Resize Files panel',
      // Dragging right widens the left panel; dragging left widens the right one.
      direction: 1,
    },
    {
      name: 'right',
      panel: rightPanel,
      splitter: rightSplitter,
      cssVar: '--right-panel-width',
      label: 'Resize Tools panel',
      direction: -1,
    },
  ];

  // What the user last chose (restored when the window grows back), and what
  // is applied now, which is that choice fitted to the window.
  let preferred = loadLayout(storage);
  let applied = preferred;
  let frame = null;
  let drag = null;
  const cleanups = [];

  const isCollapsed = (entry) => entry.panel.classList.contains('collapsed');
  const context = () => ({
    windowWidth: getWindowWidth(),
    collapsed: { sidebar: isCollapsed(panels[0]), right: isCollapsed(panels[1]) },
  });

  /** Fit the preferred widths to the window and reflect them on the page. */
  function apply() {
    const ctx = context();
    // A panel that collapsed under an active drag has nothing left to drag.
    if (drag && ctx.collapsed[drag.entry.name]) endDrag(true);
    applied = clampLayout(preferred, ctx);
    for (const entry of panels) {
      const { name, splitter, cssVar } = entry;
      workspace.style.setProperty(cssVar, `${applied[name]}px`);
      const { min, max } = panelBounds(name, applied, ctx);
      splitter.setAttribute('aria-valuenow', String(applied[name]));
      splitter.setAttribute('aria-valuemin', String(min));
      splitter.setAttribute('aria-valuemax', String(max));
      // A collapsed panel is a slim rail with nothing to resize.
      const disabled = ctx.collapsed[name];
      splitter.hidden = disabled;
      splitter.tabIndex = disabled ? -1 : 0;
      if (disabled) splitter.setAttribute('aria-disabled', 'true');
      else splitter.removeAttribute('aria-disabled');
    }
  }

  /**
   * Move one panel to `width` (clamped); persist when asked. Only this panel's
   * preference changes: the other keeps what the user chose even while the
   * window is too narrow to show it, so growing the window restores it.
   */
  function setWidth(entry, width, { persist }) {
    const resized = resizePanel(entry.name, applied, width, context());
    preferred = { ...preferred, [entry.name]: resized[entry.name] };
    apply();
    if (persist) saveLayout(storage, preferred);
  }

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }

  function endDrag(persist) {
    if (!drag) return;
    const { entry, moved, pointerId } = drag;
    drag = null;
    try {
      entry.splitter.releasePointerCapture?.(pointerId);
    } catch {
      // The pointer is already gone or was never captured; nothing to release.
    }
    entry.splitter.classList.remove(ACTIVE_SPLITTER_CLASS);
    workspace.ownerDocument.body.classList.remove(DRAGGING_BODY_CLASS);
    if (persist && moved) saveLayout(storage, preferred);
  }

  for (const entry of panels) {
    const { name, splitter } = entry;
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'vertical');
    splitter.setAttribute('aria-label', entry.label);
    splitter.setAttribute('aria-controls', entry.panel.id);

    listen(splitter, 'keydown', (event) => {
      if (isCollapsed(entry) || event.ctrlKey || event.metaKey || event.altKey) return;
      const { min, max } = panelBounds(name, applied, context());
      const next = nextWidthForKey({ panel: name, key: event.key, shiftKey: event.shiftKey, width: applied[name], min, max });
      if (next === null) return;
      event.preventDefault();
      setWidth(entry, next, { persist: true });
    });

    listen(splitter, 'dblclick', () => {
      if (isCollapsed(entry)) return;
      setWidth(entry, LAYOUT_LIMITS[name].default, { persist: true });
    });

    listen(splitter, 'pointerdown', (event) => {
      if (isCollapsed(entry) || event.button !== 0) return;
      event.preventDefault();
      drag = { entry, pointerId: event.pointerId, startX: event.clientX, startWidth: applied[name], moved: false };
      try {
        splitter.setPointerCapture?.(event.pointerId);
      } catch {
        // The pointer may already be gone; the drag still works while it stays over the handle.
      }
      splitter.classList.add(ACTIVE_SPLITTER_CLASS);
      workspace.ownerDocument.body.classList.add(DRAGGING_BODY_CLASS);
    });

    listen(splitter, 'pointermove', (event) => {
      if (!drag || drag.entry !== entry || event.pointerId !== drag.pointerId || isCollapsed(entry)) return;
      drag.moved = true;
      setWidth(entry, drag.startWidth + entry.direction * (event.clientX - drag.startX), { persist: false });
    });

    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      listen(splitter, type, (event) => {
        if (drag && drag.entry === entry && event.pointerId === drag.pointerId) endDrag(true);
      });
    }
  }

  // Throttle to one re-clamp per frame while the window is being resized.
  listen(windowTarget, 'resize', () => {
    if (frame !== null) return;
    frame = scheduleFrame(() => {
      frame = null;
      apply();
    });
  });

  apply();

  return {
    /** Re-read the collapsed state (and the window) after the caller toggled a panel. */
    sync: apply,
    getWidths: () => ({ ...applied }),
    /** Name the left handle after what the sidebar currently shows (Files, Vault). */
    setSidebarLabel(name) {
      sidebarSplitter.setAttribute('aria-label', `Resize ${name} panel`);
    },
    destroy() {
      endDrag(false);
      if (frame !== null) cancelFrame(frame);
      frame = null;
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
