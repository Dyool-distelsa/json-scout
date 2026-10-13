import { el, button } from './dom.js';
import { openModal } from './modal.js';
import { changeRows } from './vaultPush.js';
import { changeSection } from './changeView.js';

const KIND_TEXT = {
  modified: 'Modified',
  added: 'Added (not in the last commit)',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New file, not tracked by git',
  conflict: 'Merge conflict',
};

/**
 * What changed in a file since the last commit, listed like the Vault push
 * review but with every value shown.
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
  modal.body.appendChild(el('p', 'change-diff__kind', KIND_TEXT[change.kind] ?? change.kind));
  const sections = el('div', 'push-sections');
  sections.appendChild(changeSection('Changes since the last commit', changeRows('json', baseText, workingText), true));
  modal.body.appendChild(sections);

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
