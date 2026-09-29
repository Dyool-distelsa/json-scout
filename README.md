# JSON Scout

A lightweight Windows desktop JSON toolbox, built to replace "paste your JSON into a website" with a fast native app you launch straight from Explorer's right-click menu.

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

This is the actual point of the app:

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
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain) + the MSVC build tools, required by Tauri on Windows
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (already present on modern Windows 11 installs)

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
npm run tauri build  # full desktop app: NSIS + MSI installers
```

The built installers land in `src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/bundle/msi/`.

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

odd/tasks/              Per-feature task documents (scope, tasks, verification evidence)

scripts/                 Standalone PowerShell fallback for the context-menu install
```

## Known limitations

- Very large integers (beyond `Number.MAX_SAFE_INTEGER`) lose precision on format/minify/validate, the same way `JSON.parse`/`JSON.stringify` do natively. This is documented and tested rather than silently "fixed" with a lossless-number rewrite.
- The release binary is unsigned. Windows Smart App Control may block it ("An Application Control policy has blocked this file"); turn Smart App Control off or sign the executable to run local builds.
- Browsers without Tauri get a degraded fallback (file input / download) instead of native dialogs; the desktop app is the supported target.
