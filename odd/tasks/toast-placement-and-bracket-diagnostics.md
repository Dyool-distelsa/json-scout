# Toast Placement, Format Feedback & Unmatched-Bracket Diagnostics

## Objective
Move and strengthen the toast, report size growth after Format, and make a
missing opening bracket produce an accurate error and a working repair.

## Problems

### 1. Toast placement and weight (user request)
Toasts appear bottom-right and read as too small / not solid enough.
Requested: bigger, more opaque, and anchored TOP-RIGHT.

### 2. Format gives no size feedback (user request)
Minify reports its saving; Format (which grows the document) reports nothing.

### 3. A missing `[` is mis-diagnosed and unrepairable (confirmed bug)
Measured with the current code:

| Input | validateJson says | Real cause |
|---|---|---|
| `{"tags": "a","b"]}` | `Expected ':' after property key` (1:17) | missing `[` at col 10 |
| `{"n": 1,2,3]}` | `Expected a double-quoted property key` (1:9) | missing `[` at col 7 |
| `{"a":{"b": 1,2]}}` | `Expected a double-quoted property key` (1:14) | missing `[` at col 12 |
| `"a","b"]` | `Unexpected trailing characters after JSON value` (1:4) | missing leading `[` |

After the `[` is deleted the parser reads the first element as the property's
value, sees the comma, assumes the object continues, and treats the next token
as a key — so it reports a downstream symptom, far from the cause, with a
message that points the user at the wrong fix.

`repairJson` is worse: it THROWS `Colon expected at position N` on three of
those four inputs instead of repairing. Only the top-level case repairs today.
Control case `{"a":[1,2}` (missing closer) validates and repairs correctly.

## Key insight
An unmatched CLOSING bracket is unambiguous. If a `]` or `}` appears with no
open counterpart, that token itself is determinate evidence of a missing
opener — no guessing required. That is what the diagnostic should report.

## Scope
Frontend only. `src-tauri/` is NOT in scope.

## Constraints
- Do not regress the 232 passing JS tests or the 31 Rust tests.
- Keep the single global `prefers-reduced-motion` block.
- Keep the one shared `formatBytes`; do not add a second formatter.
- Do not touch the per-keystroke hot path or the lazy tree.
- Do not add dependencies.

## Tasks
- [x] T1 — Move the toast stack to TOP-RIGHT. Flip the entrance/exit direction
      so it slides down from the top, and change the stacking direction so new
      toasts read in a sensible order from the top.
- [x] T2 — Increase toast size (padding and type scale) and make it read as
      more solid: fully opaque surface, stronger border and elevation. Must
      stay readable in both themes.
- [x] T3 — After Format, show a toast reporting how much the document GREW,
      as a percentage and a formatted size, mirroring the Minify toast. Reuse
      `formatBytes` and `utf8ByteLength`. Handle the no-change case (already
      formatted) and the empty-document case honestly.
- [x] T4 — Teach the parser to detect an unmatched closing bracket and report
      it at the position of that bracket, with a message naming the missing
      opener rather than a misleading downstream complaint.
- [x] T5 — Make `repairJson` handle the missing-opening-bracket shapes above
      instead of throwing a raw library error. Where a repair cannot be made
      confidently, surface a clear, actionable message rather than the
      library's internal wording.

## Acceptance criteria
- All four inputs in the table above produce an error that names the missing
  opening bracket and points at the unmatched closer.
- `repairJson` no longer throws on those inputs.
- Format reports growth; Minify still reports saving.
- Toasts appear top-right, larger and solid.
- `npm test`, `npm run build` and `cargo test --lib` stay green.

## Applicable checks
- `npm test`
- `npm run build`
- `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --lib`

## TDD mode
Enabled. The parser diagnostics, the repair behaviour and the format-growth
calculation are all pure — failing tests first, using the exact inputs in the
table above as fixtures.

## Progress

### T1/T2 — Toast placement and weight
- `src/styles/main.css`: `.toast-container` anchor moved from
  `right:16px; bottom:16px` to `right:16px; top:16px`. `flex-direction`
  changed from `column-reverse` to plain `column`. Verified by re-deriving
  the flexbox main-start/main-end placement rules by hand: with
  `column-reverse` the first-added (oldest) toast always lands nearest the
  box's own bottom edge and the newest nearest its top edge, regardless of
  where the box itself is anchored. The old bottom-anchored layout relied on
  that to keep the oldest toast pinned at the fixed corner while new ones
  appended into freshly-grown space above it, without displacing existing
  toasts. Mirroring that for a TOP anchor requires plain `column`, not
  `column-reverse`: now the oldest toast stays pinned near the fixed top
  edge and each new toast is appended into the newly available space below,
  again without shoving existing toasts.
