import { el, button } from './dom.js';
import { openModal } from './modal.js';
import { environmentOf } from './environmentIndicator.js';

/**
 * The row of open documents above the editor. Purely a view: it renders a
 * `TabsState` (see tabs.js) and reports clicks.
 * @param {HTMLElement} container
 * @param {{
 *   onActivate: (id: string) => void,
 *   onClose: (id: string) => void,
 *   onNew: () => void,
 *   onContextMenu?: (id: string, event: MouseEvent) => void,
 * }} handlers
 * @returns {{ render: (state: import('./tabs.js').TabsState, compareId?: string|null) => void }}
 *   `compareId` marks the tab shown in the compare pane (Diff mode).
 */
export const TAB_DRAG_TYPE = 'application/x-json-scout-tab';
const stripMoves = new WeakMap();

export function createTabStrip(container, { onActivate, onClose, onNew, onContextMenu, onMove, onSplit, onJoin, onMoveOther }) {
  container.replaceChildren();
  const list = el('div', 'doc-tabs__list');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Open documents');
  const add = button('+', 'doc-tabs__new', () => onNew());
  add.title = 'New document';
  add.setAttribute('aria-label', 'New document');
  container.append(list, add);
  if (onSplit) {
    const split = button('◫', 'doc-tabs__new', onSplit);
    split.title = 'Split editor — move active tab to the other group';
    split.setAttribute('aria-label', 'Split editor');
    container.append(split);
  }
  if (onMoveOther) {
    const move = button('⇄', 'doc-tabs__new', onMoveOther);
    move.title = 'Move active tab to the other group';
    move.setAttribute('aria-label', 'Move tab to other group');
    container.append(move);
  }
  if (onJoin) {
    const join = button('⊟', 'doc-tabs__new', onJoin);
    join.title = 'Join editor groups';
    join.setAttribute('aria-label', 'Join editor groups');
    container.append(join);
  }
  let renderedTabs = [];
  if (onMove) {
    stripMoves.set(container, onMove);
    container.addEventListener('dragover', (event) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes(TAB_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      container.classList.add('doc-tabs--drop');
    });
    container.addEventListener('dragleave', (event) => {
      if (!container.contains(event.relatedTarget)) container.classList.remove('doc-tabs--drop');
    });
    container.addEventListener('drop', (event) => {
      container.classList.remove('doc-tabs--drop');
      const id = event.dataTransfer?.getData(TAB_DRAG_TYPE);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.target.closest?.('[role="tab"]');
      onMove(id, target?.dataset.id ?? null);
    });
  }

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    if (event.altKey && event.shiftKey && onMove) {
      const target = index + step;
      if (target < 0 || target >= tabs.length) return;
      onMove(tabs[index].dataset.id, step < 0 ? renderedTabs[target].id : renderedTabs[target + 1]?.id ?? null);
      list.querySelector(`[data-id="${tabs[index].dataset.id}"]`)?.focus();
      return;
    }
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onActivate(next.dataset.id);
    list.querySelector(`[data-id="${next.dataset.id}"]`)?.focus();
  });

  function render(state, compareId = null) {
    renderedTabs = state.tabs;
    list.replaceChildren(
      ...state.tabs.map((tab) => {
        const selected = tab.id === state.activeId;
        const node = el('div', 'doc-tab');
        node.dataset.id = tab.id;
        if (onMove) {
          node.draggable = true;
          let suppressClick = false;
          let pointerActive = false;
          node.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.target.closest('button')) return;
            const startX = event.clientX, startY = event.clientY;
            let dragging = false, highlighted = null;
            pointerActive = true;
            const move = (e) => {
              if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
              dragging = true;
              const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.doc-tabs');
              if (highlighted !== target) highlighted?.classList.remove('doc-tabs--drop');
              highlighted = target && stripMoves.has(target) ? target : null;
              highlighted?.classList.add('doc-tabs--drop');
              e.preventDefault();
            };
            const finish = (e) => {
              document.removeEventListener('pointermove', move);
              document.removeEventListener('pointerup', finish);
              document.removeEventListener('pointercancel', finish);
              pointerActive = false;
              highlighted?.classList.remove('doc-tabs--drop');
              if (dragging) {
                suppressClick = true;
                const hit = document.elementFromPoint(e.clientX, e.clientY);
                const target = hit?.closest('.doc-tabs');
                if (e.type === 'pointerup' && target && stripMoves.has(target)) {
                  stripMoves.get(target)(tab.id, hit.closest('[role="tab"]')?.dataset.id ?? null);
                }
                setTimeout(() => { suppressClick = false; }, 0);
              }
            };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', finish);
            document.addEventListener('pointercancel', finish);
          });
          node.addEventListener('click', (event) => { if (suppressClick) { event.stopImmediatePropagation(); event.preventDefault(); } }, true);
          node.addEventListener('dragstart', (event) => {
            if (pointerActive) { event.preventDefault(); return; }
            if (!event.dataTransfer) return;
            event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
            event.dataTransfer.effectAllowed = 'move';
          });
          node.addEventListener('dragend', () => container.classList.remove('doc-tabs--drop'));
        }
        node.setAttribute('role', 'tab');
        node.setAttribute('aria-selected', String(selected));
        node.tabIndex = selected ? 0 : -1;
        const compared = tab.id === compareId;
        node.title = `${tab.path ?? `${tab.title} (not saved yet)`}${compared ? ' — shown in the compare pane' : ''}`;
        node.classList.toggle('doc-tab--active', selected);
        node.classList.toggle('doc-tab--compare', compared);
        node.classList.toggle('doc-tab--dirty', tab.dirty);
        const label = el('span', 'doc-tab__title', tab.title);
        if (tab.fromVault) {
          const environment = tab.vaultName ? environmentOf(tab.vaultName) : 'unknown';
          node.dataset.vaultEnvironment = environment;
          node.title += ` — Vault: ${tab.vaultName ?? 'unknown'} (${environment.toUpperCase()})`;
          const origin = el('span', 'doc-tab__environment', environment.toUpperCase());
          origin.setAttribute('aria-label', `Vault environment: ${environment.toUpperCase()}`);
          node.append(origin);
        }
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
        if (onContextMenu) {
          node.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            onContextMenu(tab.id, event);
          });
        }
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
