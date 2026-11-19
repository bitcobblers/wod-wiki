import { afterEach, describe, expect, it } from 'bun:test';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { cleanup, render, screen } from '@testing-library/react';
import { FocusedDialog } from './FocusedDialog';
import {
  ResponsiveActions,
  ResponsiveActionsProvider,
} from '../../../app/nav/ResponsiveActions';

const originalMatchMedia = window.matchMedia;

describe('FocusedDialog', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    window.matchMedia = originalMatchMedia;
  });

  it('keeps the minimal variant theme-aware instead of forcing light mode', () => {
    const { container } = render(
      <FocusedDialog title="Workout Review" onClose={() => {}} variant="minimal">
        <div>Review content</div>
      </FocusedDialog>,
    );

    expect(screen.getByText('Workout Review')).toBeDefined();

    const portalRoot = container.ownerDocument.body.querySelector('.fixed.inset-0');
    expect(portalRoot).toBeTruthy();
    expect(portalRoot?.className).toContain('bg-background');
    expect(portalRoot?.className).toContain('text-foreground');
    expect(portalRoot?.className).not.toContain('bg-white');
    expect(portalRoot?.className).not.toContain('text-zinc-950');

    const header = screen.getByText('Workout Review').closest('div');
    expect(header?.className).toContain('bg-muted/10');
    expect(header?.className).not.toContain('bg-zinc-50/50');
  });

  it('WW-087: preserves explicit aria-label="Workout" even when a custom workout title is shown', () => {
    render(
      <FocusedDialog title="Fran" ariaLabel="Workout" onClose={() => {}}>
        <div>Timer body</div>
      </FocusedDialog>,
    );

    const dialog = document.querySelector('[role="dialog"][aria-label="Workout"]');
    expect(dialog).not.toBeNull();
  });

  it('WW-087: does not expose role="dialog" on the hidden ResponsiveActions overflow sheet while closed', () => {
    window.matchMedia = (() =>
      ({
        matches: true,
        media: '(max-width: 1024px)',
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;

    render(
      <ResponsiveActionsProvider>
        <ResponsiveActions>
          <button type="button">Export</button>
        </ResponsiveActions>
      </ResponsiveActionsProvider>,
    );

    expect(document.querySelectorAll('[role="dialog"][aria-label="Page options"]')).toHaveLength(0);
  });
});
