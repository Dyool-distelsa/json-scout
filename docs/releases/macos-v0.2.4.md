# JSON Scout macOS v0.2.4 experimental prerelease

This is the manual-only experimental macOS candidate for the combined v0.2.4 preparation. It is not stable macOS support. The recorded verification run did not publish the prerelease; its guarded macOS draft currently has zero assets.

## Build outputs (not release assets)

Run `37368447436` succeeded for both native builds, tests, and DMG creation from target `d7f5dc8`:

- Intel: `JSON-Scout-0.2.4-intel.dmg` (`x86_64-apple-darwin`, `macos-15-intel`)
- Apple Silicon: `JSON-Scout-0.2.4-arm64.dmg` (`aarch64-apple-darwin`, `macos-15`)

These names describe the run-bound DMG outputs, not downloadable release assets. The guarded upload failed, leaving the `macos-v0.2.4` draft with zero assets; no Mac asset is available to install. The draft remains unpublished and is not marked latest.

## Workflow safety

The workflow is manual-only and defaults to `macos-v0.2.4`. Dispatch requires a full commit SHA; the checked-out app version, tag, and versioned notes must agree before either native build starts. Windows and Linux release automation is separate and is not changed by this workflow.

Build jobs use read-only contents access and upload only run-bound opaque DMG artifacts. The guarded upload job accepts exactly the expected Intel and Apple Silicon files, filters asset names across paginated listings, refuses duplicates or clobbering, and only targets a matching draft prerelease. It does not publish the draft or alter a stable release.

The recorded run used no Apple account, certificate, or notarization credential. This documentation correction performs no remote dispatch or GitHub mutation.

## Signing and notarization

The workflow uses the ad-hoc `-` signing identity. These artifacts are **not Developer ID signed and not notarized**. Gatekeeper may require an app-specific **Open Anyway** or Finder **Control-click → Open** choice. Never disable macOS security globally.

## Verification status

Local YAML, shell, action-pin, security, and paginated asset-handling checks passed. Run `37368447436` then succeeded for both native builds/tests and DMG creation from `d7f5dc8`, but its guarded upload failed, leaving the macOS draft with zero assets. Desktop smoke testing was not done, so this document makes no claim that JSON Scout supports macOS. The user-confirmed Windows local smoke for the stable candidate is separate evidence and is not macOS verification.

These are release-preparation notes, not an installation guide. See the [stable v0.2.4 preparation notes](v0.2.4.md) for the Windows/Linux and Azure CLI changes.
