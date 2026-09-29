# Stats Panel & Byte Units

## Objective
One consistent, readable byte format across the whole frontend, a Stats panel
that looks designed rather than assembled, and useful feedback after Minify.

## Problem
Three independent byte formatters exist today, with three behaviours:
- `src/ui/statusbar.js:78` — private `formatBytes`, 1 decimal, stops at MB (no GB).
- `src/ui/rightPanel.js:187` — no formatting at all: hardcodes `${stats.byteSize} B`.
- `src-tauri/src/fs_ops.rs:32` — Rust `format_bytes`, 1 decimal, has GB.

So the status bar and the Stats panel disagree, and neither reaches GB in JS.

The Stats panel is also visually inconsistent with the rest of the app: the
tiles use CSS classes, but the type histogram is built with inline styles
(`row.style.display`, `row.style.fontSize`, ...) and `row.innerHTML`, while
every other panel uses stylesheet classes.

## Requested unit rule
Readability is the goal. The user stated both failure modes to avoid: never a
huge raw byte count, and never something like "0.001 MB".

Rule: pick the LARGEST unit in which the value is still >= 1, render with up to
2 decimals, promote at 1024.

That rule excludes both failure modes by construction:
- 8472913 renders as "8.08 MB", never as "8472913 B".
- 1048 renders as "1.02 KB", never as "0.001 MB".

Examples: "847 B", "1.02 KB", "3.40 MB", "1.02 GB".
Bytes are whole numbers, so the B step renders without decimals.

## Scope
Frontend. `src-tauri/` is NOT in scope; the Rust `format_bytes` keeps serving
its own error message and is left alone.

## Constraints
- Exactly ONE exported JS byte formatter, used by the status bar, Stats and the
  Minify toast.
- Must not regress the 217 passing JS tests or the 31 Rust tests.
- Keep the existing theme tokens and the motion scale from the polish pass;
  both themes stay readable.
- Do not add a charting or formatting dependency.
- Do not touch the per-keystroke hot path or the lazy tree.

## Tasks
- [x] T1 — Add one exported, unit-tested `formatBytes` to `src/tools/jsonUtils.js`
      implementing the rule above, including the GB step.
- [x] T2 — Use it in `src/ui/statusbar.js`; delete the private duplicate.
- [x] T3 — Use it in the Stats panel instead of the hardcoded `${bytes} B`.
- [x] T4 — Replace the histogram's inline styles and `innerHTML` with
      stylesheet classes, consistent with the rest of the panels.
- [x] T5 — Make the histogram readable at a glance: proportional bars per type,
      counts aligned, zero-count types visually de-emphasised rather than noisy.
- [x] T6 — Tighten the stats tile grid: alignment, spacing and value/label
      hierarchy, so the panel reads as one designed block.
- [x] T7 — After Minify, show a success toast reporting how much the document
      shrank, as a percentage AND as a formatted size, reusing `formatBytes`.
      Compare UTF-8 byte lengths (`utf8ByteLength`), not string lengths. Handle
      the edge cases honestly: a document that does not shrink because it was
      already minified, and an empty/zero-byte document (no division by zero).

## Acceptance criteria
- Status bar and Stats show the identical string for the same byte count.
- A document of 1 GB or more renders in GB.
- Only one `formatBytes` exists in `src/`.
- Minify reports its saving in % and in a formatted size, and says something
  sensible when there is nothing to save.
- `npm test`, `npm run build` and `cargo test --lib` stay green.

## Applicable checks
- `npm test`
- `npm run build`
- `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --lib`

## TDD mode
Enabled. `formatBytes` and the minify-saving calculation are pure — their
failing tests come first, covering the unit boundaries (1023/1024), 2-decimal
rendering, the GB step, a zero-byte input, and a no-shrink case.

## Progress
All seven tasks complete (T1–T7).

- **T1**: Added `formatBytes(bytes)` and `computeMinifySaving(beforeBytes, afterBytes)`
  to `src/tools/jsonUtils.js` (largest-unit->=1 rule, 1024 promotion, B step has
  no decimals, other steps have 2; rounding edge case at the unit boundary — a
  value that rounds up to 1024.00 in its own unit — promotes one more step so
  it never prints e.g. "1024.00 MB"). TDD: 20 tests written first (RED,
  `formatBytes is not a function` / `computeMinifySaving is not a function`),
  then made to pass (GREEN).
- **T2**: `src/ui/statusbar.js` now imports `formatBytes`; the private
  `formatBytes` (1-decimal, no GB) is deleted.
- **T3**: `src/ui/rightPanel.js` `renderStats` uses `formatBytes(stats.byteSize)`
  instead of the hardcoded `` `${stats.byteSize} B` ``.
- **T4**: The type histogram no longer uses `row.style.*` or `row.innerHTML`;
  it is built with `document.createElement` and stylesheet classes
  (`.stats-histogram`, `.stats-histogram__title/list/row/label/bar-track/bar/count`)
  added to `src/styles/main.css`.
- **T5**: Each row is a 3-column grid (label / bar / count) so counts align
  vertically; the bar's width is a CSS custom property (`--bar-percent`,
  count relative to the row with the highest count) rendered by
  `.stats-histogram__bar`; zero-count rows get `.stats-histogram__row--zero`
  (opacity 0.4, muted bar color) instead of being hidden — still scannable,
  not noisy. Reuses `--color-accent`, `--color-text-dim`, `--color-bg-alt` and
  the existing `--motion-duration-base`/`--motion-ease-decelerate` tokens; the
  bar-width transition is covered by the single global
  `prefers-reduced-motion` block (no second one added).
- **T6**: `.stats-tile` is now a flex column (label above value) with tighter
  padding/gap, `.stats-tile__value` bumped to 18px/600 weight with
  `font-variant-numeric: tabular-nums`, `.stats-tile__label` gets letter-spacing;
  `.stats-grid` gained `margin-bottom` to separate it from the histogram below.
- **T7**: `src/main.js`'s `minify` handler now measures `utf8ByteLength` before
  and after, calls `computeMinifySaving`, and shows a success toast via
  `describeMinifySaving` (presentation-only wording; the arithmetic stays in
  the pure, tested `computeMinifySaving`). Representative outputs:
  - Normal shrink (4302 → 2918 bytes): `Minified: 4.20 KB → 2.85 KB (32.2% smaller)`
  - Already minified (42 → 42 bytes): `Minified: already as small as it gets (42 B).`
  - Zero-byte document (0 → 0 bytes): `Minified: nothing to save (empty document).`

### Verification (all observed, foreground)
- `npm test` → 230 passed (was 217; +13 new tests for `formatBytes`/`computeMinifySaving`).
- `npm run build` → succeeded (`vite build`, `dist/` produced).
- `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --lib` → 31 passed, unchanged (Rust untouched, as scoped).

### Proof of single `formatBytes`
`grep -rn "formatBytes" src/ --include=*.js | grep -v .test.js` shows exactly
one definition (`src/tools/jsonUtils.js:123`) and three call sites
(`src/main.js`, `src/ui/rightPanel.js`, `src/ui/statusbar.js`).

### Deviations
None from the task document. `src-tauri/` was not touched.
