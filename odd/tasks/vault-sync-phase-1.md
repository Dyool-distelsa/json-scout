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
- [ ] T1 — Domain module: `SecretRef`, `SecretValue`, `SecretSummary`,
      `Identity`, `VaultError` (+ `{kind,message}` serialisation), the sync
      `SecretProvider` port, and `validate_name`. Bump `rust-version` to 1.77.2.
- [ ] T2 — Workspace store: normalise, write working copy + `.base/` + meta,
      compute local state (`remote`, `clean`, `modified`), clean one vault or
      all.
- [ ] T3 — `AzCliProvider` over an injected `CommandRunner`: argument arrays,
      output parsing (version from the `id` tail), error mapping (not signed
      in, forbidden, not found, az missing, parse failure).
- [ ] T4 — `VaultService` (tested against a `FakeProvider`) + Tauri commands
      `vault_status`, `vault_list`, `vault_pull`, `vault_clean`, registered in
      `lib.rs`; startup and window-destroy workspace cleanup.
- [ ] T5 — Frontend Vault tab: vault input with recent vaults, Load, secret
      search, local-state badges, Pull opens the file via `loadFileFromDisk`,
      `not_signed_in` → "Run `az login` and retry", disabled message outside
      Tauri. Pure helpers (filter, recent-vaults list, error message mapping)
      are unit tested.
- [ ] T6 — Manual smoke check against a real vault (list, search, pull, edit);
      record per-vault read access findings here.

## Route per task
| Task | Route | Trigger evidence |
|------|-------|------------------|
| T1–T4 | delegated writer (one bounded writer, backend) | 4+ new non-trivial Rust files |
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
- Branch created. Feature document written.
- T1–T4 delegated to one backend writer (in progress).

## Next step
Review the backend writer's report, commit T1–T4 as work units, then T5.
