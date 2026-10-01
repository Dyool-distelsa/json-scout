import { initTheme, toggleTheme } from './ui/theme.js';
import { createEditor } from './ui/editor.js';
import { createToolbar } from './ui/toolbar.js';
import { createStatusBar } from './ui/statusbar.js';
import { createSidebar } from './ui/sidebar.js';
import { initRightPanel } from './ui/rightPanel.js';
import { initDragAndDrop } from './ui/dragdrop.js';
import { createSettingsPanel } from './ui/settings.js';
import { createVaultPanel } from './ui/vaultPanel.js';
import { collapseToggleState, shouldToggleOnHeaderClick } from './ui/collapsible.js';
import { matchShortcut, shouldFireShortcut } from './ui/shortcuts.js';
import { flashEditor } from './ui/feedback.js';

import { formatJson } from './tools/format.js';
import { minifyJson } from './tools/minify.js';
import { validateJson } from './tools/validate.js';
import { parseDocument } from './tools/parseDocument.js';
import { repairJson } from './tools/repair.js';
import { sortKeysDeep } from './tools/sortKeys.js';
import { processPastedJson } from './tools/pastePipeline.js';
import { escapeString, unescapeString } from './tools/escape.js';
import { utf8ByteLength, formatBytes, computeMinifySaving, computeFormatGrowth } from './tools/jsonUtils.js';
import { mountToastContainer } from './ui/toast.js';
import { isTauriRuntime, deriveDisplayFileName } from './ui/runtime.js';
import { debounce } from './ui/debounce.js';
import { isCopyable, copyText } from './ui/clipboard.js';
import { describePasteSuccess, PASTE_FAILURE_MESSAGE } from './ui/pasteRules.js';

const DERIVED_REFRESH_DEBOUNCE_MS = 250;

initTheme();

const state = {
  currentPath: null,
  currentDir: null,
  indent: 2,
  diffMode: false,
};

const toast = mountToastContainer(document.getElementById('toast-container'));

const statusBar = createStatusBar(document.getElementById('statusbar'));
updateFileName(state.currentPath);

const editor = createEditor(document.getElementById('editor'), {
  doc: '',
  theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
  onChange: onEditorChange,
  onPaste: handlePaste,
});

let secondaryEditor = null;

const rightPanel = initRightPanel({
  tabsEl: document.getElementById('right-panel-tabs'),
  panelsEl: document.getElementById('right-panel-panels'),
  onCopyPath: async (path) => {
    try {
      await navigator.clipboard.writeText(path);
      statusBar.setParseTime(0);
    } catch {
      toast.showToast('Could not copy to clipboard.', 'error');
    }
  },
  onNotify: (msg, kind) => toast.showToast(msg, kind),
});

createSettingsPanel(document.getElementById('panel-settings'), (msg, kind) => toast.showToast(msg, kind));

createVaultPanel(document.getElementById('panel-vault'), {
  invoke: tauriInvoke,
  openFile: loadFileFromDisk,
  notify: (msg, kind) => toast.showToast(msg, kind),
  isTauri: isTauriRuntime(),
});

const sidebar = createSidebar(document.getElementById('sidebar-list'), async (name) => {
  if (!state.currentDir) return;
  await loadFileFromDisk(joinPath(state.currentDir, name));
});