- `.toast` entrance transform flipped from `translateY(18px)` (up from
  below) to `translateY(-18px)` (down from above), so it now slides DOWN
  into place. `.toast--leaving` (`translateY(-6px)`, retreats upward) was
  left unchanged per the task's explicit instruction.
- Bigger/more solid: `.toast` padding `14px 16px 16px` → `18px 22px 20px`,
  `font-size` 14px → 15px, `gap` 12px → 14px, container `gap` 8px → 10px,
  `max-width` 360px → 400px. `.toast__close` font-size 14px → 15px to match.
  Border strengthened via a new `--color-border-strong` token (dark
  `#565667`, light `#b7bcc6`) replacing the plain `--color-border` on the
  toast. Elevation strengthened via a new `--shadow-toast` token (dark:
  `0 24px 56px rgba(0,0,0,.5), 0 8px 20px rgba(0,0,0,.35)`; light:
  `0 20px 48px rgba(15,23,42,.24), 0 8px 18px rgba(15,23,42,.16)`),
  replacing `--shadow-elevated` on the toast so other elevated surfaces
  keep their existing shadow. The background stays `--color-bg-elevated`,
  which was already a fully opaque hex color in both themes (no alpha), so
  no new background token was needed for the "opaque surface" requirement.
  No hard-coded colors were added — both new tokens are defined once in
  `:root` and once under `:root[data-theme='light']`, alongside the
  existing tokens.
- `src/ui/toast.js` `addNode`/`removeNode`: re-read against the new
  direction/anchor. Both are generic height/padding-collapse animations on
  the toast's own box and contain no direction-dependent logic — a newly
  added toast is always the last DOM child, and in plain `column` layout
  that places it after (below) every existing toast, so its own
  grow-from-0 animation only occupies newly-available space and does not
  shove earlier toasts. `removeNode`'s collapse-then-remove likewise just
  closes the gap for whichever toasts happen to sit after it in DOM order,
  unaffected by which end is anchored. No JS changes were required.
  Verified by structural re-read (per the task: no contrived DOM/CSS
  tests), not by launching the app.
- The single global `prefers-reduced-motion` block in `main.css` was not
  touched; T1/T2 reuse the existing `--motion-duration-*`/`--motion-ease-*`
  tokens throughout.

### T3 — Format growth toast
- `src/tools/jsonUtils.js`: added `computeFormatGrowth(beforeBytes,
  afterBytes)`, the mirror-image of `computeMinifySaving` for the growth
  direction. Both now share one internal (unexported) `computeChangePercent
  (beforeBytes, changeBytes)` helper for the percentage arithmetic — the one
  bit of near-identical logic between the two — while each still computes
  its own naturally-directioned delta (`beforeBytes - afterBytes` for
  saving, `afterBytes - beforeBytes` for growth) rather than deriving one
  from the other by negation, which would risk a stray `-0`.
  `computeMinifySaving`'s existing exported shape/behavior is unchanged
  (all prior tests still pass unmodified).
- `src/main.js`: added `describeFormatGrowth`, mirroring
  `describeMinifySaving`, and wired the `format` handler to measure
  `utf8ByteLength` before/after exactly like `minify` does, then call
  `toast.showToast(describeFormatGrowth(...), 'success')` inside the
  existing `withToastOnError` wrapper (Format previously showed no
  toast at all on success).
- Edge cases handled explicitly (both in `computeFormatGrowth` and in
  `describeFormatGrowth`): an empty document (`beforeBytes === 0`) never
  divides by zero and reports "nothing to format"; a document that doesn't
  change size (already formatted with the same indent) reports "no size
  change" rather than "0.0% larger"; a document that happens to shrink
  under Format reports `grew: false` (not a negative percentage).

### T4 — Accurate unmatched-closing-bracket diagnostics
- `src/tools/jsonParser.js`: added `detectUnmatchedCloser(text)`, an
  independent bracket-stack scan (skips string contents, respects `\"`
  escapes) that finds the first `]`/`}` whose bracket type has ZERO
  matching opens anywhere in the currently active nesting — the
  unambiguous case named in the task. It also computes `insertAt`: the
  position right after the nearest enclosing object's most recent
  `:` (skipping following whitespace), or `0` at the document root — used
  by T5.
