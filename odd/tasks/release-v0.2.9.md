# JSON Scout v0.2.9 release
Objective: integrate the authorized environment-indicator feature into main and publish the next Windows/Linux patch release.
Branch: `feature/environment-indicator` then authorized integration to verified `main`; delivery: single release; checks: metadata, Vitest/Vite, repository CI and release artifacts.

## Specs

- S1 — "merge it to main and publish the new release". Checks: version metadata is consistent; authorized feature reaches remote main; repository CI passes; release workflow completes; correct tag/commit and all expected Windows/Linux artifacts are verified before publication; published state read back.

## Tasks

- R1 [S1] route:inline status:done commit:7e4f646 — Prepare 0.2.9 metadata and release notes; validate consistent versions and existing functional checks.
- R2 [S1] route:inline-delivery/CI-verifier status:in_progress commit:pending — Integrate and push main without force/history rewriting; observe exact-candidate CI.
- R3 [S1] route:inline-delivery/independent-verifier status:pending commit:pending — Create the release once, build and verify five Windows/Linux assets, publish and confirm public state.

## Log

- L1 — User request verbatim: "merge it to main and publish the new release".
- L2 — Preflight: clean feature/environment-indicator; commits 8e2cb92, 4631d4a, addee79; origin/main has no extra commits (0 behind / 3 ahead). Remote default main confirmed; admin/push permission. Protection endpoint returns documented 404 Branch not protected, not an authentication failure. Latest published stable is v0.2.8 with five assets, so next ordinary patch is v0.2.9. No existing releases altered.
- L3 — Release workflow creates a draft and builds Windows/Linux; publishing is a separate explicit human decision, supplied by L1. Push the checked v0.2.9 tag once to start the canonical workflow; its initial draft defaults to prerelease=true. After both OS builds and artifact verification succeed, set prerelease=false and publish. Do not dispatch a duplicate manual workflow.
- L4 — Previous implementation proof: 916 JS tests and frontend build passed. Independent source/controller probes passed, but independent scratch panel tests and rendered/native-title checks were unavailable; native RDD binary unavailable. Those limitations remain unverified, recorded in odd/tasks/environment-indicator.md, not converted to success by publication authorization.
- L5 — Metadata/docs-only preparation has no meaningful behavioral RED. Preserve dependencies, runtime permissions and CI/release workflows. Route inline: one dependent metadata/delivery chain, not parallel independent writers. Repository CI supplies independent JS/build/Rust execution; one bounded release verifier will inspect actual remote artifacts.
- L6 — All six package/npm-lock/Cargo/Cargo-lock/Tauri version declarations changed to 0.2.9; npm dependency graph unchanged. Local release links and diff check passed. A metadata-check script first had an escaping syntax error, then exposed a malformed package.json edit; the single damaged version line was corrected and the check passed before any commit or push. Job-6 passed: 916 tests / 61 files and production frontend build, existing large-chunk warning only. README/runbook no longer misstate v0.2.4 as the latest unpublished release.
- L7 — Independent release-preparation verifier PASS for S1/R1: six versions, unchanged dependency diffs, accurate proof limitations, unchanged workflow/security, diff check. Its overbroad Cargo-lock normalization false result was checked against the actual diff: only root json-scout version changed. No preparation blockers. Remote CI and assets/publication remain unverified until R2/R3.
- L8 — R1 work-unit commit 7e4f6467271f9218de3058e79606390c3624c5b0 created on feature/environment-indicator. R2 will fast-forward verified main to this release plus this tracking-only transition and push without force. No implementation edits on main.
