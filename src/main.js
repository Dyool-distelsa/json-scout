import { initTheme, toggleTheme } from './ui/theme.js';
import { createEditor } from './ui/editor.js';
import { createToolbar } from './ui/toolbar.js';
import { createStatusBar } from './ui/statusbar.js';
import { createSidebar } from './ui/sidebar.js';
import { initRightPanel } from './ui/rightPanel.js';
import { initDragAndDrop } from './ui/dragdrop.js';
import { createSettingsPanel } from './ui/settings.js';
import { createHelpPanel } from './ui/helpPanel.js';
import { createVaultPanel } from './ui/vaultPanel.js';
import { installCloseGuard } from './ui/closeGuard.js';
import { createTabStrip, askSaveChanges } from './ui/tabStrip.js';
import { createDocuments } from './ui/documents.js';
import { createTauriDraftStore, createLocalDraftStore } from './ui/drafts.js';
import { collapseToggleState, shouldToggleOnHeaderClick } from './ui/collapsible.js';
import { matchShortcut, shouldFireShortcut } from './ui/shortcuts.js';
import { flashEditor } from './ui/feedback.js';
import {
  PLUGINS,
  loadPluginState,
  savePluginState,
  setPluginEnabled,
  isPluginEnabled,
  isPluginAvailable,
  isPluginActive,
} from './ui/plugins.js';
import {
  visibleSidebarTabs,
  resolveSidebarTab,
  sidebarTabLabel,
  moveSidebarTab,
} from './ui/sidebarTabs.js';

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
import { mountSplitters } from './ui/splitters.js';
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

// Open documents: one tab per file or Untitled draft. Untitled text is kept
// in a recoverable draft (app data folder) until it is saved somewhere.
const docs = createDocuments({
  editor,
  strip: createTabStrip(document.getElementById('doc-tabs'), {
    onActivate: (id) => docs.activate(id),
    onClose: (id) => docs.requestClose(id),
    onNew: () => docs.newUntitled(),
  }),
  drafts: isTauriRuntime() ? createTauriDraftStore(tauriInvoke) : createLocalDraftStore(pluginStorage()),
  askSave: (tab) => askSaveChanges(tab.title),
  saveActive: () => saveActiveDocument(),
  onActiveChange: onActiveDocumentChange,
  onError: (message) => toast.showToast(message, 'error'),
});

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
createHelpPanel(document.getElementById('panel-help'), {
  isTauri: isTauriRuntime(),
  notify: (msg, kind) => toast.showToast(msg, kind),
});

const vaultPanel = createVaultPanel(document.getElementById('sidebar-vault'), {
  invoke: tauriInvoke,
  // A pull the user asked for always shows the pulled text, even over edits
  // in an open tab (pulling over local edits is confirmed by the panel).
  openFile: (path) => loadFileFromDisk(path, { fromVault: true, replace: true }),
  notify: (msg, kind) => toast.showToast(msg, kind),
  isTauri: isTauriRuntime(),
  // The pulled files are gone: close the tabs that showed them.
  onCleared: () => {
    for (const tab of docs.tabs().filter((t) => t.fromVault)) docs.forceClose(tab.id);
  },
});