- `parseJsonStrict`'s top-level call is now wrapped in try/catch: on any
  `JsonSyntaxError`, it re-runs `detectUnmatchedCloser` over the whole
  text and, if it finds one, throws a NEW `JsonSyntaxError` at the
  closer's own index with the message `"Unmatched '<closer>': missing
  opening '<opener>'"`, replacing whatever downstream symptom the
  recursive-descent parse produced. If the scanner finds nothing (brackets
  balanced, or the closer's type IS open somewhere just not at the top —
  a different bug shape, e.g. a missing CLOSER), the original error is
  rethrown unchanged.
- Verified against all four table inputs (exact message/position below)
  and against the control case `{"a":[1,2}` (missing CLOSER), which is
  correctly NOT reintercepted — `detectUnmatchedCloser` returns `null`
  for it, because a `{` is open somewhere in the stack (the outer object)
  even though the innermost frame is `[`, so this is recognized as "wrong
  closer for an unclosed inner bracket", not "no opener exists at all".
- No existing `jsonParser.test.js`/`validate.test.js` message or position
  assertion changed; new tests were added instead. Full suite confirms this
  (232 → 256 passing, 0 regressed).

### T5 — Repair
- `src/tools/repair.js`: `repairJson` now tries `jsonrepair` first
  (unchanged fast path for everything it already handles, including the
  control case). Only on failure does it call `detectUnmatchedCloser`; if
  it finds an unmatched closer with a non-null `insertAt`, it inserts the
  missing opening bracket at that position and retries `jsonrepair` on the
  patched text. If that still fails, or `insertAt` is `null`, it throws a
  new, clear, actionable `Error` instead of the library's raw wording (or
  instead of a silently wrong result).
- All four table inputs now repair into valid, parseable JSON with the
  expected shape (verified via `JSON.parse` round-trip in tests, and via a
  direct probe for the exact string — see report). The control case
  `{"a":[1,2}` still repairs via the unmodified first `jsonrepair` call
  (never reaches the fallback), confirmed via a dedicated regression test.

**Judged too ambiguous to repair (documented honestly, not silently
guessed):** when the unmatched closer is found while the innermost open
frame is a `[` (array), not a `{` (object) — e.g. a stray `}` inside an
array value with no preceding `:` to anchor a guess to —
`detectUnmatchedCloser` returns `insertAt: null`, and `repairJson` refuses
to insert anything positionally, instead throwing the actionable
"has no matching opening bracket" message. None of the four table inputs
hit this path (all are property values, anchored by a colon, or the
document root), so it is exercised only by construction/reasoning here,
not by a table fixture — noted rather than silently assumed correct.

## Verification (observed, foreground)
- `npm test`: 256 passed (232 baseline + 24 new), 0 failed.
- `npm run build`: succeeded (`vite build`, dist emitted).
- `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path
  src-tauri/Cargo.toml --lib`: 31 passed, 0 failed.

New validator output for the four table inputs (line 1 for all, single-line
fixtures):
| Input | New message | New position |
|---|---|---|
| `{"tags": "a","b"]}` | `Unmatched ']': missing opening '['` | 1:17 |
| `{"n": 1,2,3]}` | `Unmatched ']': missing opening '['` | 1:12 |
| `{"a":{"b": 1,2]}}` | `Unmatched ']': missing opening '['` | 1:15 |
| `"a","b"]` | `Unmatched ']': missing opening '['` | 1:8 |

New repair output for the same four inputs:
| Input | `repairJson` output |
|---|---|
| `{"tags": "a","b"]}` | `{"tags": ["a","b"]}` |
| `{"n": 1,2,3]}` | `{"n": [1,2,3]}` |
| `{"a":{"b": 1,2]}}` | `{"a":{"b": [1,2]}}` |
| `"a","b"]` | `[\n"a","b"\n]` (jsonrepair's own pretty-print of an already-valid top-level array; unchanged from its pre-existing behavior on this exact patched shape) |

Control case `{"a":[1,2}` (missing CLOSER): validator message unchanged
(`Expected ',' or ']'`, not overridden), `repairJson` still returns
`{"a":[1,2]}` via the unmodified first `jsonrepair` call. Confirmed by
dedicated regression tests in `jsonParser.test.js`, `validate.test.js` and
`repair.test.js`.

Format toast strings (representative + edge cases):
- Growth: `Formatted: 23 B → 41 B (78.3% larger)`
- No change: `Formatted: already at 42 B (no size change).`
- Empty document: `Formatted: nothing to format (empty document).`

## Deviations
None from the acceptance criteria. One judgment call is documented above
under T5 (the `insertAt: null` / array-context case is treated as "too
ambiguous to repair automatically" rather than guessed).
