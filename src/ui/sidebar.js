/**
 * Render the sidebar file list.
 * @param {HTMLElement} container
 * @param {(name: string) => void} onSelect
 */
export function createSidebar(container, onSelect) {
  let currentFiles = [];
  let activeName = null;

  function render() {
    container.innerHTML = '';
    if (currentFiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sidebar__item';
      empty.style.color = 'var(--color-text-dim)';
      empty.style.cursor = 'default';
      empty.textContent = 'No folder loaded';
      container.appendChild(empty);
      return;
    }
    for (const file of currentFiles) {
      const item = document.createElement('div');
      item.className = 'sidebar__item';
      if (file.name === activeName) item.classList.add('active');
      item.title = file.name;

      const nameEl = document.createElement('span');
      nameEl.textContent = file.name;
      const metaEl = document.createElement('span');
      metaEl.className = 'sidebar__item-meta';
      metaEl.textContent = formatMeta(file);

      item.appendChild(nameEl);
      item.appendChild(metaEl);
      item.addEventListener('click', () => {
        activeName = file.name;
        onSelect(file.name);
        render();
      });
      container.appendChild(item);
    }
  }

  function formatMeta(file) {
    const kb = file.size ? `${Math.max(1, Math.round(file.size / 1024))} KB` : '';
    return kb;
  }

  return {
    setFiles(files) {
      currentFiles = files ?? [];
      render();
    },
    setActive(name) {
      activeName = name;
      render();
    },
  };
}
