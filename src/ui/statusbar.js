import { formatBytes } from '../tools/jsonUtils.js';

/**
 * Build and control the bottom status bar:
 * valid/invalid indicator, cursor line:col, byte size, parse time.
 * @param {HTMLElement} container
 */
export function createStatusBar(container) {
  container.innerHTML = '';

  const fileName = document.createElement('div');
  fileName.className = 'statusbar__filename';
  fileName.textContent = 'Untitled';

  const indicator = document.createElement('div');
  indicator.className = 'statusbar__indicator';
  const dot = document.createElement('span');
  dot.className = 'statusbar__dot';
  const indicatorLabel = document.createElement('span');
  indicatorLabel.textContent = 'Valid';
  indicator.appendChild(dot);
  indicator.appendChild(indicatorLabel);

  const cursor = document.createElement('div');
  cursor.textContent = 'Ln 1, Col 1';

  const size = document.createElement('div');
  size.textContent = '0 B';

  const parseTime = document.createElement('div');
  parseTime.textContent = '';

  container.appendChild(fileName);
  container.appendChild(indicator);
  container.appendChild(cursor);
  container.appendChild(size);
  container.appendChild(parseTime);

  // Tracks the last-rendered valid/name state purely so the transient
  // "flip" animation only plays on an actual change, not on every
  // debounced re-check that happens to land on the same result.
  let previousValid = true;
  let previousFileName = fileName.textContent;

  return {
    setValid(valid, message = '') {
      const changed = valid !== previousValid;
      previousValid = valid;
      dot.classList.toggle('invalid', !valid);
      indicatorLabel.textContent = valid ? 'Valid' : `Invalid${message ? `: ${message}` : ''}`;
      if (changed) {
        dot.classList.remove('statusbar__dot--flip');
        void dot.offsetWidth; // restart the animation even if it's still running
        dot.classList.add('statusbar__dot--flip');
      }
    },
    setCursor(line, column) {
      cursor.textContent = `Ln ${line}, Col ${column}`;
    },
    setByteSize(bytes) {
      size.textContent = formatBytes(bytes);
    },
    setParseTime(ms) {
      parseTime.textContent = `${ms.toFixed(1)} ms`;
    },
    setFileName(name) {
      const resolved = name || 'Untitled';
      const changed = resolved !== previousFileName;
      previousFileName = resolved;
      fileName.textContent = resolved;
      if (changed) {
        fileName.classList.remove('statusbar__filename--flip');
        void fileName.offsetWidth;
        fileName.classList.add('statusbar__filename--flip');
      }
    },
  };
}
