# Vault Sync — Phase 2: Diff and Push

## Objective
Push an edited secret back to Azure Key Vault as a new version, after a
key-level diff and one explicit confirmation, without ever changing bytes the
user did not edit.

Source plan: "Vault Sync Plan" artifact, phase 2. Phase 1 is in
`odd/tasks/vault-sync-phase-1.md`, and its follow-ups feed this document.

## Problem
Phase 1 can pull and edit, but a change still has to be copied back by hand.
Two phase 1 shortcuts make a naive push unsafe:
- `normalise` re-serialises through `serde_json::Value`, so `1.50` becomes
  `1.5`, big integers lose precision and duplicate keys collapse.
- `write_pull` writes three files in sequence and is not atomic as a whole.

## Scope
- Backend: lossless JSON formatting, atomic pull, a guarded `clean` root, a
  `set` adapter through a temp file, a push preview with a remote version check
  and a content-hash gate, and push.
- Frontend: jsdom test harness for the panel's DOM wiring, a diff view, the
  confirm dialog, push, and a close guard for unpushed edits.

Out of scope: version history and restore (phase 3/4), bulk search, cross-env
compare, and creating or deleting secrets.

## Decisions
- **Close behaviour (user, 2026-10-01): option A.** The workspace is still
  cleared on close. If any pulled secret is `modified` (not pushed), closing
  asks first ("N secrets have unpushed edits. Close and discard them?"). Startup
  cleanup stays.