function joinPath(dir, name) {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

async function tauriInvoke(command, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
}

/**
 * Reflect the currently open file (or lack thereof) in the window
 * title and the status bar, so the user always knows what Save will
 * write to.
 * @param {string|null} path
 */
function updateFileName(path) {
  const name = deriveDisplayFileName(path);
  document.title = path ? `${name} — JSON Scout` : 'JSON Scout — Untitled';
  statusBar.setFileName(name);
}

function runTiming(fn) {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  return { result, elapsed };
}

/**
 * Re-render the derived (tree/stats/query/convert/diff) panels for the
 * current editor content.
 * @param {{ valid: true, value: * } | { valid: false, error: object }} [parseResult]
 *   Reuse an already-computed parse result (from `computeDerivedState`)
 *   instead of parsing `text` again. When omitted, this parses once on
 *   its own — still a single parse for tree+stats, just not shared with
 *   the status bar's validity check.
 */
function refreshDerivedPanels(parseResult) {
  const text = editor.getContent();
  const resolvedParse = parseResult ?? parseDocument(text);
  rightPanel.renderTree(text, resolvedParse);
  rightPanel.renderStats(text, resolvedParse);
  rightPanel.renderQuery(() => editor.getContent());
  rightPanel.renderConvert(() => editor.getContent());
  if (state.diffMode && secondaryEditor) {
    rightPanel.renderDiff(text, secondaryEditor.getContent());
  }
}

/**
 * The expensive part of reacting to an edit: parse the document once,
 * update validity/byte size/parse time in the status bar, and refresh
 * the derived panels from that single parse. Debounced (see
 * `debouncedComputeDerivedState` below) so a burst of keystrokes on a
 * large document parses once per pause rather than once per keystroke.
 */
function computeDerivedState() {
  const text = editor.getContent();
  const { result: parseResult, elapsed } = runTiming(() => parseDocument(text));
  statusBar.setValid(parseResult.valid, parseResult.valid ? '' : parseResult.error.message);
  statusBar.setByteSize(utf8ByteLength(text));
  statusBar.setParseTime(elapsed);
  refreshDerivedPanels(parseResult);
}

const debouncedComputeDerivedState = debounce(computeDerivedState, DERIVED_REFRESH_DEBOUNCE_MS);
const debouncedRefreshSecondaryPanels = debounce(
  () => refreshDerivedPanels(),
  DERIVED_REFRESH_DEBOUNCE_MS
);

/**
 * Called by the editor only for a paste that would replace the whole
 * document. Returns the processed text (validate, repair, sort, format
 * with the current indent) or null to keep the default paste, so the
 * user's pasted text is never lost.
 * @param {string} text
 * @returns {string | null}
 */
function handlePaste(text) {
  const result = processPastedJson(text, { indent: state.indent });
  if (!result.ok) {
    toast.showToast(PASTE_FAILURE_MESSAGE, 'error');
    return null;
  }
  toast.showToast(describePasteSuccess(result.steps), 'success');
  return result.text;
}

function onEditorChange() {
  // Cursor tracking is cheap and users notice lag here immediately, so
  // it stays outside the debounce — only the expensive validate/stats/
  // tree/parse-time work below is throttled.
  const cursor = editor.getCursorPosition();
  statusBar.setCursor(cursor.line, cursor.column);
  debouncedComputeDerivedState();
}

document.getElementById('editor').addEventListener('keyup', () => {
  const cursor = editor.getCursorPosition();
  statusBar.setCursor(cursor.line, cursor.column);
});
document.getElementById('editor').addEventListener('click', () => {
  const cursor = editor.getCursorPosition();
  statusBar.setCursor(cursor.line, cursor.column);
});

/**
 * Run `fn`; on success, clear any stale error toast left over from a
 * previous failed attempt, on failure show a new error toast.
 *
 * NOT used by `validate` below. BUG CONTEXT: `validate`'s callback already
 * shows its own success/error toast and never throws (both branches return
 * normally). If it went through this helper, the `dismissToastsByVariant`
 * call would run immediately after `fn()` in the same synchronous tick,
 * wiping the toast `fn()` had just shown before a frame was ever painted
 * — Validate would look like it did nothing. `validate` uses `runTool()`
 * instead, which never auto-clears; the handler owns its own feedback.
 */
function withToastOnError(fn) {
  try {
    fn();
    toast.dismissToastsByVariant('error');
  } catch (err) {
    toast.showToast(err.message ?? String(err), 'error');
  }
}

/**
 * Run `fn`, only surfacing a toast if it throws. For handlers that already
 * produce their own success/error feedback (see withToastOnError's comment
 * above for why `validate` must not go through the auto-clearing helper).
 */
function runTool(fn) {
  try {
    fn();
  } catch (err) {
    toast.showToast(err.message ?? String(err), 'error');
  }
}

// `editor.setContent(...)` triggers CodeMirror's docChanged listener
// synchronously (inside `dispatch`), which schedules the debounced
// derived-state refresh. These are discrete, deliberate actions (not a
// burst of keystrokes), so the user expects to see fresh valid/byte
// size/tree/stats state immediately rather than racing the 250ms timer.
function setEditorContentAndFlush(text) {
  editor.setContent(text);
  debouncedComputeDerivedState.flush();
}

// Success-only confirmation: a brief accent glow on the primary editor.
function flashPrimaryEditor() {
  flashEditor(document.getElementById('editor'));
}

/**
 * Turn a `computeMinifySaving` result into the Minify success toast text.
 * Purely presentational (wording only) — the arithmetic it reads from
 * lives in `computeMinifySaving`, unit-tested in jsonUtils.test.js.
 * @param {ReturnType<typeof computeMinifySaving>} saving
 * @returns {string}
 */
function describeMinifySaving(saving) {
  if (saving.beforeBytes === 0) {
    return 'Minified: nothing to save (empty document).';
  }
  if (!saving.shrank) {
    return `Minified: already as small as it gets (${formatBytes(saving.beforeBytes)}).`;
  }
  return `Minified: ${formatBytes(saving.beforeBytes)} → ${formatBytes(saving.afterBytes)} (${saving.savedPercent.toFixed(1)}% smaller)`;
}

/**
 * Turn a `computeFormatGrowth` result into the Format success toast text.
 * Mirrors `describeMinifySaving` for the opposite (growing) direction.
 * Purely presentational — the arithmetic it reads from lives in
 * `computeFormatGrowth`, unit-tested in jsonUtils.test.js.
 * @param {ReturnType<typeof computeFormatGrowth>} growth
 * @returns {string}
 */
function describeFormatGrowth(growth) {
  if (growth.beforeBytes === 0) {
    return 'Formatted: nothing to format (empty document).';
  }
  if (!growth.grew) {
    return `Formatted: already at ${formatBytes(growth.beforeBytes)} (no size change).`;
  }
  return `Formatted: ${formatBytes(growth.beforeBytes)} → ${formatBytes(growth.afterBytes)} (${growth.grownPercent.toFixed(1)}% larger)`;
}

const handlers = {
  format: () =>
    withToastOnError(() => {
      const beforeBytes = utf8ByteLength(editor.getContent());
      const formatted = formatJson(editor.getContent(), { indent: state.indent });
      setEditorContentAndFlush(formatted);
      flashPrimaryEditor();
      const afterBytes = utf8ByteLength(formatted);
      const growth = computeFormatGrowth(beforeBytes, afterBytes);
      toast.showToast(describeFormatGrowth(growth), 'success');
    }),
  minify: () =>
    withToastOnError(() => {
      const beforeBytes = utf8ByteLength(editor.getContent());
      const minified = minifyJson(editor.getContent());
      setEditorContentAndFlush(minified);
      flashPrimaryEditor();
      const afterBytes = utf8ByteLength(minified);
      const saving = computeMinifySaving(beforeBytes, afterBytes);
      toast.showToast(describeMinifySaving(saving), 'success');
    }),
  validate: () =>
    runTool(() => {
      const result = validateJson(editor.getContent());
      if (result.valid) {
        toast.showToast('Valid JSON', 'success');
      } else {
        const { line, column, message } = result.error;
        toast.showToast(`Line ${line}, Col ${column}: ${message}`, 'error');
        editor.goToLineColumn(line, column);
      }
    }),
  repair: () =>
    withToastOnError(() => {
      setEditorContentAndFlush(repairJson(editor.getContent()));
      flashPrimaryEditor();
    }),
  sortKeys: () =>
    withToastOnError(() => {
      const parsed = JSON.parse(editor.getContent());
      const sorted = sortKeysDeep(parsed);
      setEditorContentAndFlush(
        JSON.stringify(sorted, null, state.indent === 'tab' ? '\t' : state.indent)
      );
      flashPrimaryEditor();
    }),
  escape: () =>
    withToastOnError(() => {
      setEditorContentAndFlush(escapeString(editor.getContent()));
      flashPrimaryEditor();
    }),
  unescape: () =>
    withToastOnError(() => {
      setEditorContentAndFlush(unescapeString(editor.getContent()));
      flashPrimaryEditor();
    }),
  diffToggle: () => {
    state.diffMode = !state.diffMode;
    const container = document.getElementById('diff-secondary-container');
    container.hidden = !state.diffMode;
    if (state.diffMode && !secondaryEditor) {
      secondaryEditor = createEditor(document.getElementById('editor-secondary'), {
        doc: '',
        theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
        onChange: () => debouncedRefreshSecondaryPanels(),
      });
    }
    // Toggling diff mode is a discrete toolbar action, not a keystroke
    // burst: reflect it immediately rather than through the debounce.
    refreshDerivedPanels();
  },
  indentChange: (value) => {
    state.indent = value;
  },
  themeToggle: () => {
    const next = toggleTheme();
    editor.setTheme(next);
    secondaryEditor?.setTheme(next);
  },
  save: async () => {
    const text = editor.getContent();
    if (state.currentPath) {
      try {
        await tauriInvoke('write_json_file', { path: state.currentPath, contents: text });
        toast.showToast('Saved.', 'success');
      } catch (err) {
        toast.showToast(`Save failed: ${err}`, 'error');
      }
      return;
    }
    if (isTauriRuntime()) {
      await saveAsNative(text);
      return;
    }
    // Degraded browser-only fallback (e.g. `vite dev` opened in a plain
    // tab): there is no real save target, so make a downloaded copy and
    // say so explicitly rather than silently pretending this saved.
    downloadAsFile(text, 'untitled.json');
    toast.showToast('Tauri unavailable — downloaded a copy instead of saving in place.', 'info');
  },
  open: () => (isTauriRuntime() ? openFileNative() : openFileFallback()),
  saveAs: async () => {
    const text = editor.getContent();
    if (isTauriRuntime()) {
      await saveAsNative(text);
      return;
    }
    downloadAsFile(text, 'untitled.json');
    toast.showToast('Tauri unavailable — downloaded a copy instead of saving in place.', 'info');
  },
};

/**
 * Ask the user for a destination path via the native Save As dialog,
 * write to it, and adopt it as the current file on success. Silently
 * does nothing if the user cancels the dialog.
 * @param {string} text
 */
async function saveAsNative(text) {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: 'untitled.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    await tauriInvoke('write_json_file', { path, contents: text });
    state.currentPath = path;
    updateFileName(path);
    toast.showToast('Saved.', 'success');
  } catch (err) {
    toast.showToast(`Save failed: ${err}`, 'error');
  }
}

