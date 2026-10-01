# Vault Sync — Phase 1: Read-only Pull

## Objective
Pull an Azure Key Vault secret into a local workspace and open it in the
json-scout editor. Nothing can be written to a vault in this phase.

Source plan: "Vault Sync Plan" artifact (claude.ai/artifact/SjDRrWd18PPjsbuW6UZMdH),
phases 2–4 are out of scope here.

## Problem
Changing one env var today means finding the secret in the portal, copying it,
formatting it, editing it and pasting it back by hand. Phase 1 removes the
first half: find and open a secret in json-scout in two clicks.

## Why this slice first
It carries zero risk of writing to a vault, and it validates the two most
uncertain premises before building on them: spawning `az.cmd` from Rust on
Windows, and whether the signed-in user can `get` secrets per vault.

## Scope
- Rust: domain types + port, name validation, `az` CLI adapter (whoami, list,
  get), workspace store, service, Tauri commands.
- Frontend: a "Vault" tab in the right panel with a vault input, a searchable
  secret list with local state, and a Pull action that opens the file.

Out of scope: `set`/push, diff view, confirm dialog, versions, bulk search,
environment colours, a settings toggle for workspace cleanup.

## Decisions
- **Sync port + `spawn_blocking`.** `SecretProvider` is a plain sync trait.
  Commands are `async` and run the service in
  `tauri::async_runtime::spawn_blocking`, so a ~1s `az` call never blocks a
  Tauri worker. No `async-trait`, no tokio process dependency. Revisit if the
  Rust SDK adapter (phase 4) lands.
- **Injected command runner.** The adapter depends on a small `CommandRunner`
  trait instead of a fake `az` script on `PATH`. Tests record program + args
  and return canned stdout/stderr/exit codes. Same coverage, cross-platform.
- **Program name.** Windows spawns `az.cmd` (this machine has only the scoop
  shims `az` and `az.cmd`, no `az.exe`) with `CREATE_NO_WINDOW`; other OSes
  spawn `az`. `rust-version` bumps to 1.77.2 for the `.cmd` argument-escaping
  fix (CVE-2024-24576).
- **Vault names are user input, not constants.** The panel takes a vault name
  and remembers recently used ones in `localStorage`. No organisation vault
  names are committed to the repository.
- **Workspace cleanup.** Workspace lives at `{app_data}/vault-sync/`. It is
  cleared on startup and on main-window destroy. With no push in this phase,
  there is no local work worth keeping; startup cleanup also covers crashes
  (`panic = "abort"` skips exit hooks). A user toggle arrives with phase 2.
- **Metadata.** `<name>.meta.json` holds `{ baseVersion, pulledAt, format }`.
  `baseHash` is deferred to phase 2, where the push gate needs it; the field
  is additive.
- **Non-JSON secrets** are stored as `<name>.txt` verbatim, JSON secrets as
  `<name>.json` normalised (keys sorted recursively, 2-space indent). Sorting
  is explicit, never reliant on `serde_json`'s map ordering feature flags.
- **Errors** are a `VaultError` enum serialised to the frontend as
  `{ kind, message }`, so the UI can special-case `not_signed_in`.

## Constraints
- No shell strings: `Command` with an argument array only.
- Every vault and secret name matches `^[A-Za-z0-9-]{1,127}$` before it
  reaches a command line.
- No token handling; auth is the existing `az login` session.
- Never log secret values; log vault, name, version and outcome only.
- No `unwrap`/`expect` on `az` output (release builds abort on panic).
- No generic shell plugin, no new capability permissions.
- Must not regress the existing JS and Rust test suites.

## Tasks
- [x] T1 — Domain module: `SecretRef`, `SecretValue`, `SecretSummary`,
      `Identity`, `VaultError` (+ `{kind,message}` serialisation), the sync
      `SecretProvider` port, and `validate_name`. Bump `rust-version` to 1.77.2.
      Commit `ecd408f`.
- [x] T2 — Workspace store: normalise, write working copy + `.base/` + meta,
      compute local state (`remote`, `clean`, `modified`), clean one vault or
      all. Commit `bc3fe87`.
- [x] T3 — `AzCliProvider` over an injected `CommandRunner`: argument arrays,
      output parsing (version from the `id` tail), error mapping (not signed
      in, forbidden, not found, az missing, parse failure). Commit `b740ae0`.
- [x] T4 — `VaultService` (tested against a `FakeProvider`) + Tauri commands
      `vault_status`, `vault_list`, `vault_pull`, `vault_clean`, registered in
      `lib.rs`; startup and window-destroy workspace cleanup. Commit `4ed5c36`.
- [x] T7 — Backend hardening from review advisories (accepted, in scope):
      force UTF-8 CLI output (`PYTHONIOENCODING=utf-8`) and decode stdout
      strictly, mapping invalid UTF-8 to `Parse` instead of silently replacing
      bytes; build `Cli` summaries and classify errors from the `ERROR:` lines,
      not leading `WARNING:` lines; bound every `az` call with a timeout that
      kills the child and returns a `timeout` error; `list` maps only
      `InvalidName` to `remote` and propagates other local-state errors;
      reject an `id` without a version segment. New error kind `timeout`
      (60s default). On Windows a timeout runs `taskkill /T /F` on the whole
      process tree, so the Python child of `az.cmd` does not survive. 118 Rust
      tests pass (up from 103), and each item was observed RED before GREEN.
