# Resizable Panels & Toast Placement

## Objective
Let the user resize the side panels, and stop toasts from covering controls.

## Problem
- The left sidebar (Files | Vault) and the right panel (Tools) have fixed
  widths, so the user cannot give the editor or a panel more room.
- Toasts appear at the top right, over the editor's Copy button. After Minify,
  the success toast blocks Copy until it disappears.

## Scope
- A draggable splitter between the left sidebar and the editor, and another
  between the editor and the right panel.
- Toasts move to the bottom right, above the status bar. They stay translucent
  for their whole life and do not intercept clicks, except on their own
  controls.

Out of scope: resizing the diff split, vertical splits, layout presets.

## Decisions
- **Splitters**
  - Each splitter is a `role="separator"` with `aria-orientation="vertical"`,
    `aria-valuenow`/`min`/`max` and a focusable handle.
  - Drag uses pointer events with pointer capture. Arrow keys step 16px,
    Shift+Arrow steps 64px, and Home/End jump to min/max.
  - Double-click resets the panel to its default width.
- **Limits**
  - Each panel is clamped to a minimum and maximum width.
  - The editor always keeps at least a minimum width, so resizing one panel can
    never squeeze the editor away.
  - Limits are re-applied when the window resizes.
- **Persistence**
  - Widths are stored in `localStorage` under `json-scout.layout`, inside
    try/catch, with a fallback to the defaults.
- **Collapse**
  - Collapse/expand keeps working as today. Expanding restores the last width
    the user dragged to.
  - The splitter is hidden or disabled while its panel is collapsed.
  - The existing width transitions are suspended while dragging, so the panel
    follows the pointer without lag. Reduced motion is respected.
- **Toasts**
  - The container is anchored bottom-right, offset above the status bar.
  - The stack grows upward, newest at the bottom.
  - Toasts keep the glass look at a reduced opacity (about 0.85), and the
    exit fade starts from that opacity.
  - The container and the toast body use `pointer-events: none`; only the
    close button and any action button use `pointer-events: auto`. That way a
    toast never blocks a click, wherever it is.
  - Light and dark themes must stay readable.

## Tasks
- [x] L1 — Pure layout model with tests: clamp widths against window width,
      panel min/max and editor min; parse and serialise persisted layout
      tolerantly; keyboard step logic.
      Evidence: `src/ui/layout.js` + `layout.test.js`. RED against an empty
      stub: 48 of 50 failed on assertions. GREEN: 50 of 50 pass. Limits mirror
      the CSS: sidebar 140-400 (default 220), right panel 220-480 (default
      320), editor minimum 320, collapsed rail 32.
- [ ] L2 — Splitter DOM wiring for both panels (pointer drag, keyboard,
      double-click reset, ARIA, persistence, collapse interplay, window
      resize), with jsdom tests.
- [ ] L3 — Toast container bottom-right above the status bar, translucent glass,
      click-through except controls; update any toast tests or positions; the
      exit animation stays sequenced (fade, then collapse).

## Applicable checks
- `npm test`
- `npm run build`
- Manual visual check in both themes (user).

## TDD mode
Enabled (session config). Runner: `vitest run`, with jsdom per file for DOM
tests.

## Delivery
These commits accumulate on `feat/vault-push` with phase 2 and ship in the
same single PR, when the user says so (user decision, 2026-10-01).
