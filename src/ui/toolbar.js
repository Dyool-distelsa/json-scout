import { createDropdownMenu } from './fileMenu.js';

/**
 * Build the main toolbar. `handlers` is a map of action name -> callback,
 * e.g. { format, minify, validate, repair, diffToggle, sortKeys, escape,
 * unescape, save, saveAs, open, themeToggle, indentChange }.
 * @param {HTMLElement} container
 * @param {Record<string, Function>} handlers
 */
export function createToolbar(container, handlers) {
  container.innerHTML = '';

  const groups = [
    {
      buttons: [
        { key: 'format', label: 'Format', title: 'Format (Ctrl+Shift+F)' },
        { key: 'minify', label: 'Minify', title: 'Minify (Ctrl+Shift+M)' },
        { key: 'validate', label: 'Validate', title: 'Validate JSON' },
        { key: 'repair', label: 'Repair', title: 'Repair malformed JSON' },
        { key: 'sortKeys', label: 'Sort Keys', title: 'Sort object keys alphabetically' },
      ],
    },
    {
      buttons: [
        { key: 'escape', label: 'Escape', title: 'Escape the current text as a JSON string' },
        { key: 'unescape', label: 'Unescape', title: 'Unescape a JSON string body' },
      ],
    },
    {
      buttons: [{ key: 'diffToggle', label: 'Diff', title: 'Toggle two-pane compare mode' }],
    },
  ];

  // File menu: Open / Save / Save As live in one dropdown.
  const fileGroup = document.createElement('div');
  fileGroup.className = 'toolbar__group';
  const fileMenu = createDropdownMenu({
    label: 'File',
    title: 'Open and save files',
    items: [
      { key: 'open', label: 'Open', shortcut: 'Ctrl+O' },
      { key: 'save', label: 'Save', shortcut: 'Ctrl+S' },
      { key: 'saveAs', label: 'Save As' },
    ],
    onSelect: (key) => handlers[key]?.(),
  });
  fileGroup.appendChild(fileMenu.element);
  container.appendChild(fileGroup);

  for (const group of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'toolbar__group';
    for (const btn of group.buttons) {
      const el = document.createElement('button');
      el.className = 'tool-btn';
      el.textContent = btn.label;
      el.title = btn.title;
      el.dataset.action = btn.key;
      el.addEventListener('click', () => handlers[btn.key]?.());
      groupEl.appendChild(el);
    }
    container.appendChild(groupEl);
  }

  // Indent selector
  const indentGroup = document.createElement('div');
  indentGroup.className = 'toolbar__group';
  const indentLabel = document.createElement('label');
  indentLabel.className = 'toolbar__label';
  indentLabel.textContent = 'Indent';
  const indentSelect = document.createElement('select');
  indentSelect.title = 'Indent style used by Format';
  for (const [value, label] of [
    ['2', '2 spaces'],
    ['4', '4 spaces'],
    ['tab', 'Tab'],
  ]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    indentSelect.appendChild(opt);
  }
  indentSelect.addEventListener('change', () => {
    const value = indentSelect.value === 'tab' ? 'tab' : Number(indentSelect.value);
    handlers.indentChange?.(value);
  });
  indentGroup.appendChild(indentLabel);
  indentGroup.appendChild(indentSelect);
  container.appendChild(indentGroup);

  const spacer = document.createElement('div');
  spacer.className = 'toolbar__spacer';
  container.appendChild(spacer);

  const themeGroup = document.createElement('div');
  themeGroup.className = 'toolbar__group';
  const themeBtn = document.createElement('button');
  themeBtn.className = 'tool-btn theme-toggle';
  // Both icons are present; CSS shows the one for the mode a click switches to.
  themeBtn.innerHTML =
    '<svg class="icon-sun" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="icon-moon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  themeBtn.title = 'Toggle dark/light theme';
  themeBtn.setAttribute('aria-label', 'Toggle dark/light theme');
  themeBtn.addEventListener('click', () => handlers.themeToggle?.());
  themeGroup.appendChild(themeBtn);
  container.appendChild(themeGroup);

  return { indentSelect };
}
