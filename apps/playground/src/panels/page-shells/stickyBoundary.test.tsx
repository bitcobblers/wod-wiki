import { afterEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useStickyBoundaryOffset } from './stickyBoundary';

function Offset() {
  return <output data-testid="sticky-offset">{useStickyBoundaryOffset(104)}</output>;
}

describe('useStickyBoundaryOffset', () => {
  afterEach(() => cleanup());

  it('tracks content growth inside the sticky boundary', async () => {
    const original = globalThis.ResizeObserver;
    let notify = () => {};
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        constructor(callback: ResizeObserverCallback) {
          notify = () => callback([], this as unknown as ResizeObserver);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
    const boundary = document.createElement('div');
    boundary.dataset.pageStickyBoundary = 'true';
    let bottom = 48;
    boundary.getBoundingClientRect = () => ({ bottom, height: bottom }) as DOMRect;
    document.body.append(boundary);
    try {
      render(<Offset />);
      await waitFor(() => expect(screen.getByTestId('sticky-offset').textContent).toBe('48'));
      bottom = 96;
      act(() => notify());
      await waitFor(() => expect(screen.getByTestId('sticky-offset').textContent).toBe('96'));
    } finally {
      boundary.remove();
      Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: original });
    }
  });
});
