/**
 * Pure model for the left sidebar tabs (Files | Vault). DOM wiring lives in
 * main.js; everything here is unit tested in sidebarTabs.test.js.
 */

/** `plugin`: id of the plugin that owns the tab, or null for a built-in tab. */
export const SIDEBAR_TABS = Object.freeze([
  Object.freeze({ id: 'files', label: 'Files', plugin: null }),
  Object.freeze({ id: 'vault', label: 'Vault', plugin: 'vault' }),
]);

const DEFAULT_TAB = 'files';

/**
 * Ids of the tabs to show, in order. A plugin tab appears only while its
 * plugin is active.
 * @param {((pluginId: string) => boolean)|undefined} isPluginActive
 * @returns {string[]}
 */
export function visibleSidebarTabs(isPluginActive) {
  return SIDEBAR_TABS.filter(
    (tab) => tab.plugin === null || (typeof isPluginActive === 'function' && isPluginActive(tab.plugin))
  ).map((tab) => tab.id);
}

/**
 * The tab to show: the requested one when it is visible, otherwise Files.
 * @param {string|undefined} requested
 * @param {string[]} visible
 * @returns {string}
 */
export function resolveSidebarTab(requested, visible) {
  return typeof requested === 'string' && visible.includes(requested) ? requested : DEFAULT_TAB;
}

/**
 * Human name of a tab, used by the collapse button and the collapsed rail.
 * @param {string|undefined} id
 * @returns {string}
 */
export function sidebarTabLabel(id) {
  return SIDEBAR_TABS.find((tab) => tab.id === id)?.label ?? 'Files';
}

/**
 * Tab selected by a tablist navigation key (arrows wrap, Home/End jump).
 * Other keys, or a single visible tab, keep the current one.
 * @param {string} current
 * @param {string[]} visible
 * @param {string} key
 * @returns {string}
 */
export function moveSidebarTab(current, visible, key) {
  const from = visible.indexOf(current);
  if (from === -1) return visible[0] ?? DEFAULT_TAB;
  if (visible.length < 2) return current;
  switch (key) {
    case 'ArrowRight':
      return visible[(from + 1) % visible.length];
    case 'ArrowLeft':
      return visible[(from - 1 + visible.length) % visible.length];
    case 'Home':
      return visible[0];
    case 'End':
      return visible[visible.length - 1];
    default:
      return current;
  }
}
