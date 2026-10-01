import { clampMenuPosition } from './menuState.js';

/**
 * Build the toolbar "Plugins" button and its popover: one row per plugin with
 * a switch. The popover is attached to <body> with fixed positioning because
 * the toolbar scrolls horizontally and would otherwise clip it. The plugin
 * state is owned by the caller; this is thin DOM glue (the state rules are in
 * plugins.js, unit tested).
 *
 * Keyboard: Enter/Space toggle the focused switch (native button behaviour),
 * Escape closes and returns focus to the button, Tab leaves the popover and
 * closes it. A click outside closes it.
 * @param {{
 *   plugins: ReadonlyArray<{ id: string, label: string, description: string, requiresDesktop?: boolean }>,
 *   isEnabled: (id: string) => boolean,
 *   isAvailable: (id: string) => boolean,
 *   onToggle: (id: string, on: boolean) => void,
 * }} config
 * @returns {{ element: HTMLButtonElement, refresh: () => void }}
 */
export function createPluginsMenu({ plugins, isEnabled, isAvailable, onToggle }) {
  const popoverId = 'plugins-popover';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool-btn';
  button.textContent = 'Plugins';
  button.title = 'Turn optional plugins on or off';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', popoverId);

  const popover = document.createElement('div');
  popover.id = popoverId;
  popover.className = 'plugins-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Plugins');
  popover.tabIndex = -1;
  popover.hidden = true;

  const rows = plugins.map((plugin) => {
    const row = document.createElement('div');
    row.className = 'plugins-row';

    const text = document.createElement('div');
    text.className = 'plugins-row__text';
    const label = document.createElement('div');
    label.className = 'plugins-row__label';
    label.id = `plugin-${plugin.id}-label`;
    label.textContent = plugin.label;
    const description = document.createElement('div');
    description.className = 'plugins-row__desc';
    description.id = `plugin-${plugin.id}-desc`;
    description.textContent = plugin.description;
    const note = document.createElement('div');
    note.className = 'plugins-row__note';
    note.id = `plugin-${plugin.id}-note`;
    note.textContent = 'Needs the desktop app.';
    text.append(label, description, note);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'switch';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-labelledby', label.id);
    toggle.appendChild(Object.assign(document.createElement('span'), { className: 'switch__knob' }));
    toggle.addEventListener('click', () => {
      onToggle(plugin.id, !isEnabled(plugin.id));
      refresh();
    });

    row.append(text, toggle);
    popover.appendChild(row);
    return { plugin, toggle, description, note };
  });
  document.body.appendChild(popover);

  function refresh() {
    for (const { plugin, toggle, description, note } of rows) {
      const available = isAvailable(plugin.id);
      toggle.setAttribute('aria-checked', String(available && isEnabled(plugin.id)));
      toggle.disabled = !available;
      note.hidden = available;
      toggle.setAttribute(
        'aria-describedby',
        available ? description.id : `${description.id} ${note.id}`
      );
    }
  }

  let open = false;

  function position() {
    const rect = button.getBoundingClientRect();
    const { left, top } = clampMenuPosition({
      left: rect.left,
      top: rect.bottom + 4,
      menuWidth: popover.offsetWidth,
      menuHeight: popover.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function setOpen(next, { returnFocus = false } = {}) {
    if (open === next) return;
    open = next;
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      refresh();
      position();
      const firstEnabled = rows.find(({ toggle }) => !toggle.disabled);
      (firstEnabled?.toggle ?? popover).focus();
    } else if (returnFocus) {
      button.focus();
    }
  }

  button.addEventListener('click', () => setOpen(!open, { returnFocus: true }));
  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false, { returnFocus: true });
    } else if (event.key === 'Tab') {
      // Focus continues from the button, so Tab moves on to the next toolbar
      // control (Shift+Tab to the previous one) instead of into a closed popover.
      setOpen(false, { returnFocus: true });
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (open && !popover.contains(event.target) && !button.contains(event.target)) {
      setOpen(false);
    }
  });
  window.addEventListener('resize', () => setOpen(false));
  window.addEventListener('blur', () => setOpen(false));

  refresh();
  return { element: button, refresh };
}
