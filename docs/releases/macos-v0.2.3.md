# JSON Scout macOS v0.2.3 experimental prerelease

This is a separate, manual-only draft prerelease for people who want to test JSON Scout on macOS. It is not stable macOS support and must not be treated as an official support claim.

## Artifacts

- Intel: `JSON-Scout-0.2.3-intel.dmg` (`x86_64-apple-darwin`, `macos-15-intel`)
- Apple Silicon: `JSON-Scout-0.2.3-arm64.dmg` (`aarch64-apple-darwin`, `macos-15`)

Both artifacts are built from the explicitly supplied full commit SHA and uploaded to one separate draft prerelease in the `macos-v0.2.3` namespace. The release is created with `make_latest=false` and is never published automatically.

## Workflow safety

The workflow is manual-only and keeps the application version unchanged. Its build jobs have `contents: read` permission, do not receive a write token, and upload each DMG as a run-bound artifact. A separate upload job downloads exactly the two expected non-empty regular files, rejects symlinks, treats the DMGs as opaque bytes, and does not execute anything from them.

Before creating or uploading, the write job verifies the full commit target, tag, draft and prerelease state, and accepts an existing draft only when it is the matching release. Published releases and existing asset names are never overwritten. The workflow does not publish the draft or alter the Windows/Linux release workflow.

## Signing and notarization

The workflow intentionally uses the ad-hoc `-` signing identity. These artifacts are **not Developer ID signed and not notarized**; no Apple account, certificate, or notarization credentials are used. Gatekeeper may require an app-specific **Open Anyway** or Finder **Control-click → Open** choice. Never disable macOS security globally.

## Verification status

JavaScript tests, Rust tests, and the frontend build run on each macOS runner before bundling. Native macOS build verification and desktop smoke testing are still pending; no macOS support claim should be made until both targets have been independently checked.
