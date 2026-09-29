# JSON Scout

A lightweight cross-platform (Windows and Linux) desktop JSON toolbox, built to replace "paste your JSON into a website" with a fast native app. On Windows it also integrates with the Explorer right-click menu.

## Install

Download the installer for your OS from the [Releases page](https://github.com/Dyool-distelsa/json-scout/releases).

**Windows**

- Run the NSIS `.exe` (per-user install) or the `.msi`.
- The installers are unsigned. Windows SmartScreen may warn ("Windows protected your PC"): click **More info** then **Run anyway**. Smart App Control, if enabled, can block unsigned apps outright; it can only be turned off in Windows Security settings (see Known limitations).

**Linux**

```bash
sudo apt install ./JSON*Scout*.deb     # Debian / Ubuntu
sudo dnf install ./JSON*Scout*.rpm     # Fedora / RHEL
chmod +x JSON*Scout*.AppImage && ./JSON*Scout*.AppImage   # AppImage, no install
```

On Linux the installed desktop entry registers JSON Scout as a JSON handler, so **Open with** works from your file manager. The Explorer context-menu integration below is Windows-only.

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
- Native **Open** and **Save As** dialogs (`tauri-plugin-dialog`); Save writes atomically back to the opened file
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

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- **Windows:** the MSVC build tools, required by Tauri, and [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (already present on modern Windows 11 installs)
- **Linux:** the Tauri v2 system libraries (Debian/Ubuntu package names):

  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  ```

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

## Project layout

```
src/                    Vanilla JS + Vite frontend
  tools/                Pure, TDD'd JSON functions (format, minify, validate, repair,
                         diff, tree, query, convert, sortKeys, escape, stats)
  ui/                    DOM glue: editor (CodeMirror 6), toolbar, sidebar, right panel,
                         status bar, theme, toasts, debounce, runtime detection,
                         drag-and-drop, settings
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
```

## Known limitations

- Very large integers (beyond `Number.MAX_SAFE_INTEGER`) lose precision on format/minify/validate, the same way `JSON.parse`/`JSON.stringify` do natively. This is documented and tested rather than silently "fixed" with a lossless-number rewrite.
- The Windows binaries and installers are unsigned. Windows Smart App Control may block them ("An Application Control policy has blocked this file"); turn Smart App Control off or sign the executable to run them. SmartScreen only warns and can be bypassed with **Run anyway**.
- The Explorer context-menu integration is Windows-only. Linux relies on the desktop entry installed by the deb/rpm/AppImage packages.
- Browsers without Tauri get a degraded fallback (file input / download) instead of native dialogs; the desktop app is the supported target.

## License

MIT, see [LICENSE](LICENSE).
