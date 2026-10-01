// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openModal } from './modal.js';

let trigger;
let opened;

beforeEach(() => {
  trigger = document.createElement('button');
  trigger.textContent = 'open';
  document.body.appendChild(trigger);
  trigger.focus();
  opened = [];
});

afterEach(() => {
  for (const modal of [...opened].reverse()) modal.close();
  document.body.replaceChildren();
});

function open(options = {}) {
  const modal = openModal({ title: 'Review', ...options });
  opened.push(modal);
  return modal;
}

function addButtons(modal, ...labels) {
  return labels.map((label) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    modal.footer.appendChild(node);
    return node;
  });
}

const press = (key, options = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  document.activeElement.dispatchEvent(event);
  return event;
};

describe('openModal', () => {
  it('renders an accessible modal dialog named by its title', () => {
    const modal = open({ title: 'Push to Azure' });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy).textContent).toBe('Push to Azure');
    expect(modal.dialog).toBe(dialog);
  });

  it('moves focus into the dialog and keeps it there', () => {
    const modal = open();
    expect(modal.dialog.contains(document.activeElement)).toBe(true);

    trigger.focus(); // something outside grabs focus
    expect(modal.dialog.contains(document.activeElement)).toBe(true);
  });

  it('can focus a specific control when asked', () => {
    const modal = open();
    const [first] = addButtons(modal, 'First');
    modal.focus(first);
    expect(document.activeElement).toBe(first);
  });

  it('wraps Tab from the last control to the first and Shift+Tab the other way', () => {
    const modal = open();
    const [first, second] = addButtons(modal, 'First', 'Second');

    second.focus();
    const forward = press('Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = press('Tab', { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);
  });

  it('lets Tab move normally between controls in the middle', () => {
    const modal = open();
    const [first] = addButtons(modal, 'First', 'Second');
    first.focus();
    expect(press('Tab').defaultPrevented).toBe(false);
  });

  it('keeps Tab inside the dialog when it holds no focusable control', () => {
    const modal = open();
    modal.focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(modal.dialog.contains(document.activeElement)).toBe(true);
  });

  it('skips disabled and hidden controls when trapping focus', () => {
    const modal = open();
    const [first, middle, last] = addButtons(modal, 'First', 'Middle', 'Last');
    last.disabled = true;
    middle.hidden = true;

    first.focus();
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(first); // the only focusable control wraps onto itself
  });

  it('closes on Escape, returns focus to the trigger and reports it once', () => {
    const onClose = vi.fn();
    const modal = open({ onClose });

    const event = press('Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledTimes(1);
    modal.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while the caller says it must not close', () => {
    let busy = true;
    const modal = open({ escapeCloses: () => !busy });

    press('Escape');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    busy = false;
    press('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(modal.isOpen()).toBe(false);
  });

  it('returns focus to an element chosen at close time', () => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    const modal = open({ restoreFocus: () => other });

    modal.close();

    expect(document.activeElement).toBe(other);
  });

  it('does not fail when the element to return to has gone away', () => {
    const gone = document.createElement('button');
    const modal = open({ restoreFocus: () => gone });
    expect(() => modal.close()).not.toThrow();
  });

  it('stops trapping focus and handling keys after it closed', () => {
    const modal = open();
    modal.close();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    const event = press('Tab');
    expect(event.defaultPrevented).toBe(false);
  });

  it('applies the tone as a class for the header colour', () => {
    const modal = open({ tone: 'danger' });
    expect(modal.dialog.classList.contains('modal--danger')).toBe(true);
    modal.setTone('caution');
    expect(modal.dialog.classList.contains('modal--danger')).toBe(false);
    expect(modal.dialog.classList.contains('modal--caution')).toBe(true);
  });

  it('only the top modal reacts to Escape when two are open', () => {
    const lower = open({ title: 'Lower' });
    const upper = open({ title: 'Upper' });

    press('Escape');

    expect(upper.isOpen()).toBe(false);
    expect(lower.isOpen()).toBe(true);
    expect(lower.dialog.contains(document.activeElement)).toBe(true);
  });
});
