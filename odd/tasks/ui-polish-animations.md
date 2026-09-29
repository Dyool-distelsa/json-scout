# UI Polish & Animations

## Objective
Make json-scout feel finished rather than functional-but-rough, and make toast
notifications impossible to miss.

## Problem
The user reported the Validate toast "was not visible" and the app "still looks
rough", asking for animations.

An end-to-end audit found NO defect in the toast chain:
- `src/ui/toast.js` builds the node, appends it, and adds `toast--visible` on
  the next animation frame.
- `.toast-container` is `position: fixed; right:16px; bottom:16px; z-index:1100`.
- `--color-bg-elevated` is defined for both themes.
- `src/main.js:33` mounts onto the correct `#toast-container` element.
- Rust emits `startup-payload` from the single-instance callback
  (`src-tauri/src/lib.rs:28-37`) and the frontend listens (`src/main.js:447`).

Conclusion: the toast almost certainly DID render, but it is too easy to miss —
12px text, bottom-right corner, a 0.18s fade, and success auto-dismisses after
2500ms. The real problem is prominence and polish, not correctness.

## Scope
Frontend only. No changes under `src-tauri/`.

## Constraints
- Every animation must respect `prefers-reduced-motion: reduce`.
- Both dark and light themes must stay readable; colors come from existing
  CSS custom properties.
- No animation may delay perceived input response (typing, cursor).
- Must not regress the 217 passing JS tests or the 31 Rust tests.
- Keep the app lightweight: CSS transitions/animations only, no animation library.

## Tasks
- [x] T1 — Make toasts prominent: larger type, per-variant icon, stronger
      elevation, a slide+scale entrance, and a visible remaining-time progress
      bar. Raise default durations.
- [x] T2 — Animate toast stacking so multiple toasts settle instead of jumping,
      and animate removal so the stack collapses smoothly.
- [x] T3 — Micro-interactions on controls: toolbar button hover/active/focus
      states, the indent select, and the theme toggle, with visible focus rings
      for keyboard navigation.
- [x] T4 — Right-panel tab switching transition, and an animated chevron plus
      smooth expand/collapse in the tree view.
- [x] T5 — Status bar feedback: animate the validity dot when validity flips,
      and transition the file-name segment on change.
- [x] T6 — A single shared motion scale (durations/easings as CSS custom
      properties) plus one global `prefers-reduced-motion` block, so motion is
      consistent and disabling it is one rule.

## Acceptance criteria
- A toast is obvious at a glance without looking for it.
- All motion is disabled under `prefers-reduced-motion: reduce`.
- `npm test`, `npm run build`, and `cargo test --lib` all stay green.

## Applicable checks
- `npm test`
- `npm run build`
- `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --lib`

## TDD mode
Enabled. Pure units (e.g. any motion/duration helper) get a failing test first.
DOM/CSS presentation is verified by structural readback, not contrived tests.

## Progress
All six tasks (T1–T6) implemented, frontend-only, no `src-tauri/` changes.

**T1/T2 — Toast (`src/ui/toast.js`, `src/styles/main.css`)**
- `TOAST_DURATIONS` raised: success 2500→5000ms, info 3800→7600ms,
  error 5500→11000ms (~2x each, order preserved: success < info < error).
- Added `TOAST_ICONS` (inline SVG, `aria-hidden`) rendered per variant.
- Larger type (12px→14px, weight 500), stronger elevation via new
  `--shadow-elevated` token (separate dark/light values), slide-up+scale
  entrance/exit (`translateY`+`scale`) replacing the old plain fade.
- Progress bar: `.toast__progress-bar` is a CSS `@keyframes` animation whose
  `animation-duration` reads `--toast-duration`, set inline per toast from
  the same `toast.duration` the queue's real dismiss timer uses — so the
  bar and the actual auto-dismiss stay in sync without a JS timer loop.
- Stacking: `addNode`/`removeNode` now animate the toast's own `height`
  + `padding-top/bottom` (0 → natural size on enter, natural → 0 on
  leave, with a forced reflow between the collapsed and target state so
  the transition actually has something to animate from) so sibling
  toasts grow/shrink into place instead of snapping.

**T3 — Controls (`src/styles/main.css`)**
- `.tool-btn`, toolbar `select`, `.tab`, `.icon-btn`, `.toast__close`:
  added hover/active transitions and a `:focus { outline:none } /
  :focus-visible { outline: 2px solid var(--focus-ring-color) }` pair —
  removes the default ring only where an equivalent keyboard-visible ring
  is supplied, never unconditionally. New `--focus-ring-color` token
  (dark/light variants). Theme toggle is a plain `.tool-btn`, so it's
  covered without extra styling.

**T4 — Panels & tree (`src/styles/main.css`, `src/ui/rightPanel.js`)**
- `.tab-panel.active` gets a `tab-panel-in` keyframe fade+slide; this
  replays every time because `display:none → block` is treated as a
  fresh mount, so no JS timing changes were needed.
- Tree chevron: `rightPanel.js` no longer swaps `▸`/`▾` text; it always
  renders `▸` and toggles a `.tree-node__toggle--expanded` class that
  CSS rotates 90deg.
- Tree expand/collapse: introduced an always-present (but empty until
  first expand) `.tree-node__children-grid` wrapper using the
  `grid-template-rows: 0fr → 1fr` technique, which animates to the
  children's natural height with no JS measurement. `childrenContainer`
  (the actual child DOM) is still built lazily on first expand only,
  exactly as before — `buildChildrenDom` is unchanged in when it runs,
  only in what it appends into. A forced reflow (`void
  gridWrap.offsetHeight`) is done specifically on first expand so the
  collapsed state is committed before the expanded class is added in the
  same tick.

**T5 — Status bar (`src/ui/statusbar.js`, `src/styles/main.css`)**
- `setValid`/`setFileName` now track the previous value and only replay
  a `--flip` animation class when the value actually changed (not on
  every debounced re-check landing on the same result).
- `.statusbar__dot--flip`: a scale+opacity pulse keyframe on validity
  flip. `.statusbar__filename--flip`: a fade+slide keyframe on filename
  change. `.statusbar__dot` also gained `display:inline-block` (was
  relying on width/height applying to an inline `<span>`, which is
  spec-undefined) so the transform-based pulse is reliable.

**T6 — Motion system (`src/styles/main.css`)**
- New `:root` tokens: `--motion-duration-fast/base/slow` and
  `--motion-ease-standard/decelerate/accelerate`, used by every
  transition/animation added above (toast, controls, tabs, tree,
  status bar) — no new hard-coded durations were introduced.
- Exactly one `@media (prefers-reduced-motion: reduce)` block, near the
  top of the file, using the standard `* { animation-duration: 0.001ms
  !important; transition-duration: 0.001ms !important; ... }` universal
  override. Removed the old toast-only reduced-motion block it replaced.

**Verification**
- `npm test`: 217/217 passed (unchanged count — no pure-logic helpers
  were added that needed new tests; duration/order behavior in
  `toast.test.js` still passes with the raised `TOAST_DURATIONS`).
- `npm run build`: succeeded.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 31/31 passed.

**Deviations:** none from the task scope. `.icon-btn` and `.tab` also
received focus-visible rings beyond the T3-listed control set (toolbar
buttons/indent select/theme toggle) — a small, low-risk extension for
overall keyboard-accessibility consistency, not a scope change.