// Closing discards the pulled workspace, so ask first when a secret has
// unpushed edits. Independent of the Vault plugin switch: the files exist either way.
if (isTauriRuntime()) {
  installCloseGuard({
    invoke: tauriInvoke,
    getWindow: async () => (await import('@tauri-apps/api/window')).getCurrentWindow(),
    notify: (msg, kind) => toast.showToast(msg, kind),
    // Untitled drafts are kept, not lost; only edited files are asked about.
    getUnsavedFiles: () => docs.unsavedFiles(),
    beforeClose: () => docs.flushDrafts(),
  });
}
window.addEventListener('beforeunload', () => {
  docs.flushDrafts();
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
function updateFileName(path, untitledTitle = 'Untitled') {
  const name = path ? deriveDisplayFileName(path) : untitledTitle;
  document.title = path ? `${name} — JSON Scout` : `JSON Scout — ${untitledTitle}`;
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

/**
 * Another document is shown (or the shown one was renamed by a save):
 * follow it in the title, status bar, sidebar and derived panels.
 * @param {import('./ui/tabs.js').Tab|null} tab
 */
function onActiveDocumentChange(tab) {
  state.currentPath = tab?.path ?? null;
  updateFileName(state.currentPath, tab?.title);
  if (state.currentPath) sidebar.setActive(state.currentPath.split(/[\\/]/).pop());
  const cursor = editor.getCursorPosition();
  statusBar.setCursor(cursor.line, cursor.column);
  computeDerivedState();
}

function onEditorChange() {
  docs.markEdited();
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
  save: () => saveActiveDocument(),
  open: () => (isTauriRuntime() ? openFileNative() : openFileFallback()),
  saveAs: () => saveActiveDocument({ askPath: true }),
  new: () => docs.newUntitled(),
  closeTab: () => docs.requestClose(),
  nextTab: () => docs.cycle(1),
  prevTab: () => docs.cycle(-1),
};

/**
 * Save the active document: in place when it is a file, otherwise (or with
 * `askPath`) through the native Save As dialog. An Untitled document that is
 * saved stops being a draft.
 * @param {{ askPath?: boolean }} [options]
 * @returns {Promise<boolean>} whether it was saved
 */
async function saveActiveDocument({ askPath = false } = {}) {
  const text = editor.getContent();
  if (state.currentPath && !askPath) {
    try {
      await tauriInvoke('write_json_file', { path: state.currentPath, contents: text });
      docs.markSaved(state.currentPath);
      toast.showToast('Saved.', 'success');
      vaultPanel.refreshLocalStates();
      return true;
    } catch (err) {
      toast.showToast(`Save failed: ${err}`, 'error');
      return false;
    }
  }
  if (isTauriRuntime()) return saveAsNative(text);
  // Degraded browser-only fallback (e.g. `vite dev` opened in a plain
  // tab): there is no real save target, so make a downloaded copy and
  // say so explicitly rather than silently pretending this saved.
  downloadAsFile(text, 'untitled.json');
  toast.showToast('Tauri unavailable — downloaded a copy instead of saving in place.', 'info');
  return false;
}

/**
 * Ask the user for a destination path via the native Save As dialog,
 * write to it, and adopt it as the active tab's file on success.
 * Resolves false (without a message) if the user cancels the dialog.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function saveAsNative(text) {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: state.currentPath ?? 'untitled.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return false;
    await tauriInvoke('write_json_file', { path, contents: text });
    docs.markSaved(path);
    toast.showToast('Saved.', 'success');
    vaultPanel.refreshLocalStates();
    return true;
  } catch (err) {
    toast.showToast(`Save failed: ${err}`, 'error');
    return false;
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
      docs.newUntitled(String(reader.result ?? ''));
      toast.dismissToastsByVariant('error');
    };
    reader.readAsText(file);
  });
  input.click();
}

/**
 * Open a file in its own tab (or the tab already showing it).
 * @param {string} path
 * @param {{ fromVault?: boolean, replace?: boolean }} [options] see `docs.openFile`
 * @returns {Promise<boolean>} whether the file was opened (a failure has
 *   already surfaced its own error toast).
 */
async function loadFileFromDisk(path, options = {}) {
  try {
    const contents = await tauriInvoke('read_json_file', { path });
    docs.openFile(path, contents, options);
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

// --- Plugins and the left sidebar tabs (Files | Vault) ---------------------
const pluginEnv = { isTauri: isTauriRuntime() };

function pluginStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Even reading the property can throw when site data is blocked.
    return null;
  }
}

let pluginState = loadPluginState(pluginStorage());
const isActive = (id) => isPluginActive(pluginState, id, pluginEnv);

createToolbar(document.getElementById('toolbar'), handlers, {
  plugins: {
    plugins: PLUGINS,
    isEnabled: (id) => isPluginEnabled(pluginState, id),
    isAvailable: (id) => isPluginAvailable(id, pluginEnv),
    onToggle: onPluginToggle,
  },
});

/**
 * Wire a collapsible side panel. A collapsed panel is a slim rail: clicking
 * anywhere on it expands it; while expanded only its collapse button toggles.
 * `getLabel` names the panel for the tooltip and aria-label, so a panel whose
 * content changes (the sidebar tabs) stays described correctly.
 * @param {string} panelId
 * @param {string} buttonId
 * @param {() => string} getLabel
 * @param {() => void} [onToggle] Called after the panel collapses or expands.
 * @returns {{ sync: () => void, setCollapsed: (collapsed: boolean) => void }}
 */
function wireCollapse(panelId, buttonId, getLabel, onToggle = () => {}) {
  const panel = document.getElementById(panelId);
  const button = document.getElementById(buttonId);
  const header = button.parentElement;
  function sync() {
    const label = getLabel();
    const toggleState = collapseToggleState(panel.classList.contains('collapsed'), label);
    button.title = toggleState.title;
    button.setAttribute('aria-label', `Toggle ${label} panel`);
    button.setAttribute('aria-expanded', toggleState.ariaExpanded);
  }
  // A collapsed panel is a slim rail: clicking anywhere on it expands it.
  function toggle() {
    panel.classList.toggle('collapsed');
    sync();
    onToggle();
  }
  header.addEventListener('click', (event) => {
    const collapsed = panel.classList.contains('collapsed');
    if (shouldToggleOnHeaderClick(collapsed, event.target.closest('button') === button)) toggle();
  });
  return {
    sync,
    toggle,
    setCollapsed(collapsed) {
      panel.classList.toggle('collapsed', collapsed);
      sync();
      onToggle();
    },
  };
}

// Resizable side panels. The splitters publish the widths as CSS custom
// properties and need to hear about collapse changes (a collapsed panel is a
// rail with nothing to resize), so they are mounted before the collapse wiring.
const splitters = mountSplitters({
  workspace: document.querySelector('.workspace'),
  sidebar: document.getElementById('sidebar'),
  rightPanel: document.getElementById('right-panel'),
  sidebarSplitter: document.getElementById('sidebar-splitter'),
  rightSplitter: document.getElementById('right-splitter'),
  storage: pluginStorage(),
});

const sidebarCollapse = wireCollapse('sidebar', 'sidebar-collapse', () => sidebarTabLabel(sidebarTab), splitters.sync);
const rightPanelCollapse = wireCollapse('right-panel', 'right-panel-collapse', () => 'Tools', splitters.sync);
const toggleSidebar = sidebarCollapse.toggle;
const toggleRightPanel = rightPanelCollapse.toggle;

const sidebarTabsEl = document.getElementById('sidebar-tabs');
const sidebarTabButtons = {
  files: document.getElementById('sidebar-tab-files'),
  vault: document.getElementById('sidebar-tab-vault'),
};
const sidebarPanels = {
  files: document.getElementById('sidebar-list'),
  vault: document.getElementById('sidebar-vault'),
};
const sidebarRailLabel = document.getElementById('sidebar-rail-label');
let sidebarTab = 'files';

/**
 * Show one sidebar tab (falling back to Files when it is not available) and
 * keep the tab strip, the panels, the collapse button and the rail caption in
 * step. The vault panel is only active while its tab is shown, so it issues
 * no calls while hidden.
 * @param {string} requested
 * @param {{ focus?: boolean }} [options]
 */
function showSidebarTab(requested, { focus = false } = {}) {
  const visible = visibleSidebarTabs(isActive);
  sidebarTab = resolveSidebarTab(requested, visible);
  for (const [id, tabButton] of Object.entries(sidebarTabButtons)) {
    const shown = visible.includes(id);
    const selected = id === sidebarTab;
    tabButton.hidden = !shown;
    tabButton.classList.toggle('active', selected);
    tabButton.setAttribute('aria-selected', String(selected));
    tabButton.tabIndex = selected ? 0 : -1;
    sidebarPanels[id].hidden = !(shown && selected);
  }
  // With a single tab the strip reads as a plain title.
  sidebarTabsEl.dataset.count = String(visible.length);
  sidebarRailLabel.textContent = sidebarTabLabel(sidebarTab);
  splitters.setSidebarLabel(sidebarTabLabel(sidebarTab));
  sidebarCollapse.sync();
  if (sidebarTab === 'vault') vaultPanel.activate();
  else vaultPanel.deactivate();
  if (focus) sidebarTabButtons[sidebarTab].focus();
}

for (const [id, tabButton] of Object.entries(sidebarTabButtons)) {
  tabButton.addEventListener('click', () => showSidebarTab(id));
}
sidebarTabsEl.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  showSidebarTab(moveSidebarTab(sidebarTab, visibleSidebarTabs(isActive), event.key), { focus: true });
});

/** A plugin switch changed in the Plugins menu. */
function onPluginToggle(id, on) {
  pluginState = setPluginEnabled(pluginState, id, on);
  if (!savePluginState(pluginStorage(), pluginState)) {
    toast.showToast('This setting could not be saved and will reset on restart.', 'info');
  }
  if (id !== 'vault') return;
  if (on) {
    // Make the panel visible: the user just asked for it.
    sidebarCollapse.setCollapsed(false);
    showSidebarTab('vault');
  } else {
    showSidebarTab('files');
  }
}

showSidebarTab('files');

// A pulled file can be edited and saved outside the app too; coming back to the
// window re-reads which secrets have local edits (the panel skips it while hidden).
window.addEventListener('focus', () => vaultPanel.refreshLocalStates());

const dropzoneOverlay = document.createElement('div');
dropzoneOverlay.className = 'dropzone-overlay';
dropzoneOverlay.textContent = 'Drop a .json file to open it';
document.body.appendChild(dropzoneOverlay);

initDragAndDrop(dropzoneOverlay, (path, contents) => {
  if (path) {
    loadFileFromDisk(path);
  } else if (contents !== null) {
    docs.newUntitled(contents);
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

docs.newUntitled();

(async () => {
  // Bring back the Untitled documents of the last run before any file from
  // the command line opens, so they keep their order.
  await docs.restore();
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