- [x] T5 — Frontend Vault tab: vault input with recent vaults, Load, secret
      search, local-state badges, Pull opens the file via `loadFileFromDisk`,
      `not_signed_in` → "Run `az login` and retry", disabled message outside
      Tauri. Re-pulling a `modified` secret asks for confirmation first (review
      advisory R3-pull-overwrites-modified). Pure helpers (filter,
      recent-vaults list, error message mapping) are unit tested.
      Done: `src/ui/vaultModel.js` (+42 tests, observed RED 30 failed →
      GREEN), `src/ui/vaultPanel.js`, a tab in `index.html`, wiring in
      `main.js` (`loadFileFromDisk` now returns a boolean), and styles.
      Pulling a `clean` row first re-lists, so edits saved since the last
      listing still trigger the confirmation. That costs one extra `az` call.
      Tab padding shrank so 7 tabs fit in 320px; this is unmeasured, so check
      it in T6. 352 JS tests pass and the build is green.
- [ ] T6 — Manual smoke check against a real vault (list, search, pull, edit);
      record per-vault read access findings here. Also verify that a second
      launch (e.g. "Open with") does not wipe the running instance's
      workspace (review advisory R3-startup-cleanup-cross-instance).

## Route per task
| Task | Route | Trigger evidence |
|------|-------|------------------|
| T1–T4 | delegated writer (one bounded writer, backend) | 4+ new non-trivial Rust files |
| T7 | delegated writer (backend) | 2+ non-trivial Rust files (az_cli, service, domain) |
| T5 | delegated writer (frontend) | 3+ non-trivial files (panel, helpers, markup/css) |
| T6 | inline, by the user | needs the user's `az login` session |

## Acceptance criteria
- With a valid `az login`, entering a vault name lists its secrets; typing in
  the search box filters them.
- Pull writes the working copy, `.base/` copy and metadata under the app data
  dir and opens the working copy in the editor.
- Without a session, the panel says to run `az login` and retry.
- An invalid vault or secret name never reaches `az`.
- No code path in this phase can call `az keyvault secret set`.

## Applicable checks
- `npm test`
- `npm run build`
- `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --lib`

## TDD mode
Enabled (session config: Strict TDD Mode). Runners: `vitest run` for JS,
`cargo test --lib` for Rust. Every rule gets a failing test first: name
validation boundaries, normalisation, local state, argument arrays, error
mapping, service pull/list flows, and the pure frontend helpers.

## Delivery
Forecast: ~1,300 authored changed lines across T1–T5, above the ~400-line
slice budget. Strategy: `ask-on-risk`; chain strategy `stacked-to-main`
(user choice, 2026-09-30). Planned slices: PR1 backend (T1–T4), PR2 frontend
(T5), each opened against `main` once its predecessor merges.
Branch: `feat/vault-sync` from `main` (09ee339). First reviewed boundary: 09ee339.

## Progress
- Plan committed in `d77bd16`.
- T1–T4 done by one delegated backend writer with observed RED → GREEN per
  task, then split into one commit per task. Each intermediate commit was
  built and tested on its own: 42, 62, 84, then 103 Rust tests passing.
  `cargo build` is green. `npm test` passes 310 tests.
- Review (RDD on): each commit was assessed as medium with
  `slice_budget_reached`. The user granted each review, and all four were
  approved with a single reliability lens. Authority was burned for lineages
  `review-bce98743950a9f16` (T1), `review-adee98948d808614` (T2),
  `review-a4e986e0ac2efc3a` (T3) and `review-c4b3bac39dafee50` (T4). The
  reviewed boundary is now `4ed5c36`.
- Accepted non-blocking advisories are folded into T7 (backend), T5 (re-pull
  confirmation) and T6 (second-instance check).

## Phase 2 follow-ups (from review advisories, not phase 1 work)
- `normalise` goes through `serde_json::Value`. That rewrites numbers (`1.50`
  becomes `1.5`, and large integers lose precision) and collapses duplicate
  keys. Before push exists, either preserve the raw number text
  (`arbitrary_precision`) or push the untouched value when nothing was edited.
- `write_pull` is a multi-file sequence and is not atomic as a whole. Before
  base comparisons gate a push, write metadata last and treat a missing or
  stale meta file as "not pulled".
- `clean(None)` removes whatever root it is given. Guard it with a fixed leaf
  name or a marker file.

## Follow-ups from the T7 review (lineage `review-fb344e7a6042ac52`, approved)
- On Unix a timeout kills only the direct child. The `az` shell wrapper's
  Python grandchild can survive and keep the pipes open. Spawn the child in its
  own process group and kill the whole group.
- No test proves that `taskkill /T` removes a grandchild. The "child exited but
  a descendant still holds a pipe" path is also untested.
- Classification reads only lines that start with `ERROR:`. Continuation lines
  without the prefix (such as `Code: Forbidden`) are ignored, so a multi-line
  error can fall through to `cli`. Check real `az` stderr during T6.

- T7 committed in `edccb83`. The user granted its review, which was approved
  with authority burned (`review-fb344e7a6042ac52`). The reviewed boundary is
  now `edccb83`. PR1 (backend) is complete on `feat/vault-sync`.
- T5 goes on the stacked branch `feat/vault-sync-ui`, created from
  `feat/vault-sync`.

## Next step
Review the T5 commit, then T6. T6 is the user's manual smoke check and also
covers the tab-bar fit at 320px and 260px in both themes, plus pulling a
`text`-format secret.
