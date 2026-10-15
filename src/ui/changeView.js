import { el } from './dom.js';
import { changeSummary } from './vaultPush.js';

/**
 * The list of changes between two versions of a document, as `changeRows`
 * computes them: key by key for JSON, line by line otherwise. Shared by the
 * Vault push review (values masked until revealed) and the Git changes view
 * (values shown).
 */

const KIND_LABELS = { added: 'added', removed: 'removed', changed: 'changed', moved: 'moved' };

function valueCell(cellData, revealed) {
  const node = el('span', 'push-value');
  if (revealed) {
    node.textContent = cellData?.text ?? '';
    return node;
  }
  node.classList.add('push-value--masked');
  const mask = el('span', undefined, cellData?.masked ?? '');
  mask.setAttribute('aria-hidden', 'true');
  node.append(mask, el('span', 'sr-only', 'hidden value'));
  return node;
}

function changeRow(row, mode, revealed) {
  const item = el('li', `push-row push-row--${row.kind}`);
  item.appendChild(el('code', 'push-row__path', mode === 'lines' ? `line ${row.line}` : row.path));
  item.appendChild(el('span', 'push-row__kind', KIND_LABELS[row.kind] ?? row.kind));
  if (row.before) item.appendChild(valueCell(row.before, revealed));
  if (row.before && row.after) item.appendChild(el('span', 'push-row__arrow', '→'));
  if (row.after) item.appendChild(valueCell(row.after, revealed));
  return item;
}

/**
 * @param {string} title
 * @param {ReturnType<typeof import('./vaultPush.js').changeRows>} change
 * @param {boolean} revealed whether values are shown or masked
 * @returns {HTMLElement}
 */
export function changeSection(title, change, revealed) {
  const section = el('section', 'push-section');
  section.appendChild(el('h3', 'push-section__title', title));
  section.appendChild(el('p', 'push-section__summary', changeSummary(change)));
  if (change.rows.length > 0) {
    const list = el('ul', 'push-rows');
    for (const row of change.rows) list.appendChild(changeRow(row, change.mode, revealed));
    section.appendChild(list);
  }
  if (change.truncated) {
    section.appendChild(
      el('p', 'push-section__more', `${change.total - change.rows.length} more not shown.`)
    );
  }
  return section;
}
