// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSplitters } from './splitters.js';
import { DEFAULT_LAYOUT, LAYOUT_LIMITS, LAYOUT_STORAGE_KEY } from './layout.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: vi.fn((key, value) => {
      data[key] = String(value);
    }),
  };
};

let workspace;
let sidebar;
let rightPanel;
let sidebarSplitter;
let rightSplitter;
let storage;
let windowWidth;
let frames;
let mounted;

function mount({ stored, collapsed = [] } = {}) {
  storage = memoryStorage(stored ? { [LAYOUT_STORAGE_KEY]: JSON.stringify(stored) } : {});
  for (const panel of collapsed) {
    (panel === 'sidebar' ? sidebar : rightPanel).classList.add('collapsed');
  }
  mounted = mountSplitters({
    workspace,
    sidebar,
    rightPanel,
    sidebarSplitter,
    rightSplitter,
    storage,
    getWindowWidth: () => windowWidth,
    scheduleFrame: (fn) => {
      frames.push(fn);
      return frames.length;
    },
    cancelFrame: () => {},
  });
  return mounted;
}

beforeEach(() => {
  document.body.innerHTML = `
    <main class="workspace">
      <aside id="sidebar" class="sidebar"></aside>
      <div id="sidebar-splitter" class="splitter"></div>
      <section class="editor-pane"></section>
      <div id="right-splitter" class="splitter"></div>
      <aside id="right-panel" class="right-panel"></aside>
    </main>`;
  workspace = document.querySelector('.workspace');
  sidebar = document.getElementById('sidebar');
  rightPanel = document.getElementById('right-panel');
  sidebarSplitter = document.getElementById('sidebar-splitter');
  rightSplitter = document.getElementById('right-splitter');
  windowWidth = 1600;
  frames = [];
  mounted = null;
});

afterEach(() => {
  mounted?.destroy();
  document.body.className = '';
  document.body.replaceChildren();
});

const sidebarWidth = () => workspace.style.getPropertyValue('--sidebar-width');
const rightWidth = () => workspace.style.getPropertyValue('--right-panel-width');
const stored = () => JSON.parse(storage.data[LAYOUT_STORAGE_KEY]);

