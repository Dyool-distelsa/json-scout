import { el, button } from './dom.js';
import { openModal } from './modal.js';
import { unifiedDiff, hunkHeader } from './unifiedDiff.js';

const KIND_TEXT = {
  modified: 'Modified',
  added: 'Added (not in the last commit)',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New file, not tracked by git',
  conflict: 'Merge conflict',
};

const SIGN_CLASS = { '+': 'add', '-': 'del', ' ': 'ctx' };

/**
 * Single-line (minified) JSON would diff as one changed line: when both sides
 * are valid JSON and either is on one line, compare them formatted instead.
 * @returns {{ base: string, working: string, formatted: boolean }}
 */
function comparableTexts(baseText, workingText) {
  const oneLine = (text) => text.trim() !== '' && !text.trim().includes('\n');
  if (!oneLine(baseText) && !oneLine(workingText)) return { base: baseText, working: workingText, formatted: false };
  try {
    const pretty = (text) => (text.trim() === '' ? '' : JSON.stringify(JSON.parse(text), null, 2));
    return { base: pretty(baseText), working: pretty(workingText), formatted: true };
  } catch {
    return { base: baseText, working: workingText, formatted: false };
  }
}

function diffTable(hunks) {
  const table = el('table', 'git-diff');
  const body = el('tbody');
  for (const hunk of hunks) {
    const header = el('tr', 'git-diff__hunk');
    const cell = el('td', undefined, hunkHeader(hunk));
    cell.colSpan = 4;
    header.appendChild(cell);
    body.appendChild(header);
    for (const line of hunk.lines) {
      const row = el('tr', `git-diff__line git-diff__line--${SIGN_CLASS[line.type]}`);
      row.append(
        el('td', 'git-diff__num', line.oldLine === null ? '' : String(line.oldLine)),
        el('td', 'git-diff__num', line.newLine === null ? '' : String(line.newLine)),
        el('td', 'git-diff__sign', line.type),
        el('td', 'git-diff__text', line.text)
      );
      body.appendChild(row);
    }
  }
  table.appendChild(body);
  return table;
}

/**
 * What changed in a file since the last commit, as `git diff` shows it.
 * @param {{
 *   change: { relative: string, path: string, kind: string },
 *   baseText: string, the committed text ('' when the file is not in HEAD)
 *   workingText: string, the text on disk ('' for a deleted file)
 *   onOpen?: () => void, opens the file; offered unless it was deleted
 * }} options
 */
export function openChangeDiffDialog({ change, baseText, workingText, onOpen }) {
  const modal = openModal({ title: change.relative });
  modal.dialog.classList.add('modal--panel', 'change-diff');

  const { base, working, formatted } = comparableTexts(baseText, workingText);
  const { hunks, added, removed } = unifiedDiff(base, working);
  const meta = el('p', 'change-diff__kind', KIND_TEXT[change.kind] ?? change.kind);
  meta.append(
    ' ',
    el('span', 'change-diff__stat change-diff__stat--add', `+${added}`),
    ' ',
    el('span', 'change-diff__stat change-diff__stat--del', `−${removed}`)
  );
  if (formatted) meta.append(' · formatted to compare');
  modal.body.appendChild(meta);
  modal.body.appendChild(
    hunks.length > 0 ? diffTable(hunks) : el('p', 'change-diff__empty', 'No line changes.')
  );

  const close = button('Close', onOpen && change.kind !== 'deleted' ? '' : 'primary', () => modal.close());
  if (onOpen && change.kind !== 'deleted') {
    const open = button('Open file', 'primary', () => {
      modal.close();
      onOpen();
    });
    modal.footer.append(close, open);
    modal.focus(open);
  } else {
    modal.footer.append(close);
    modal.focus(close);
  }
  return modal;
}