/**
 * Open a native file picker restricted to .json files and load the
 * selection through the existing `loadFileFromDisk` path. Silently
 * does nothing if the user cancels the dialog.
 */
async function openFileNative() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected) return;
    await loadFileFromDisk(selected);
  } catch (err) {
    toast.showToast(`Could not open file: ${err}`, 'error');
  }
}

function downloadAsFile(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Browser-only fallback for Open when Tauri is unavailable. There is
 * no way to get a real file system path from a plain `<input type=file>`,
 * so this can never be a real save target — `state.currentPath` stays
 * null.
 */
function openFileFallback() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEditorContentAndFlush(String(reader.result ?? ''));
      state.currentPath = null;
      updateFileName(null);
      toast.dismissToastsByVariant('error');
    };
    reader.readAsText(file);
  });
  input.click();
}

/**
 * @param {string} path
 * @returns {Promise<boolean>} whether the file was opened (a failure has
 *   already surfaced its own error toast).
 */
async function loadFileFromDisk(path) {
  try {
    const contents = await tauriInvoke('read_json_file', { path });
    setEditorContentAndFlush(contents);
    state.currentPath = path;
    updateFileName(path);
    sidebar.setActive(path.split(/[\\/]/).pop());
    toast.dismissToastsByVariant('error');
    return true;
  } catch (err) {
    toast.showToast(`Could not open ${path}: ${err}`, 'error');
    return false;
  }
}

