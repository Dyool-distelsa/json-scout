# JSON Scout

A lightweight cross-platform (Windows and Linux) desktop JSON toolbox, built to replace "paste your JSON into a website" with a fast native app. On Windows it also integrates with the Explorer right-click menu.

## Release status

The next combined `v0.2.4` release is prepared but not published. Remote verification produced a five-asset Windows/Linux draft with GitHub-reported SHA-256 digests, but it is not a published stable release. The separate macOS draft currently has zero assets. See the [v0.2.4 preparation notes](docs/releases/v0.2.4.md) and [macOS v0.2.4 experimental notes](docs/releases/macos-v0.2.4.md) for the current status.

## Quick install

Use the [canonical installation and Azure Key Vault runbook](docs/installation.md) for exact release approval, architecture checks, hashes, install/update/uninstall steps, and agent stop conditions. Download only an asset visibly present in the approved [Releases page](https://github.com/Dyool-distelsa/json-scout/releases); the prepared `v0.2.4` notes are not a download link.

| Platform | Runtime artifacts | Status |
| --- | --- | --- |
| Windows | NSIS `.exe` (per-user) or MSI | Stable; unsigned installers may trigger SmartScreen or Smart App Control. |
| Linux | `.deb`, `.rpm`, or AppImage | Stable; choose the format matching the installed distribution. |
| macOS | Intel or Apple Silicon DMG, only if an experimental draft contains it | Experimental, ad-hoc signed, not notarized; no universal macOS support claim. |

Check the machine's actual architecture, copy the exact approved filename, and record its source URL and SHA-256 provenance before installing. The [macOS v0.2.4 notes](docs/releases/macos-v0.2.4.md) describe preparation status only.

**Runtime versus source build:** a runtime install needs neither Node.js nor Rust. Source development/builds need Node.js/npm, stable Rust, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). The optional Azure Key Vault plugin additionally needs the user's separately installed [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), not a Node/Rust fallback.

## Features

- **Format** JSON with configurable indent (2 spaces, 4 spaces, or tab)
- **Minify**
- **Validate** with precise line/column error reporting, shown in the editor's lint gutter
- **Repair** common mistakes (trailing commas, single quotes, unquoted keys, missing brackets, comments, newline-delimited JSON) via `jsonrepair`
- **Diff / Compare** two JSON documents structurally (not a naive text diff), via `jsondiffpatch`
- **Tree view** of the parsed structure, click a node to copy its path
- **Query** with JSONPath (`jsonpath-plus`)
- **Convert**: JSON ↔ YAML, JSON → CSV (nested objects flattened with dot notation, arrays of objects become rows)
- **Sort keys** recursively, alphabetically
- **Escape / Unescape** JSON string content
- **Stats**: byte size, line count, max depth, total keys, array count, type histogram
- **File menu** grouping Open, Save and Save As (keyboard accessible: arrow keys, Escape, outside click); native dialogs via `tauri-plugin-dialog`, and Save writes atomically back to the opened file
- **Auto-clean on paste**: pasting into an empty editor, or over a selection that covers the whole document, validates, repairs, sorts keys and formats the text using the current indent. Text that cannot be repaired is pasted as-is with a notice; pasting a fragment into existing content stays a plain paste
- **Copy button** in the top-right corner of the editor copies the full editor content
- Toast notifications (e.g. minify saving), dark/light theme, collapsible sidebar and side panel, drag-and-drop, non-blocking error banners
- Debounced re-processing with a lazily rendered tree, so large documents stay responsive

## Windows Explorer integration

Windows only. The main entry points are:

- **Open with JSON Scout** on a `.json` file loads it on startup (CLI argv).
- **Right-click a `.json` file → "Open in JSON Scout"**.
- **Right-click a folder background → "JSON Scout here"** — scans the folder for `*.json` files and lists them in the sidebar.
- **Right-click a folder → "JSON Scout here"**.

All of this is registered under `HKEY_CURRENT_USER` only — installing it never requires administrator rights. You can toggle it from the in-app **Settings** tab (backed by Rust `winreg` commands: `install_context_menu` / `uninstall_context_menu` / `is_context_menu_installed`), or run the standalone scripts directly:

```powershell
# Install (defaults to the release build output; pass -ExePath for a different location)
./scripts/install-context-menu.ps1 -ExePath "C:\Program Files\JSON Scout\json-scout.exe"

# Remove
./scripts/uninstall-context-menu.ps1
```

A second click of any "Open in JSON Scout" / "JSON Scout here" entry reuses the already-running window instead of spawning a new process (via `tauri-plugin-single-instance`).

## Azure Key Vault plugin (optional)

