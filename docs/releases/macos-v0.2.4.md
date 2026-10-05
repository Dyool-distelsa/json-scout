# JSON Scout macOS v0.2.4 experimental prerelease

This is the next manual-only experimental macOS candidate for the combined v0.2.4 preparation. It is not stable macOS support. This change does not publish the prerelease or make DMG download assets available.

## Candidate artifacts

If a future workflow run completes, it is expected to produce separate ad-hoc-signed artifacts for:

- Intel: `JSON-Scout-0.2.4-intel.dmg` (`x86_64-apple-darwin`, `macos-15-intel`)
- Apple Silicon: `JSON-Scout-0.2.4-arm64.dmg` (`aarch64-apple-darwin`, `macos-15`)

These are expected names, not evidence that either artifact currently exists. Any eventual draft would use the `macos-v0.2.4` namespace, remain unpublished, and not be marked latest.

## Workflow safety

The workflow is manual-only and defaults to `macos-v0.2.4`. Dispatch requires a full commit SHA; the checked-out app version, tag, and versioned notes must agree before either native build starts. Windows and Linux release automation is separate and is not changed by this workflow.

Build jobs use read-only contents access and upload only run-bound opaque DMG artifacts. The guarded upload job accepts exactly the expected Intel and Apple Silicon files, filters asset names across paginated listings, refuses duplicates or clobbering, and only targets a matching draft prerelease. It does not publish the draft or alter a stable release.

No remote dispatch, GitHub release mutation, Apple account, certificate, or notarization credential was used for this preparation.

## Signing and notarization

The workflow uses the ad-hoc `-` signing identity. These artifacts are **not Developer ID signed and not notarized**. Gatekeeper may require an app-specific **Open Anyway** or Finder **Control-click → Open** choice. Never disable macOS security globally.

## Verification status

Local YAML, shell, action-pin, security, and paginated asset-handling checks passed. They do not replace execution on the actual macOS runners. Native macOS builds and desktop smoke testing remain pending, so this document makes no claim that JSON Scout supports macOS.

See the [stable v0.2.4 preparation notes](v0.2.4.md) for the Windows/Linux and Azure CLI changes.
