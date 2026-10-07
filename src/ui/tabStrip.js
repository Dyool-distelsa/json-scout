import { el, button } from './dom.js';
import { openModal } from './modal.js';

/**
 * The row of open documents above the editor. Purely a view: it renders a
 * `TabsState` (see tabs.js) and reports clicks.
 * @param {HTMLElement} container
 * @param {{
 *   onActivate: (id: string) => void,
 *   onClose: (id: string) => void,
 *   onNew: () => void,
 * }} handlers
 * @returns {{ render: (state: import('./tabs.js').TabsState, compareId?: string|null) => void }}
 *   `compareId` marks the tab shown in the compare pane (Diff mode).
 */
export function createTabStrip(container, { onActivate, onClose, onNew }) {
  container.replaceChildren();
  const list = el('div', 'doc-tabs__list');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Open documents');
  const add = button('+', 'doc-tabs__new', () => onNew());
  add.title = 'New document';
  add.setAttribute('aria-label', 'New document');
  container.append(list, add);

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    onActivate(next.dataset.id);
    list.querySelector(`[data-id="${next.dataset.id}"]`)?.focus();
  });

  function render(state, compareId = null) {
    list.replaceChildren(
      ...state.tabs.map((tab) => {
        const selected = tab.id === state.activeId;
        const node = el('div', 'doc-tab');
        node.dataset.id = tab.id;
        node.setAttribute('role', 'tab');
        node.setAttribute('aria-selected', String(selected));
        node.tabIndex = selected ? 0 : -1;
        const compared = tab.id === compareId;
        node.title = `${tab.path ?? `${tab.title} (not saved yet)`}${compared ? ' — shown in the compare pane' : ''}`;
        node.classList.toggle('doc-tab--active', selected);
        node.classList.toggle('doc-tab--compare', compared);
        node.classList.toggle('doc-tab--dirty', tab.dirty);
        const label = el('span', 'doc-tab__title', tab.title);
        const dot = el('span', 'doc-tab__dirty', '●');
        dot.setAttribute('aria-label', 'unsaved changes');
        dot.hidden = !tab.dirty;
        const close = button('×', 'doc-tab__close', (event) => {
          event.stopPropagation();
          onClose(tab.id);
        });
        close.tabIndex = -1;
        close.setAttribute('aria-label', `Close ${tab.title}`);
        if (compared) {
          const badge = el('span', 'doc-tab__compare', 'diff');
          badge.setAttribute('aria-label', 'compared');
          node.append(label, badge, dot, close);
        } else {
          node.append(label, dot, close);
        }
        node.addEventListener('click', () => onActivate(tab.id));
        node.addEventListener('auxclick', (event) => {
          if (event.button === 1) {
            event.preventDefault();
            onClose(tab.id);
          }
        });
        return node;
      })
    );
    list.querySelector('.doc-tab--active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  return { render };
}

/**
 * Ask whether to save a document before closing it.
 * @param {string} title
 * @returns {Promise<'save'|'discard'|'cancel'>}
 */
export function askSaveChanges(title) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (choice) => {
      if (answered) return;
      answered = true;
      resolve(choice);
    };
    const modal = openModal({ title: 'Unsaved changes', onClose: () => answer('cancel') });
    modal.body.appendChild(el('p', undefined, `Save changes to ${title}?`));
    const save = button('Save', 'primary', () => {
      answer('save');
      modal.close();
    });
    const discard = button("Don't save", 'danger', () => {
      answer('discard');
      modal.close();
    });
    const cancel = button('Cancel', '', () => modal.close());
    modal.footer.append(discard, cancel, save);
    modal.focus(save);
  });
}
