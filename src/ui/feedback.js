export const FLASH_CLASS = 'is-flashing';
export const FLASH_DURATION_MS = 600;

const timers = new WeakMap();

/**
 * Briefly tint the editor to confirm an action succeeded. Toggles a CSS
 * class (the animation lives in main.css) and removes it after
 * FLASH_DURATION_MS; retriggering mid-flash restarts the animation.
 * @param {HTMLElement | null} container
 */
export function flashEditor(container) {
  if (!container) return;
  clearTimeout(timers.get(container));
  container.classList.remove(FLASH_CLASS);
  // Force a reflow so re-adding the class restarts the animation.
  void container.offsetWidth;
  container.classList.add(FLASH_CLASS);
  timers.set(
    container,
    setTimeout(() => container.classList.remove(FLASH_CLASS), FLASH_DURATION_MS)
  );
}
