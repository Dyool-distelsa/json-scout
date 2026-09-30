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