function press(el, key, init = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

function pointer(el, type, clientX, pointerId = 1) {
  const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new Ctor(type, { clientX, pointerId, button: 0, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe('mountSplitters: markup and initial widths', () => {
  it('turns each handle into a focusable, labelled vertical separator', () => {
    mount();
    for (const [el, label, controls] of [
      [sidebarSplitter, 'Resize Files panel', 'sidebar'],
      [rightSplitter, 'Resize Tools panel', 'right-panel'],
    ]) {
      expect(el.getAttribute('role')).toBe('separator');
      expect(el.getAttribute('aria-orientation')).toBe('vertical');
      expect(el.getAttribute('aria-label')).toBe(label);
      expect(el.getAttribute('aria-controls')).toBe(controls);
      expect(el.getAttribute('tabindex')).toBe('0');
    }
  });

  it('publishes the default widths as CSS custom properties and ARIA values', () => {
    mount();
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
    expect(rightWidth()).toBe(`${DEFAULT_LAYOUT.right}px`);
    expect(sidebarSplitter.getAttribute('aria-valuenow')).toBe(String(DEFAULT_LAYOUT.sidebar));
    expect(sidebarSplitter.getAttribute('aria-valuemin')).toBe(String(LAYOUT_LIMITS.sidebar.min));
    expect(sidebarSplitter.getAttribute('aria-valuemax')).toBe(String(LAYOUT_LIMITS.sidebar.max));
    expect(rightSplitter.getAttribute('aria-valuenow')).toBe(String(DEFAULT_LAYOUT.right));
    expect(rightSplitter.getAttribute('aria-valuemin')).toBe(String(LAYOUT_LIMITS.right.min));
    expect(rightSplitter.getAttribute('aria-valuemax')).toBe(String(LAYOUT_LIMITS.right.max));
  });

  it('starts from the stored widths', () => {
    mount({ stored: { sidebar: 260, right: 400 } });
    expect(sidebarWidth()).toBe('260px');
    expect(rightWidth()).toBe('400px');
    expect(rightSplitter.getAttribute('aria-valuenow')).toBe('400');
  });

  it('falls back to the defaults for garbage in storage', () => {
    storage = memoryStorage({ [LAYOUT_STORAGE_KEY]: '}{' });
    mounted = mountSplitters({
      workspace,
      sidebar,
      rightPanel,
      sidebarSplitter,
      rightSplitter,
      storage,
      getWindowWidth: () => windowWidth,
    });
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
  });

  it('does not write to storage just by mounting', () => {
    mount();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('keyboard resizing', () => {
  it('grows the left sidebar by 16px with ArrowRight and updates ARIA and storage', () => {
    mount();
    const event = press(sidebarSplitter, 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar + 16}px`);
    expect(sidebarSplitter.getAttribute('aria-valuenow')).toBe(String(DEFAULT_LAYOUT.sidebar + 16));
    expect(stored()).toEqual({ sidebar: DEFAULT_LAYOUT.sidebar + 16, right: DEFAULT_LAYOUT.right });
  });

  it('shrinks the left sidebar with ArrowLeft', () => {
    mount();
    press(sidebarSplitter, 'ArrowLeft');
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar - 16}px`);
  });

  it('grows the right panel with ArrowLeft (direction aware)', () => {
    mount();
    press(rightSplitter, 'ArrowLeft');
    expect(rightWidth()).toBe(`${DEFAULT_LAYOUT.right + 16}px`);
    expect(rightSplitter.getAttribute('aria-valuenow')).toBe(String(DEFAULT_LAYOUT.right + 16));
    press(rightSplitter, 'ArrowRight');
    press(rightSplitter, 'ArrowRight');
    expect(rightWidth()).toBe(`${DEFAULT_LAYOUT.right - 16}px`);
  });

  it('steps 64px with Shift', () => {
    mount();
    press(sidebarSplitter, 'ArrowRight', { shiftKey: true });
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar + 64}px`);
  });

  it('jumps to the limits with Home and End', () => {
    mount();
    press(sidebarSplitter, 'End');
    expect(sidebarWidth()).toBe(`${LAYOUT_LIMITS.sidebar.max}px`);
    press(sidebarSplitter, 'Home');
    expect(sidebarWidth()).toBe(`${LAYOUT_LIMITS.sidebar.min}px`);
    press(rightSplitter, 'End');
    expect(rightWidth()).toBe(`${LAYOUT_LIMITS.right.max}px`);
    press(rightSplitter, 'Home');
    expect(rightWidth()).toBe(`${LAYOUT_LIMITS.right.min}px`);
  });

  it('stops at the maximum', () => {
    mount({ stored: { sidebar: LAYOUT_LIMITS.sidebar.max - 4, right: 320 } });
    press(sidebarSplitter, 'ArrowRight');
    expect(sidebarWidth()).toBe(`${LAYOUT_LIMITS.sidebar.max}px`);
  });

  it('keeps the editor at its minimum width in a small window', () => {
    windowWidth = 900;
    mount({ stored: { sidebar: 220, right: 320 } });
    press(sidebarSplitter, 'End');
    expect(sidebarWidth()).toBe(`${900 - LAYOUT_LIMITS.editorMin - 320}px`);
    expect(sidebarSplitter.getAttribute('aria-valuemax')).toBe(String(900 - LAYOUT_LIMITS.editorMin - 320));
  });

  it('ignores keys it does not handle, and shortcuts with a modifier', () => {
    mount();
    const arrowUp = press(sidebarSplitter, 'ArrowUp');
    const tab = press(sidebarSplitter, 'Tab');
    const ctrlArrow = press(sidebarSplitter, 'ArrowRight', { ctrlKey: true });
    expect(arrowUp.defaultPrevented).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
    expect(ctrlArrow.defaultPrevented).toBe(false);
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('double-click reset', () => {
  it('restores the default width of that panel only, and persists it', () => {
    mount({ stored: { sidebar: 300, right: 420 } });
    sidebarSplitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
    expect(rightWidth()).toBe('420px');
    expect(sidebarSplitter.getAttribute('aria-valuenow')).toBe(String(DEFAULT_LAYOUT.sidebar));
    expect(stored()).toEqual({ sidebar: DEFAULT_LAYOUT.sidebar, right: 420 });

    rightSplitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(rightWidth()).toBe(`${DEFAULT_LAYOUT.right}px`);
    expect(stored()).toEqual(DEFAULT_LAYOUT);
  });
});

describe('pointer dragging', () => {
  it('follows the pointer, captures it and marks the body while dragging', () => {
    mount();
    sidebarSplitter.setPointerCapture = vi.fn();
    pointer(sidebarSplitter, 'pointerdown', 400);
    expect(sidebarSplitter.setPointerCapture).toHaveBeenCalledWith(1);
    expect(document.body.classList.contains('is-resizing')).toBe(true);
    expect(sidebarSplitter.classList.contains('splitter--active')).toBe(true);

    pointer(sidebarSplitter, 'pointermove', 460);
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar + 60}px`);
    expect(sidebarSplitter.getAttribute('aria-valuenow')).toBe(String(DEFAULT_LAYOUT.sidebar + 60));
    // Nothing is persisted mid-drag.
    expect(storage.setItem).not.toHaveBeenCalled();

    pointer(sidebarSplitter, 'pointerup', 460);
    expect(document.body.classList.contains('is-resizing')).toBe(false);
    expect(sidebarSplitter.classList.contains('splitter--active')).toBe(false);
    expect(stored().sidebar).toBe(DEFAULT_LAYOUT.sidebar + 60);
  });

  it('moves the right panel the opposite way: dragging left grows it', () => {
    mount();
    pointer(rightSplitter, 'pointerdown', 1000);
    pointer(rightSplitter, 'pointermove', 950);
    expect(rightWidth()).toBe(`${DEFAULT_LAYOUT.right + 50}px`);
    pointer(rightSplitter, 'pointermove', 1020);
    expect(rightWidth()).toBe(`${DEFAULT_LAYOUT.right - 20}px`);
    pointer(rightSplitter, 'pointerup', 1020);
    expect(stored().right).toBe(DEFAULT_LAYOUT.right - 20);
  });

  it('measures from where the drag started, not from the last move', () => {
    mount();
    pointer(sidebarSplitter, 'pointerdown', 100);
    pointer(sidebarSplitter, 'pointermove', 130);
    pointer(sidebarSplitter, 'pointermove', 110);
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar + 10}px`);
  });

  it('clamps to the panel limits while dragging', () => {
    mount();
    pointer(sidebarSplitter, 'pointerdown', 100);
    pointer(sidebarSplitter, 'pointermove', 5000);
    expect(sidebarWidth()).toBe(`${LAYOUT_LIMITS.sidebar.max}px`);
    pointer(sidebarSplitter, 'pointermove', -5000);
    expect(sidebarWidth()).toBe(`${LAYOUT_LIMITS.sidebar.min}px`);
  });

  it('never squeezes the editor below its minimum', () => {
    windowWidth = 900;
    mount({ stored: { sidebar: 220, right: 320 } });
    pointer(sidebarSplitter, 'pointerdown', 100);
    pointer(sidebarSplitter, 'pointermove', 700);
    expect(sidebarWidth()).toBe(`${900 - LAYOUT_LIMITS.editorMin - 320}px`);
    expect(rightWidth()).toBe('320px');
  });

  it('ignores movement when no drag is in progress, and other pointers', () => {
    mount();
    pointer(sidebarSplitter, 'pointermove', 500);
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
    pointer(sidebarSplitter, 'pointerdown', 100, 1);
    pointer(sidebarSplitter, 'pointermove', 160, 2);
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
  });

  it('ends the drag on cancel and does not persist an unmoved pointer', () => {
    mount();
    pointer(sidebarSplitter, 'pointerdown', 100);
    pointer(sidebarSplitter, 'pointercancel', 100);
    expect(document.body.classList.contains('is-resizing')).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('ignores a secondary mouse button', () => {
    mount();
    const event = new MouseEvent('pointerdown', { clientX: 100, button: 2, bubbles: true, cancelable: true });
    sidebarSplitter.dispatchEvent(event);
    expect(document.body.classList.contains('is-resizing')).toBe(false);
  });
});

describe('collapse interplay', () => {
  it('hides and disables the splitter of a collapsed panel', () => {
    const splitters = mount();
    sidebar.classList.add('collapsed');
    splitters.sync();
    expect(sidebarSplitter.getAttribute('aria-disabled')).toBe('true');
    expect(sidebarSplitter.hidden).toBe(true);
    expect(sidebarSplitter.getAttribute('tabindex')).toBe('-1');
    // The other splitter is untouched.
    expect(rightSplitter.hasAttribute('aria-disabled')).toBe(false);
    expect(rightSplitter.hidden).toBe(false);
  });

  it('starts disabled when the panel is already collapsed at mount', () => {
    mount({ collapsed: ['right'] });
    expect(rightSplitter.getAttribute('aria-disabled')).toBe('true');
    expect(rightSplitter.hidden).toBe(true);
  });

  it('does not react to keys or pointers while collapsed', () => {
    const splitters = mount();
    rightPanel.classList.add('collapsed');
    splitters.sync();
    const key = press(rightSplitter, 'ArrowLeft');
    pointer(rightSplitter, 'pointerdown', 100);
    pointer(rightSplitter, 'pointermove', 40);
    rightSplitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(key.defaultPrevented).toBe(false);
    expect(document.body.classList.contains('is-resizing')).toBe(false);
    expect(rightWidth()).toBe(`${DEFAULT_LAYOUT.right}px`);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('restores the last dragged width on expand, not the default', () => {
    const splitters = mount();
    pointer(sidebarSplitter, 'pointerdown', 100);
    pointer(sidebarSplitter, 'pointermove', 180);
    pointer(sidebarSplitter, 'pointerup', 180);
    const dragged = DEFAULT_LAYOUT.sidebar + 80;
    expect(sidebarWidth()).toBe(`${dragged}px`);

    sidebar.classList.add('collapsed');
    splitters.sync();
    // The stored width stays available for the stylesheet while collapsed.
    expect(sidebarWidth()).toBe(`${dragged}px`);

    sidebar.classList.remove('collapsed');
    splitters.sync();
    expect(sidebarWidth()).toBe(`${dragged}px`);
    expect(sidebarSplitter.hidden).toBe(false);
    expect(sidebarSplitter.hasAttribute('aria-disabled')).toBe(false);
    expect(sidebarSplitter.getAttribute('tabindex')).toBe('0');
    expect(sidebarSplitter.getAttribute('aria-valuenow')).toBe(String(dragged));
  });

  it('counts a collapsed neighbour as a slim rail when bounding the open panel', () => {
    windowWidth = 700;
    const splitters = mount({ stored: { sidebar: 220, right: 320 } });
    rightPanel.classList.add('collapsed');
    splitters.sync();
    expect(sidebarSplitter.getAttribute('aria-valuemax')).toBe(
      String(Math.min(LAYOUT_LIMITS.sidebar.max, 700 - LAYOUT_LIMITS.editorMin - LAYOUT_LIMITS.railWidth))
    );
  });
});

describe('window resize', () => {
  it('re-clamps both panels in one throttled frame when the window shrinks', () => {
    mount({ stored: { sidebar: 400, right: 480 } });
    windowWidth = 900;
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(frames).toHaveLength(1);
    // Nothing changes until the frame runs.
    expect(sidebarWidth()).toBe('400px');

    frames.shift()();
    const sidebarNow = parseInt(sidebarWidth(), 10);
    const rightNow = parseInt(rightWidth(), 10);
    expect(sidebarNow + rightNow).toBe(900 - LAYOUT_LIMITS.editorMin);
    expect(sidebarNow).toBeGreaterThanOrEqual(LAYOUT_LIMITS.sidebar.min);
    expect(rightNow).toBeGreaterThanOrEqual(LAYOUT_LIMITS.right.min);
    expect(sidebarSplitter.getAttribute('aria-valuenow')).toBe(String(sidebarNow));
    expect(rightSplitter.getAttribute('aria-valuenow')).toBe(String(rightNow));
  });

  it('schedules a new frame after the previous one ran', () => {
    mount();
    window.dispatchEvent(new Event('resize'));
    frames.shift()();
    window.dispatchEvent(new Event('resize'));
    expect(frames).toHaveLength(1);
  });

  it('does not overwrite the stored layout, and returns to it when the window grows back', () => {
    mount({ stored: { sidebar: 400, right: 480 } });
    windowWidth = 900;
    window.dispatchEvent(new Event('resize'));
    frames.shift()();
    expect(storage.setItem).not.toHaveBeenCalled();

    windowWidth = 1600;
    window.dispatchEvent(new Event('resize'));
    frames.shift()();
    expect(sidebarWidth()).toBe('400px');
    expect(rightWidth()).toBe('480px');
  });
});

describe('preferred widths survive a narrow window', () => {
  const narrowThenWiden = (interact) => {
    mount({ stored: { sidebar: 400, right: 480 } });
    windowWidth = 900;
    window.dispatchEvent(new Event('resize'));
    frames.shift()();
    // Both panels were squeezed to fit.
    expect(parseInt(rightWidth(), 10)).toBeLessThan(480);
    interact();
    windowWidth = 1600;
    window.dispatchEvent(new Event('resize'));
    frames.shift()();
  };

  it('keeps the other panel preferred width after a keyboard resize', () => {
    narrowThenWiden(() => press(sidebarSplitter, 'ArrowLeft'));
    expect(rightWidth()).toBe('480px');
    expect(stored().right).toBe(480);
    expect(parseInt(sidebarWidth(), 10)).toBeLessThan(400);
  });

  it('keeps the other panel preferred width after a drag', () => {
    narrowThenWiden(() => {
      pointer(rightSplitter, 'pointerdown', 700);
      pointer(rightSplitter, 'pointermove', 710);
      pointer(rightSplitter, 'pointerup', 710);
    });
    expect(sidebarWidth()).toBe('400px');
    expect(stored().sidebar).toBe(400);
  });

  it('keeps the other panel preferred width after a double-click reset', () => {
    narrowThenWiden(() => sidebarSplitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
    expect(rightWidth()).toBe('480px');
  });
});

describe('a panel that collapses mid-drag', () => {
  it('ends the drag, releases the pointer and clears the body marker', () => {
    const splitters = mount();
    sidebarSplitter.setPointerCapture = vi.fn();
    sidebarSplitter.releasePointerCapture = vi.fn();
    pointer(sidebarSplitter, 'pointerdown', 100);
    pointer(sidebarSplitter, 'pointermove', 140);
    expect(document.body.classList.contains('is-resizing')).toBe(true);

    sidebar.classList.add('collapsed');
    splitters.sync();

    expect(document.body.classList.contains('is-resizing')).toBe(false);
    expect(sidebarSplitter.classList.contains('splitter--active')).toBe(false);
    expect(sidebarSplitter.releasePointerCapture).toHaveBeenCalledWith(1);
    // What was dragged so far is kept as the width to return to.
    expect(stored().sidebar).toBe(DEFAULT_LAYOUT.sidebar + 40);
  });

  it('ignores pointer movement for the collapsed panel afterwards', () => {
    const splitters = mount();
    pointer(sidebarSplitter, 'pointerdown', 100);
    sidebar.classList.add('collapsed');
    splitters.sync();
    storage.setItem.mockClear();

    pointer(sidebarSplitter, 'pointermove', 300);
    pointer(sidebarSplitter, 'pointerup', 300);
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('ignores a pointermove that arrives for a collapsed panel before sync ran', () => {
    mount();
    pointer(sidebarSplitter, 'pointerdown', 100);
    sidebar.classList.add('collapsed');
    pointer(sidebarSplitter, 'pointermove', 300);
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
  });

  it('does not end the other panel drag when an unrelated panel collapses', () => {
    const splitters = mount();
    pointer(sidebarSplitter, 'pointerdown', 100);
    rightPanel.classList.add('collapsed');
    splitters.sync();
    expect(document.body.classList.contains('is-resizing')).toBe(true);
  });
});

describe('sidebar splitter label', () => {
  it('follows the active sidebar tab', () => {
    const splitters = mount();
    expect(sidebarSplitter.getAttribute('aria-label')).toBe('Resize Files panel');
    splitters.setSidebarLabel('Vault');
    expect(sidebarSplitter.getAttribute('aria-label')).toBe('Resize Vault panel');
    splitters.setSidebarLabel('Files');
    expect(sidebarSplitter.getAttribute('aria-label')).toBe('Resize Files panel');
    // The right-hand handle always resizes the tools.
    expect(rightSplitter.getAttribute('aria-label')).toBe('Resize Tools panel');
  });
});

describe('destroy', () => {
  it('detaches every listener', () => {
    const splitters = mount();
    splitters.destroy();
    press(sidebarSplitter, 'ArrowRight');
    window.dispatchEvent(new Event('resize'));
    expect(sidebarWidth()).toBe(`${DEFAULT_LAYOUT.sidebar}px`);
    expect(frames).toHaveLength(0);
    mounted = null;
  });
});