async function loadDirectory(dirPath) {
  try {
    const files = await tauriInvoke('scan_dir_for_json', { path: dirPath });
    state.currentDir = dirPath;
    sidebar.setFiles(files);
  } catch (err) {
    toast.showToast(`Could not scan folder ${dirPath}: ${err}`, 'error');
  }
}

document.getElementById('copy-btn').addEventListener('click', async () => {
  const text = editor.getContent();
  if (!isCopyable(text)) {
    toast.showToast('Nothing to copy', 'info');
    return;
  }
  if (await copyText(text)) {
    toast.showToast('Copied to clipboard', 'success');
  } else {
    toast.showToast('Could not copy to clipboard.', 'error');
  }
});

createToolbar(document.getElementById('toolbar'), handlers);

function wireCollapse(panelId, buttonId, label) {
  const panel = document.getElementById(panelId);
  const button = document.getElementById(buttonId);
  const header = button.parentElement;
  // A collapsed panel is a slim rail: clicking anywhere on it expands it.
  const toggle = () => {
    const next = panel.classList.toggle('collapsed');
    const state = collapseToggleState(next, label);
    button.title = state.title;
    button.setAttribute('aria-expanded', state.ariaExpanded);
  };
  header.addEventListener('click', (event) => {
    const collapsed = panel.classList.contains('collapsed');
    if (shouldToggleOnHeaderClick(collapsed, !!event.target.closest('button'))) toggle();
  });
  return toggle;
}
const toggleSidebar = wireCollapse('sidebar', 'sidebar-collapse', 'Files');
const toggleRightPanel = wireCollapse('right-panel', 'right-panel-collapse', 'Tools');

