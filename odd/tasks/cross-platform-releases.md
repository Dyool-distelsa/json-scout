# Cross-platform builds and GitHub releases

## Objective
Anyone can install JSON Scout on Windows or Linux from a GitHub Release, and every tag build is produced by CI instead of a local machine.

## Problem / why
- The build only targets Windows installers (`nsis`, `msi`) and the local binary is blocked by Smart App Control.
- `winreg` is an unconditional Rust dependency, which does not compile on Linux.
- The Settings panel offers an Explorer context-menu toggle that always fails on Linux.
- No CI, no release automation, and the README only documents Windows.

## Scope
In: Windows + Linux (deb, rpm, AppImage), CI tests, draft-release workflow, README install/release docs.
Out: macOS, code signing, auto-update, pushing a release tag (the user decides when).

## Constraints
- Artifacts in English. No AI attribution in commits; conventional commits.
- ~400 changed-line planning heuristic per task (advisory).
- TDD: enabled (strict). Source: project config (Strict TDD Mode). Runners: `npm test` (vitest), `cd src-tauri && cargo test`.
- Releases are created as **drafts**; publishing stays a human decision.
- Token stays out of the repo; workflows use the built-in `GITHUB_TOKEN`.

## Tasks
- [x] T1 Backend portability: `winreg` only under `cfg(windows)`, neutral Cargo description, bundle targets valid on both OSes. Check: `cargo test` still green.
- [x] T2 UI gating (RED first): pure `supportsContextMenu` helper in `src/ui/runtime.js` with tests; Settings panel shows a "Windows only" state elsewhere. Check: `npm test`.
- [x] T3 CI workflow `.github/workflows/ci.yml`: JS tests + `cargo test` on ubuntu and windows. Check: first run green on GitHub. (CI run 36608315048 green on ubuntu-22.04 and windows-latest)
- [x] T4 Release workflow `.github/workflows/release.yml`: tag `v*` or manual dispatch, matrix windows + ubuntu, `tauri-apps/tauri-action`, draft release. Check: manual dispatch produces a draft with installers. (dispatch run 36608891413 produced draft prerelease v0.1.0 with .rpm, .AppImage, .deb, setup .exe, .msi)
- [x] T5 README: Linux prerequisites, install from Releases, release process, platform notes, license line. Check: readback.

## Acceptance criteria
- `cargo test` and `npm test` pass locally; CI green on both OSes.
- A manually dispatched release run attaches Windows and Linux installers to a draft release.
- README lets a stranger install, build and cut a release.

## Routing
- Route: delegated direct (writer trigger: 2+ non-trivial files across Rust config, JS, workflows, docs).
- Delivery strategy: ask-on-risk; forecast well under 400 authored lines.

## Progress / evidence
- T1 (9c3cc5f): `winreg` moved under `[target.'cfg(windows)'.dependencies]`, empty cfg table removed, neutral descriptions, bundle `targets: "all"`. `cd src-tauri && cargo test`: 31 passed, 0 failed.
- T2 (a93d250): RED observed first (`npm test`: 4 failed, 256 passed). After implementing `supportsContextMenu` and the Settings gating: 17 files, 260 passed. `npm run build` exit 0.
- T3 (5b0349e): `.github/workflows/ci.yml`; run 36608315048 succeeded on ubuntu-22.04 and windows-latest (JS tests, frontend build, Rust tests), which also proves `winreg` gating compiles on Linux.
- T4 (6e77bb8): `.github/workflows/release.yml`; dispatch run 36608891413 succeeded on both OSes and produced draft prerelease v0.1.0 with `.rpm`, `.AppImage`, `.deb`, setup `.exe` and `.msi`.
- Finding: GitHub renames release assets with dots (`JSON.Scout_0.1.0_amd64.deb`), so README install commands use `JSON*Scout*` globs.
- T5 (README commit): Install, Prerequisites (Linux deps), Building, Releasing, Project layout, Known limitations and License updated; readback done.

## Next step
Done. Draft v0.1.0 is a dry-run artifact: delete it or bump versions and tag a real release. Release assets are named "JSON.Scout_*" (GitHub replaces spaces with dots), so README globs use JSON*Scout*.

## Follow-up: release race fix
- Problem: matrix jobs each created their own draft on the v0.1.0 tag push (one draft per OS); assets were merged by hand.
- Fix (1d56710): `create-release` job creates the draft once and exposes its id; `build` jobs upload via tauri-action `releaseId`. Manual dispatch now requires a `tag` input; an already-published tag is refused.
- Evidence: dispatch run 36611640299 (tag v0.0.0-test) produced one draft with 5 installers; dispatch run 36611645127 (tag v0.1.0) failed at create-release with "already published"; published v0.1.0 kept its 5 assets. Test draft deleted.
