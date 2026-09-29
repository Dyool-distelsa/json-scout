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
- [ ] T3 CI workflow `.github/workflows/ci.yml`: JS tests + `cargo test` on ubuntu and windows. Check: first run green on GitHub. (workflow written, verification pending first GitHub run)
- [ ] T4 Release workflow `.github/workflows/release.yml`: tag `v*` or manual dispatch, matrix windows + ubuntu, `tauri-apps/tauri-action`, draft release. Check: manual dispatch produces a draft with installers. (workflow written, verification pending first GitHub run)
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
- T3 (5b0349e): `.github/workflows/ci.yml` written; not run locally. Verification pending first GitHub run.
- T4 (6e77bb8): `.github/workflows/release.yml` written (draft releases, prerelease input default true); not run locally. Verification pending first GitHub run.
- T5 (README commit): Install, Prerequisites (Linux deps), Building, Releasing, Project layout, Known limitations and License updated; readback done.

## Next step
Push, watch CI, dispatch release dry run.
