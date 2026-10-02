// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastQueue, mountToastContainer } from './toast.js';

let container;
let toasts;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  toasts = mountToastContainer(container, { queue: new ToastQueue() });
});

afterEach(() => {
  toasts.destroy();
  vi.useRealTimers();
  document.body.replaceChildren();
});

const nodes = () => [...container.querySelectorAll('.toast')];

describe('toast DOM contract', () => {
  it('appends toasts oldest first, so the newest is the last child (nearest the bottom corner)', () => {
    toasts.showToast('first', 'info');
    toasts.showToast('second', 'success');
    expect(nodes().map((node) => node.querySelector('.toast__message').textContent)).toEqual(['first', 'second']);
  });

  it('keeps every control a button, so the click-through rule can re-enable exactly those', () => {
    toasts.showToast('Saved.', 'success');
    const [toast] = nodes();
    const controls = toast.querySelectorAll('button, a, input, select, textarea, [tabindex]');
    expect(controls).toHaveLength(1);
    expect(controls[0].tagName).toBe('BUTTON');
    expect(controls[0].classList.contains('toast__close')).toBe(true);
    expect(controls[0].getAttribute('type')).toBe('button');
    expect(controls[0].getAttribute('aria-label')).toBe('Dismiss notification');
  });

  it('does not set pointer-events inline, so the stylesheet owns the rule', () => {
    toasts.showToast('Saved.', 'success');
    const [toast] = nodes();
    expect(toast.style.pointerEvents).toBe('');
    expect(container.style.pointerEvents).toBe('');
    expect(toast.querySelector('.toast__close').style.pointerEvents).toBe('');
  });

  it('sequences the exit: the close button starts the fade, and the node leaves the DOM afterwards', () => {
    toasts.showToast('Bye', 'info');
    const [toast] = nodes();
    toast.querySelector('.toast__close').click();
    expect(toast.classList.contains('toast--leaving')).toBe(true);
    expect(toast.isConnected).toBe(true);
    vi.advanceTimersByTime(900);
    expect(toast.isConnected).toBe(false);
  });
});