- **Delivery (user, 2026-10-01): one larger PR**, no PR chain. Work continues
  on `feat/vault-push` until the user says to deliver. Strategy `single-pr`.
  The branch is stacked on `feat/vault-plugin-menu` (PR #7). Rebase it onto
  `main` with `--onto` once #7 merges.
- **Lossless formatting, no key sorting.** The working copy is pretty-printed by
  a token-level formatter that keeps every string and number lexeme verbatim
  and keeps key order. Push minifies with the same tokenizer (insignificant
  whitespace only). Pulling and then pushing without edits reproduces a
  minified remote value byte for byte. This changes the phase 1 rule
  ("sort keys"): sorting is not needed for a key-level diff, and it would
  rewrite every secret on its first push. Duplicate keys are reported, not
  collapsed.
- **Diff on the frontend.** The key-level diff for display reuses the existing
  `diffJson` on base vs working text. The backend owns only what must be
  trustworthy: JSON validity, the remote version check, the content hash and
  the push itself.
- **Hash gate.** `vault_push_preview` computes a hash of the exact bytes that
  would be pushed and remembers it in managed state for that vault/name, with
  a short expiry. `vault_push` refuses unless the same hash was previewed. The
  UI therefore cannot skip the confirmation.
- **Conflict.** If the remote's current version differs from `baseVersion`,
  the preview reports a conflict and returns the remote text. The UI offers
  **Re-pull** or **Overwrite anyway**; overwriting needs its own flag on
  `vault_push`.
- **Secret values never in arguments.** `set` uses
  `--file <tmp> --encoding utf-8`. The temp file lives under the app data dir
  (not `%TEMP%`), is created exclusively, and is deleted by a `Drop` guard even
  on error. Adapter tests assert that no value appears in the recorded
  arguments.
- **Environment.** The environment comes from the vault name suffix: `-dev`,
  `-qa`, `-stg`, `-main` or `-prod`, otherwise `unknown`. `main`/`prod` and
  `unknown` get a red header and require typing the secret name to confirm.
  `dev` gets a plain confirm.
- **Masking.** Changed values are masked in the dialog until the user reveals
  them. Values are never logged.

## Constraints
- Phase 1 constraints still hold: argument arrays only, name validation, no
  token handling, no `unwrap` on `az` output, no generic shell plugin.
- New capability permissions only where strictly needed (for example the close
  guard's `core:window:allow-destroy`), and each one is named in its commit.
- Existing tests must keep passing (469 JS, 126 Rust at branch start).

## Tasks
- [x] P1 — jsdom dev dependency. DOM tests for the existing vault panel: the
      overwrite guards (modified confirmation, clean re-list), the busy guard,
      the lifecycle (activate/deactivate, stale status discarded, no calls while
      hidden) and the `loadFileFromDisk` boolean contract. These are
      characterisation tests of shipped behaviour, so RED is shown by
      temporarily breaking the guarded line.
      Done: `jsdom` (dev) opted in per file with `// @vitest-environment jsdom`;
      the default environment stays `node` and the existing `ui/**/*.test.js`
      glob already collects `vaultPanel.dom.test.js`. Shared fakes live in
      `ui/testing/fakeBackend.js` (`createFakeInvoke`, `deferred`, `settle`). 17
      tests; breaking each of 11 guarded lines one at a time made 1 to 4 of them
      fail on assertions, and the panel source was restored afterwards.
- [x] P2 — Lossless JSON formatter and minifier in Rust (tokenizer that keeps
      lexemes and key order, reports duplicates). It replaces the
      `serde_json::Value` path in `normalise`. Pull and push round-trip tests,
      including `1.50`, `1e3`, big integers, unicode escapes and duplicate keys.
      Done: `vault/json_text.rs` (`pretty`, `minify`, `duplicate_keys`; strict
      JSON grammar, depth limit 128, errors carry line/column and a fixed
      reason, never input). Duplicates are a separate query, not an error, so
      formatting and pull still succeed and push can refuse. 155 Rust tests
      pass (+29); RED was 22 of 27 formatter tests plus 6 `normalise`/pull
      tests failing on assertions.
- [x] P3 — Atomic pull: write base, then working, then meta last; a missing or
      stale meta means "not pulled". `clean(None)` only removes a root whose
      leaf is `vault-sync`.
      Done: the old meta is removed first, so a failed re-pull cannot leave an
      old meta describing a new base; `local_state` reads only the format named
      by the meta and treats missing or unreadable meta as `remote`; `clean(None)`
      returns an `internal` error for any other leaf. 164 Rust tests pass (+9);
      RED was 6 failing on assertions (failure injected by putting a directory
      at the working-copy path).
- [x] P4 — `az` adapter `set` and `show` of the current version, through a
      temp file with a `Drop` guard; the trait gains `set`. Adapter tests check
      the argument arrays and that no value appears in them.
      Done: `SecretProvider::set`; the staging folder is injected into
      `AzCliProvider::new(runner, staging_dir)` (`Workspace::staging_dir()` is
      `{root}/.tmp`), so the port stays free of filesystem details. The current
      remote version reuses `get`: one `az` call that also yields the remote
      text for a conflict, where a separate `current_version` would add a
      second call. `StagedFile` is created with `create_new` and deleted by
      `Drop`; `--content-type` is sent only for JSON objects/arrays
      (`json_text::is_container`). 181 Rust tests pass (+17); RED was 16 failing.
- [x] P5 — Service and commands: `vault_push_preview` (validity, empty-diff
      detection, remote version check, environment, hash) and `vault_push`
      (hash gate, overwrite flag, minify, set, then update base and meta with
      the new version). Wired in `lib.rs`.
      Done: `PreviewGate` (`vault/preview_gate.rs`, `sha2` 0.10 added, already in
      the lockfile; injected clock, 5 min TTL, shared as managed state);
      `VaultService::{push_preview, push, local_changes}`; commands
      `vault_push_preview`, `vault_push` and `vault_local_changes` (chosen over
      extending `vault_list`: it reads only the disk, so a close guard works
      offline and covers vaults that are not listed). New error kinds
      `not_pulled`, `invalid_json`, `duplicate_keys`, `no_changes`,
      `preview_required`, `conflict`. After a push the new `.base` is the
      working text that was pushed, not the minified bytes, so the secret goes
      back to `clean` without rewriting a file the editor has open. Forbidden
      now reads "read or write". 241 Rust tests pass (+60 in P5); RED was 9 of
      13 gate tests, 7 of 10 workspace tests and 34 service tests failing.
- [x] P5b — Backend fixes from review. The preview now also records the
      remote version it observed, and `vault_push(overwrite=true)` proceeds only
      if the vault still holds exactly that version (otherwise `conflict`, the
      user previews again and sees the new remote). `PreviewGate::take` checks
      and removes the preview under one lock, so two pushes with one hash cannot
      both reach `set`; `restore` puts it back after a `conflict`, a failed
      remote read or a failed `set` so the same hash can be retried. RED: 3
      service tests failed on assertions (two overwrite cases, one racing push
      that wrote twice) and 7 gate tests failed against a stubbed `take`. 252
      Rust tests pass (+11).
- [x] P6 — Frontend push flow: a Push action on modified rows, a diff view
      (added, removed and changed keys with masked values and reveal), the
      confirm dialog with the environment header and typed confirmation for
      prod/unknown, the conflict path (Re-pull / Overwrite anyway) and a
      success toast with the short new version.
      Done: pure helpers in `ui/vaultPush.js` (34 tests), `ui/modal.js`
      (accessible modal: focus trap, Escape, focus return, stacking; 14 DOM
      tests), `ui/vaultPushDialog.js` (32 DOM tests) and the panel wiring (15 DOM
      tests); `errorMessage` knows the new kinds. The diff reuses `diffJson` and
      `describeDiff`. Values exist in the DOM only after "Reveal values" and
      never in attributes. Beyond the brief: a conflict or `preview_required`
      answer to a push turns into "Review again" (a fresh preview), because the
      overwrite rule from P5b needs the user to look at the new remote. RED: the
      pure helpers and the dialog ran against stubs first (34 and 29 failures);
      mutating the mask, typed gate, double-submit guard, overwrite flag, Escape
      guard and the panel guards in turn made tests fail (one panel lock mutation
      survives because the earlier render already locks the buttons).
- [x] P7 — Close guard (decision A): intercept the close request; if any
      secret is `modified`, ask before discarding. Tested in jsdom and in a pure
      model.
      Done: `ui/closeGuard.js` (`closeDecision`, `askDiscardOnClose`,
      `installCloseGuard`; 26 tests) wired in `main.js` whenever the app runs
      in Tauri, independent of the Vault plugin switch. A failed
      `vault_local_changes` asks anyway with a generic message; a failure of the
      guard itself lets the close go ahead rather than trapping the user.
      Capability added: `core:window:allow-destroy` only, because the window API
      destroys the window itself after a handler that did not prevent the close
      (`onCloseRequested` needs nothing beyond `core:event:default`). RED: stubs
      first (26 failures), then 9 mutations of the guard, all caught.
- [x] P8 — Review advisories (all non-blocking findings of the approved reviews).
      Close guard: `vault_local_changes` is raced against a 3 s timer
      (`CHECK_TIMEOUT_MS`, injectable as `checkTimeoutMs`); a timeout asks the
      generic "could not check" question, and `prompting` is released on every
      path. Session loss: a `not_signed_in` answer to a push or to "Review
      again" closes the dialog at once and calls `onSignedOut`, which runs the
      panel's `handleCallError` (signed-out stage, expiry toast), because
      nothing in the dialog can succeed without a session and a retry button
      would only fail again. Diff: rows are computed once per preview
      (`analyse`) and reused on reveal; typing only refreshes the controls. P5b
      tests: the racing-push test uses `recv_timeout` (5 s) and fails instead
      of hanging; a failed `provider.get` restores the preview; the conflict
      retry asserts no `set` on the refused attempt and exactly one after.
      RED: 5 close-guard, 6 session-loss and 4 diff-count tests failed on
      assertions before the fix. Rust hardening shown by breaking the guarded
      line: no restore after a failed read (1 failure), `set` on a conflict
      (the strengthened retry test among 5), a push that never reaches `set`
      (racing test fails after 5 s). JS 610 -> 626 tests, Rust 252 -> 253.

## Route per task
| Task | Route | Trigger evidence |
|------|-------|------------------|
| P2–P5 | delegated writer (backend batch) | 4+ non-trivial Rust files |
| P1, P6, P7 | delegated writer (frontend batch, after backend) | 4+ non-trivial JS/CSS files plus new test harness |

## Acceptance criteria
- Pulling and then pushing an unedited JSON secret produces no push ("No
  changes"). Pushing an edited one changes only the edited lexemes.
- A push is impossible without a matching preview; a stale base is reported
  as a conflict.
- No secret value appears in any process argument, log line or toast.
- Closing with unpushed edits asks first; closing without them does not.

## Applicable checks
- `npm test`
- `npm run build`
- `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `export PATH="$HOME/.cargo/bin:$PATH" && cargo build --manifest-path src-tauri/Cargo.toml`
- Manual (user): push a change to a throwaway secret in a dev vault, then
  roll it back from the portal.

## TDD mode
Enabled (session config: Strict TDD Mode). Runners: `vitest run` (JS, jsdom
for DOM tests) and `cargo test --lib` (Rust).

## Delivery
Strategy `single-pr` (user choice). Forecast: about 2,500 authored lines. Work
units are committed per task on `feat/vault-push`. RDD review runs per writer
batch with the user's consent. Nothing is pushed until the user says so.

## Progress
- Branch `feat/vault-push` created from `feat/vault-plugin-menu` (d53d370).
- Backend batch P2–P5 done, one commit per task. Rust 126 -> 241 tests.
- Review fixes P5b (overwrite over an unseen version, atomic gate) done: 252 Rust tests.
- Frontend batch P1, P6, P7 done, one commit per task. JS 469 -> 610 tests.
- Review advisories P8 done in two commits. JS 626, Rust 253 tests.

## Frontend contract (for P6/P7)
Errors are `{ kind, message }`; the new kinds are `not_pulled`, `invalid_json`,
`duplicate_keys`, `no_changes`, `preview_required` and `conflict`.
- `vault_push_preview({ vault, name })` returns `{ changed, format, baseVersion,
  baseText, workingText, remote: { currentVersion, conflict, remoteText },
  environment: "dev"|"qa"|"stg"|"prod"|"unknown", contentHash }`. `remoteText`
  is set only on a conflict. A preview with `changed: false` is not
  remembered, so a push after it fails.
- `vault_push({ vault, name, contentHash, overwrite? })` returns
  `{ newVersion }`. `overwrite` defaults to `false`; a `conflict` error keeps
  the preview, so "Overwrite anyway" reuses the same `contentHash`. Overwrite
  only works over the remote version the preview showed: if the vault changed
  again after the preview, `vault_push` answers `conflict` again and the UI
  must call `vault_push_preview` anew (the user then sees the new remote).
- `vault_local_changes()` returns `[{ vault, name }]` for every `modified`
  secret.

## Next step
Review of the frontend batch (RDD with the user's consent), then a visual check
of the push dialog and the close guard in the real app, and a manual push to a
throwaway dev secret. Nothing is pushed or delivered until the user says so.