const dropzoneOverlay = document.createElement('div');
dropzoneOverlay.className = 'dropzone-overlay';
dropzoneOverlay.textContent = 'Drop a .json file to open it';
document.body.appendChild(dropzoneOverlay);

initDragAndDrop(dropzoneOverlay, (path, contents) => {
  if (path) {
    loadFileFromDisk(path);
  } else if (contents !== null) {
    setEditorContentAndFlush(contents);
    state.currentPath = null;
    updateFileName(null);
    toast.dismissToastsByVariant('error');
  }
});

// Keyboard shortcuts
const shortcutActions = {
  ...handlers,
  toggleSidebar,
  toggleRightPanel,
};
window.addEventListener('keydown', (e) => {
  // CodeMirror handles its own keys (Mod+F search, undo/redo, fold, ...) first
  // and marks them handled; never run an app shortcut on top of those.
  if (e.defaultPrevented) return;
  const action = matchShortcut(e);
  if (!action || !shortcutActions[action]) return;
  // Swallow the browser default even on auto-repeat, but only run once.
  e.preventDefault();
  if (shouldFireShortcut(e)) shortcutActions[action]();
});

// Startup payload: CLI-launched file/dir, or a second-instance re-invoke.
async function handleStartupPayload(payload) {
  if (!payload || payload.kind === 'none') return;
  if (payload.kind === 'file') {
    await loadFileFromDisk(payload.path);
  } else if (payload.kind === 'dir') {
    await loadDirectory(payload.path);
  }
}

(async () => {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen('startup-payload', (event) => handleStartupPayload(event.payload));
    const initial = await tauriInvoke('get_startup_payload').catch(() => null);
    if (initial) await handleStartupPayload(initial);
  } catch {
    // Not running inside Tauri (e.g. `vite dev` preview in a browser).
  }
})();

refreshDerivedPanels();
