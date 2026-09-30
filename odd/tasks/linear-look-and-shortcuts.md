# Linear/Raycast look and feel + keyboard shortcuts

- Branch: feat/linear-look-and-shortcuts (from main @ 09ee339)
- TDD: enabled (source: session config "Strict TDD Mode"), runner: `npx vitest run` (node env, no DOM → test pure logic only)
- Release: accumulate; do NOT bump version or tag (user wants one big release later)

## Objective
Restyle the app toward a minimal Linear/Raycast look (user choice) and add keyboard shortcuts.

## Problem
UI is "ugly" per user. Mapping found: no spacing/radius/type/z-index tokens; 15+ padding values, mixed radii (3/4/6/8px) and font sizes; diff/dropzone tints hardcoded rgba (not theme-aware); missing focus-visible on inputs, tree nodes, sidebar items, primary/danger buttons; toolbar select/input lack font-family; CodeMirror palette hardcoded in JS (editor.js:30-51) and uses stock highlight style; light palette has no selection rule. Only 4 shortcuts exist (main.js:515-532: Ctrl+S, Ctrl+O, Ctrl+Shift+F, Ctrl+Shift+M).

## Scope
- CSS tokens (spacing, radius, type scale, z-index), refined palette, consistent components, focus states, theme-aware tints (src/styles/main.css)
- CodeMirror theme + themed JSON syntax highlighting sharing the palette (src/ui/editor.js)
- Toolbar polish: remove inline styles (src/ui/toolbar.js, index.html)
- Shortcuts: pure `src/ui/shortcuts.js` (+ tests), wire in main.js, tooltips show hints
Out of scope: behavior changes to tools, new panels, cheat-sheet overlay, version bump/tag.

## Shortcut table (conventional defaults; Mod = Ctrl/Cmd)
Mod+O open · Mod+S save · Mod+Shift+S save as · Mod+Shift+F format · Mod+Shift+M minify · Mod+Shift+Enter validate · Mod+Shift+R repair · Mod+Shift+O sort keys · Mod+Shift+D toggle diff · Mod+B toggle sidebar · Mod+J toggle right panel · Mod+Shift+T toggle theme. Existing CodeMirror keys (Mod+F, undo/redo, fold) untouched.

## Constraints
Artifacts in English. No AI attribution in commits (user rule). Conventional commits. ~400 changed-line heuristic per task is advisory only.

## Tasks
- [x] T1 Design tokens + restyle main.css (Linear-like; route: delegated writer)
- [x] T2 CodeMirror theme/highlight from shared palette (route: delegated writer, same as T1)
- [x] T3 Toolbar/markup polish, inline styles to CSS (route: delegated writer, same as T1)
- [x] T5 Motion layer: purposeful, minimal dynamics (after T4; route: delegated writer). Scope: sliding active-tab indicator; animated panel collapse width (no snap); press/hover micro-interactions; brief accent flash on the editor after Format/Minify/Repair; stats tiles fade-in stagger and histogram bars growing; blurred glass dropdown/toasts; soft top accent glow. All gated by prefers-reduced-motion. Optional follow-up (needs user OK): Ctrl+K command palette.
- [x] T4 Shortcuts: shortcuts.js RED→GREEN, wire main.js (+ expose collapse toggles), tooltips (route: delegated writer, after T1-3: shares toolbar.js)

## Acceptance
`npx vitest run` green, `npm run build` green; no hardcoded rgba tints left for diff/dropzone; all interactive controls have :focus-visible; every shortcut in table works and is shown in tooltip.

## Route declaration
Mapping trigger fired (4+ files) → explorer used. Writer trigger fired (2+ non-trivial files) → delegated writers, sequential.

## Progress / evidence
- T1-T3 (delegated writer, uncommitted pending parent commit): main.css rewritten on tokens (space/radius/type/z-index, shared --focus-ring, color-mix tints); palette dark #0f1012/#16171a/#1c1d21, accent #5e6ad2, text #e6e7ea/#8a8f98; light counterpart. editor.js: shared `palette` object + themed HighlightStyle (added @lezer/highlight dependency, already installed transitively). toolbar.js: inline styles -> .toolbar__label; dividers/ghost buttons in CSS.
- Checks observed: `npx vitest run` -> 22 files, 310 tests passed; `npm run build` -> built OK (chunk-size warning pre-existing).
- Hardcoded color scan of main.css: rgba/hex only inside the two token blocks (lines 1-125); none in components.
- Not visually verified in a running app.
- T4 (delegated writer, uncommitted pending parent commit): new pure src/ui/shortcuts.js (SHORTCUTS, matchShortcut, formatShortcut, detectMac) + shortcuts.test.js; collapsible.js gained shouldToggleOnHeaderClick (tested); main.js: wireCollapse returns toggle(), keydown listener now dispatches via matchShortcut; toolbar.js tooltips/File menu hints generated from formatShortcut.
- T4 TDD: RED shortcuts.test.js -> `Error: Cannot find module './shortcuts.js' imported from ...shortcuts.test.js`; collapsible RED -> `TypeError: shouldToggleOnHeaderClick is not a function` (2 failed | 2 passed). GREEN: shortcuts 34 passed.
- T4 checks observed: `npx vitest run` -> 23 files, 346 tests passed; `npm run build` -> built OK.
- T4 collisions resolved by parent: CodeMirror owns Mod-Enter (insertBlankLine) and Mod-Shift-l (selectSelectionMatches), so validate was rebound to Mod+Shift+Enter and theme toggle to Mod+Shift+T. Verified free in defaultKeymap/historyKeymap/searchKeymap/foldKeymap/indentWithTab. RED: 7 tests failed after updating expectations; GREEN after the table change.
- Not exercised in a running app (no DOM test env).
- T5 (delegated writer, uncommitted pending parent commit): new src/ui/feedback.js (flashEditor, retrigger-safe) + feedback.test.js; main.js calls flashPrimaryEditor on Format/Minify/Repair/Sort Keys/Escape/Unescape success paths only; rightPanel.js: sliding .tab-indicator (placed on click + ResizeObserver) and --i stagger vars on stats tiles/rows; main.css: sidebar/right-panel width+min-width transitions with clipped fixed-width content and delayed rail-label fade, tab/icon-btn press scale, dropdown menu-in animation, @supports backdrop-filter glass for dropdown and toasts, editor inset flash, stat-in tile stagger, bar-grow, faint #app::before top glow. Global prefers-reduced-motion rule extended with animation-delay: 0s so staggers cannot hide content.
- T5 TDD: RED feedback.test.js -> import of './feedback.js' failed (module missing, no tests ran). GREEN: 3 passed.
- T5 checks observed: `npx vitest run` -> 24 files, 349 tests passed; `npm run build` -> built OK.
- T5 not visually verified (no running app/DOM): indicator placement, width-collapse feel, flash intensity, glass legibility in light theme, top glow subtlety all unverified.
