/**
 * Toggle metadata for a collapsible side panel.
 * @param {boolean} collapsed Whether the panel is currently collapsed.
 * @param {string} label Human name of the panel, used in the tooltip.
 * @returns {{ title: string, ariaExpanded: 'true'|'false' }}
 */
export function collapseToggleState(collapsed, label) {
  return {
    title: `${collapsed ? 'Expand' : 'Collapse'} ${label}`,
    ariaExpanded: collapsed ? 'false' : 'true',
  };
}

/**
 * Whether a click on a panel header should toggle the panel. A collapsed
 * panel is a slim rail that expands on any click; an expanded one only
 * collapses when the click landed on a button inside the header.
 * @param {boolean} collapsed
 * @param {boolean} onButton Whether the click target is (inside) a button.
 */
export function shouldToggleOnHeaderClick(collapsed, onButton) {
  return collapsed || onButton;
}
