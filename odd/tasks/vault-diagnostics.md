# Vault diagnostics

## Objective
Provide actionable, secret-safe Azure Key Vault errors and a consultable, copyable diagnostic report for local testing and GitHub issue reports.

## Accepted scope
User selected copyable report, not persistent file logging. Toast identifies operation and safe error cause/code; report remains accessible after toast expiry. No automatic GitHub publishing.

## Constraints
Never expose secret values, raw stdout/stderr, unredacted CLI arguments, staged paths, or credentials. Preserve existing vault behavior. Technical artifacts follow existing English conventions. User now explicitly authorizes commits, local new-version installation, pushing changes and preparing official release. macOS is a separate signed/notarized official release; Apple credentials must never be pasted into chat.

## Tasks
- [x] T1 Implement structured safe backend diagnostics with focused regression tests.
- [x] T2 Expose consultable/copyable reports in the vault UI, with tests and documentation. (Newline regression corrected and checked.)
- [ ] T3 Verify integrated behavior and review applicable candidate.
- [x] T4 Prepare Windows/Linux 0.2.3 version and release notes; verify native installer build.
- [x] T5 Create work-unit commits and push feature branch; install new Windows version locally and verify observable installation evidence.
- [ ] T6 Prepare official Windows/Linux draft release after remote/policy checks; no unsupported merge or published-completeness claims.
- [ ] T7 Prepare separate official macOS signed/notarized release plan and identify secure credential/build-validation prerequisites.

## Acceptance and checks
- Parse failures identify operation and safe failure category without quoting offending input.
- Diagnostics remain available after transient toast expiration and can be copied on demand.
- Reports contain no secret values or raw CLI output; adversarial sentinel tests cover leakage.
- Existing Rust vault and frontend tests pass; run focused checks first, applicable suites at closure.
- Applicable deterministic behavior changes use observed RED then GREEN; record exact commands/results.

## Progress
T1 implemented and focused checks passed. Cleanup removed unrelated formatting churn; remaining 792 changed lines include diagnostic schema/behavior and regression tests. T2 correction complete: real newlines replace literal separators; regression RED observed (1 failed/81 passed), GREEN 82, full frontend suite 765 passed, build passed. T3 automated verification finished without further findings; desktop smoke and native review remain unavailable/pending. Implementation complete, overall verification partial. Commits/push/local installation/release preparation now authorized; execution pending. Independent verification required because native assessment is unavailable.

## Evidence
Scout mapped src-tauri/src/vault/{domain,az_cli,commands}.rs, src/ui/{vaultModel,vaultPanel,toast}.js and docs/azure-key-vault.md.
T1: cargo test --manifest-path src-tauri/Cargo.toml vault passed (223); changed-file rustfmt passed. Workspace cargo fmt --check failed, reported as pre-existing; base formatting confirmed in cleanup follow-up. Serialized error adds optional diagnostic {operation, reason, metadata} preserving kind/message. Regression tests cover secret-bearing output leakage. Follow-up vault tests passed (223), diff --check passed. Read-only HEAD snapshots piped to rustfmt confirm base formatting failures in both changed modules and untouched commands.rs. Final changed-file rustfmt remains baseline-limited. Native assess returned unassessable (package-local-binary-missing); independent verifier required.

T2 evidence: observed RED (9 failures), GREEN (102 focused tests), 33 additional vault tests, full npm test 764 passed, npm run build succeeded (chunk-size warning), git diff --check passed. Report allowlists structured fields, remains in panel memory, offers copy and selectable fallback. Docs updated. Browser/desktop check pending.
T3 independent checks: npm test 764 passed; cargo test --manifest-path src-tauri/Cargo.toml 254 passed; build and diff --check passed. No diagnostic leakage found. Medium defect: report lines.join uses literal backslash-n; fix delegated. Review mode status reads on globally. Desktop check unavailable: no browser-control dependencies/tools, ordinary browser disables Vault, desktop cannot safely inject synthetic failures with current tooling.

## Delivery evidence
- Backend commit: d7c97fe.
- UI/tests/docs commit: 56bcf72.
- Version/release notes commit: 62ece50.
- T4 npm test 765 passed; cargo test 254 passed; npm run tauri build passed, MSI/NSIS 0.2.3 artifacts generated. Metadata/docs-only change used structural validation (no meaningful RED).
- GitHub API release lookup failed definitively with 401 Bad credentials. No remote release mutation attempted. SSH push succeeded for feat/vault-diagnostics-release at d752e97. Valid keyring authentication confirmed using per-command omission of invalid GH_TOKEN/GITHUB_TOKEN; API release lookup succeeds (v0.2.2 draft, v0.2.1 latest).
- Installation worker retained evidence: clean rebuild passed; NSIS /S exit 0; installed 0.2.3 existing per-user path; app window opened. Worker task settlement failed (child exit unconfirmed), so independent installation readback delegated; do not rerun installer. Built/installed hashes differ in bundle marker reportedly UNK vs NSS.
- Roaming app-data immediate entry count decreased 1 to 0 after launch; read-only separate incident scout delegated before release. No deletion/restoration authorized. Context menu entries preserved but point at previous build path. Vault interaction smoke pending.

## Independent installation confirmation
Installed per-user executable and HKCU entry both report 0.2.3; running installed app has visible JSON Scout window. Binary differs from build in exactly three bytes (UNK to NSS), confirmed expected Tauri NSIS bundle marker. Workspace synthetic tests: 50 passed, siblings preserved, basename guard enforced. Cleanup predates candidate and is documented session behavior; exact removed entry remains unknown. No live data read/restored/deleted.
Remote branch d752e97 is four commits ahead/zero behind main; no candidate CI runs/PR, no v0.2.3 tag/release. Repository main unprotected, viewer ADMIN. Release workflow must run candidate revision, not old main. Integration decision pending; no merge authorized yet.

## Next step
Post-correction independent verifier passed 103 focused tests and git diff --check, confirmed clipboard and fallback share the newline-formatted report; no findings. Next: manual desktop smoke (Vault > Last diagnostic > Copy report). Native inspect blocked: native-status-package-binary-missing; no lineage created and no mutation. Native review unavailable despite mode on. Desktop smoke remains pending because no safe synthetic-failure browser/desktop harness is available. Report these limitations; no package/environment changes authorized.
