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
  indentLabel.style.fontSize = '11px';
  indentLabel.style.color = 'var(--color-text-dim)';
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
  themeBtn.className = 'tool-btn';
  themeBtn.textContent = 'Theme';
  themeBtn.title = 'Toggle dark/light theme';
  themeBtn.addEventListener('click', () => handlers.themeToggle?.());
  themeGroup.appendChild(themeBtn);
  container.appendChild(themeGroup);

  return { indentSelect };
}
