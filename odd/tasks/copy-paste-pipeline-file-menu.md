# Copy button, paste pipeline and File menu

Branch: `feature/copy-button-paste-pipeline-file-menu`

## Objective
1. A **Copy** button in the top-right corner of the editor that copies the editor content.
2. Pasting JSON runs validate -> repair -> sort keys -> format automatically.
3. A **File** dropdown menu grouping Open, Save and Save As.

## Problem / why
Users paste messy JSON all day; today they must click Validate, Repair, Sort and Format by hand, then select-all-copy the result. The toolbar also lists Open/Save/Save As as loose buttons.

## Scope
In: the three items above, tests, README feature list, PR.
Out: new file formats, settings UI for the pipeline, changing the existing toolbar tools.

## Decisions (defaults chosen without asking; stated in the PR for review)
- The paste pipeline applies only when the paste would replace the whole document (empty editor, or selection covers everything). Pasting a fragment into the middle of an existing document stays a plain paste.
- Pipeline order: validate; if invalid, repair; then sort keys recursively; then format with the current indent setting.
- If the pasted text is valid or repairable, the editor receives the processed text and a toast says what happened (e.g. "Pasted, repaired and formatted"). If it cannot be repaired, the raw text is pasted untouched and a toast says so. Never lose the user's pasted text.
- Copy copies the full editor content, with a toast; disabled/no-op with a toast when empty.
- File menu keeps the existing shortcuts and behaviour of Open, Save, Save As; only the entry points move.

## Constraints
- Artifacts in English. No AI attribution in commits; conventional commits.
- ~400 changed-line planning heuristic per task (advisory).
- TDD: enabled (strict). Source: project config (Strict TDD Mode). Runners: `npm test` (vitest), `cd src-tauri && cargo test`.
- Pure logic goes in `src/tools/` or `src/ui/*.js` helpers with unit tests; DOM glue stays thin.

## Tasks
- [x] T1 Pure `processPastedJson` pipeline helper (validate -> repair -> sort -> format) with tests, RED first.
- [x] T2 Paste handler in the editor wired to the helper, with the whole-document rule and toasts.
- [x] T3 Copy button, top-right of the editor, with helper tests where logic is pure.
- [x] T4 File dropdown menu (Open, Save, Save As), accessible: aria attributes, Escape and outside-click close, keyboard reachable.
- [ ] T5 README feature list update, full checks, push branch, open descriptive PR. (README and checks done by writer; push and PR pending (parent))

## Acceptance criteria
- `npm test` and `npm run build` pass; `cargo test` unaffected.
- Pasting `{'b':1,'a':[1,2,],}` into an empty editor yields sorted, formatted, valid JSON.
- Pasting garbage leaves the pasted text as-is and shows an explanatory toast.
- Copy puts the exact editor content on the clipboard.
- File menu opens/closes correctly and Open/Save/Save As work as before.
- PR is open against `main` with a descriptive body.

## Routing
- Route: delegated direct (writer trigger: 2+ non-trivial files; preparation trigger: reading main.js, editor, toolbar, index.html, css before writing).
- Delivery strategy: ask-on-risk; forecast under 400 authored lines; a single PR.

## Progress / evidence
Resolved TDD: on (Strict TDD Mode, project config); runner `npm test` (vitest run). Route: delegated direct (single writer).
- T1 (32af39b): `src/tools/pastePipeline.test.js` written first; RED = module not found (0 tests ran, 1 file failed); GREEN = 14 passed. Full suite 274 passed. Judgment calls: empty/whitespace input is `ok:false`; invalid input whose repair yields only a bare string/number (e.g. prose, since `jsonrepair('garbage here')` returns a quoted string) is `ok:false`; original text returned untouched on failure.
- T2 (794b49e): `src/ui/pasteRules.test.js` first; RED = module not found; GREEN = 8 passed. Editor paste handler (`domEventHandlers`) is DOM glue, replaces via a normal transaction so the existing onChange/debounce path runs. Suite 282 passed; `npm run build` ok.
- T3 (b5da699): `src/ui/clipboard.test.js` first (isCopyable, async API with execCommand fallback via injected deps); RED = module not found; GREEN = 7 passed. Button is an overlay in a new `.editor-pane__primary` wrapper (right offset 24px clears the scrollbar; stays on the primary editor in diff mode). Suite 289 passed; build ok.
- T4 (c8f5c53): `src/ui/menuState.test.js` first (moveIndex, reduceMenu, clampMenuPosition); RED = module not found; GREEN = 19 passed. `src/ui/fileMenu.js` is DOM glue (menu attached to body with fixed position because the toolbar scrolls horizontally). Deviation: there was no Save As handler in main.js (only Save, which falls back to the save dialog when no path), so a `saveAs` handler was added reusing `saveAsNative` / `downloadAsFile`; Open and Save handlers unchanged. Shortcut hints shown: Open Ctrl+O, Save Ctrl+S (no Save As shortcut exists). Suite 308 passed; build ok.
- T5 (writer part): README feature list and layout updated. Final `npm test`: 21 files, 308 tests passed. `npm run build`: ok (existing chunk-size warning only). `cargo test` not run (src-tauri untouched).
- Not verified: no real-window check. Untested beyond unit tests and build: paste interception in CodeMirror, toasts on paste, Copy button placement/focus ring/clipboard in the Tauri webview, File menu rendering, positioning, focus handling and both themes.

T5 remaining: push and PR pending (parent).

## Next step
Parent verifies, pushes and opens the PR (push and PR pending (parent)).