The plugin is off by default. It uses the user's existing Azure CLI (`az`) session, never stores tokens, and requires the desktop app. Turn it on from the toolbar **Plugins** menu only after the account, permissions, network, and explicit read/write approval are ready. See the [Azure Key Vault guide](docs/azure-key-vault.md) and the [canonical runbook](docs/installation.md).

## Source-build prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- **Windows source builds:** Tauri's [MSVC prerequisites](https://v2.tauri.app/start/prerequisites/); the WebView2 Runtime is a separate Windows runtime prerequisite for running the desktop app.
- **Linux:** Tauri's [system prerequisites](https://v2.tauri.app/start/prerequisites/); follow that page for distro-specific packages.

## Development

```bash
npm install
npm run tauri dev
```

## Testing

The JS tools layer (`src/tools/`) has full Vitest coverage, written test-first:

```bash
npm test
```

Rust modules have their own `#[cfg(test)]` unit tests (filesystem ops via `tempfile`, registry key-path construction as pure string building — no real registry access in tests):

```bash
cd src-tauri
cargo test
```

## Building

```bash
npm run build        # frontend only (Vite production build -> dist/)
npm run tauri build  # full desktop app with the installers for the current OS
```

Installer formats per OS: NSIS and MSI on Windows; deb, rpm and AppImage on Linux. They land in `src-tauri/target/release/bundle/<format>/` (`nsis/`, `msi/`, `deb/`, `rpm/`, `appimage/`).

## Releasing

CI (`.github/workflows/ci.yml`) runs the JS and Rust tests on Ubuntu and Windows for every push to `main` and every pull request. Releases are built by `.github/workflows/release.yml`:

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, and commit.
2. Tag and push: `git tag vX.Y.Z` then `git push origin vX.Y.Z`. The tag must match the version.
3. The workflow builds Windows and Linux installers and attaches them to a **draft** release.
4. Review the draft on GitHub, then publish it.

The workflow can also be run manually from the Actions tab (`workflow_dispatch`, with a `tag` and `prerelease` inputs) as a dry run, passing a throwaway `tag` (for example `v0.0.0-test`): it only creates a draft release, which you can delete afterwards. A tag that already has a published release is refused, so published assets are never overwritten.

The experimental macOS workflow (`.github/workflows/macos-experimental.yml`) is separate from the Windows/Linux release workflow. It checks the selected commit against the application version and defaults to `macos-v0.2.4`; it does not publish a draft, change stable releases, or imply that macOS is supported. Native Intel and Apple Silicon builds passed; desktop smoke testing remains pending. The experimental draft has no downloadable DMGs until the failed asset-upload step is corrected.

## Project layout

```
src/                    Vanilla JS + Vite frontend
  tools/                Pure, TDD'd JSON functions (format, minify, validate, repair,
                         diff, tree, query, convert, sortKeys, escape, stats, pastePipeline)
  ui/                    DOM glue: editor (CodeMirror 6), toolbar, sidebar, right panel,
                         status bar, theme, toasts, debounce, runtime detection,
                         drag-and-drop, settings, file menu, clipboard, paste rules
  styles/main.css        Dark/light theme via CSS custom properties
  main.js                Entry point, wiring, keyboard shortcuts

src-tauri/              Rust backend (Tauri v2)
  src/main.rs            Entry point
  src/lib.rs              Tauri builder, command registration, single-instance + startup payload
  src/fs_ops.rs           read_json_file / write_json_file / scan_dir_for_json
  src/shell_integration.rs  HKCU context-menu registry commands
  src/cli.rs              argv -> startup payload ({ kind: "file"|"dir"|"none", path })
  icons/                  App icon set (generated via `npx tauri icon`)
  capabilities/           Tauri v2 permission capabilities

.github/workflows/      ci.yml (tests on Linux + Windows), release.yml (draft releases on tags)

odd/tasks/              Per-feature task documents (scope, tasks, verification evidence)

scripts/                 Standalone PowerShell fallback for the context-menu install

docs/                    User guides (docs/installation.md, docs/azure-key-vault.md)
```

## Known limitations

- Very large integers (beyond `Number.MAX_SAFE_INTEGER`) lose precision on format/minify/validate, the same way `JSON.parse`/`JSON.stringify` do natively. This is documented and tested rather than silently "fixed" with a lossless-number rewrite.
- The Windows binaries and installers are unsigned. Smart App Control or an enterprise policy may block them ("An Application Control policy has blocked this file"). Stop and obtain an administrator-approved per-app policy path if your organization permits it; do not turn off Smart App Control globally or use an arbitrary bypass. SmartScreen may warn; use **Run anyway** only for the explicitly approved asset.
- The Explorer context-menu integration is Windows-only. Linux relies on the desktop entry installed by the deb/rpm/AppImage packages.
- Browsers without Tauri get a degraded fallback (file input / download) instead of native dialogs; the desktop app is the supported target.

## License

MIT, see [LICENSE](LICENSE).
