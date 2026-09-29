/**
 * Wire up drag-and-drop of a .json file onto the window.
 * Tries the native Tauri webview drag-drop event first (the default in
 * Tauri v2, since OS-level drag-drop is enabled unless explicitly turned
 * off), and falls back to the standard HTML5 DnD events so this also
 * works when previewing the frontend in a plain browser during `vite dev`.
 * @param {HTMLElement} dropzoneOverlay
 * @param {(path: string|null, contents: string|null) => void} onFileDropped
 *        Called with a file system path (Tauri) or null plus the file's
 *        text contents (browser fallback).
 */
export function initDragAndDrop(dropzoneOverlay, onFileDropped) {
  let tauriUnlisten = null;

  (async () => {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      tauriUnlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const { type } = event.payload;
        if (type === 'over' || type === 'enter') {
          dropzoneOverlay.classList.add('active');
        } else if (type === 'drop') {
          dropzoneOverlay.classList.remove('active');
          const paths = event.payload.paths ?? [];
          const jsonPath = paths.find((p) => p.toLowerCase().endsWith('.json'));
          if (jsonPath) onFileDropped(jsonPath, null);
        } else {
          dropzoneOverlay.classList.remove('active');
        }
      });
    } catch {
      // Not running inside a Tauri webview (e.g. plain browser preview);
      // rely on the HTML5 fallback below instead.
    }
  })();

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzoneOverlay.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.target === document.documentElement) {
      dropzoneOverlay.classList.remove('active');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzoneOverlay.classList.remove('active');
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.name.toLowerCase().endsWith('.json'));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onFileDropped(null, String(reader.result ?? ''));
    reader.readAsText(file);
  });

  return {
    destroy: () => tauriUnlisten?.(),
  };
}
