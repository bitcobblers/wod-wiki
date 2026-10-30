import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { memo } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ResponsiveActions, ResponsiveActionsProvider, NavbarActions } from '../ResponsiveActions';

let isMobile = true;
mock.module('../../hooks/useIsMobile', () => ({
  useIsMobile: () => isMobile,
}));

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ResponsiveActionsProvider onSearch={() => {}}>
        {/* NavbarActions mirrors its real mount point beside the cast button. */}
        <div data-testid="app-navbar">
          <NavbarActions />
        </div>
        {children}
      </ResponsiveActionsProvider>
    </MemoryRouter>
  );
}

describe('ResponsiveActions navbar slot', () => {
  afterEach(() => {
    cleanup();
    isMobile = true;
  });

  it('pins the navbar action beside the cast button on mobile instead of the dock', () => {
    render(
      <Shell>
        <ResponsiveActions navbar={<button>Edit</button>} />
      </Shell>,
    );

    const navbar = screen.getByTestId('app-navbar');
    expect(navbar.querySelector('button')?.textContent).toBe('Edit');
    // The dock never receives it: no other Edit button mounts anywhere else.
    expect(screen.getAllByText('Edit')).toHaveLength(1);
  });

  it('renders the navbar action inline in the page header on desktop', () => {
    isMobile = false;
    render(
      <Shell>
        <ResponsiveActions navbar={<button>Edit</button>} />
      </Shell>,
    );

    // Desktop navbar target renders nothing (registrations are mobile-only);
    // the action shows inline in the page's own actions row instead.
    expect(screen.getByTestId('app-navbar').querySelector('button')).toBeNull();
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('surfaces the most recent page registration when several are mounted', () => {
    render(
      <Shell>
        <ResponsiveActions navbar={<button>First</button>} />
        <ResponsiveActions navbar={<button>Second</button>} />
      </Shell>,
    );

    const navbar = screen.getByTestId('app-navbar');
    expect(navbar.textContent).toBe('Second');
  });

  it('preserves registration order when an earlier registration updates its content', () => {
    const Child = memo(() => <ResponsiveActions navbar={<button>Modal Child</button>} />);
    function TestComponent({ parentLabel }: { parentLabel: string }) {
      return (
        <Shell>
          <ResponsiveActions navbar={<button>{parentLabel}</button>} />
          <Child />
        </Shell>
      );
    }

    const { rerender } = render(<TestComponent parentLabel="Parent v1" />);
    const navbar = screen.getByTestId('app-navbar');
    expect(navbar.textContent).toBe('Modal Child');

    // Updating parent content must not bump parent to the end of registrations array
    rerender(<TestComponent parentLabel="Parent v2" />);
    expect(navbar.textContent).toBe('Modal Child');
  });

  it('renders nothing when the active page pins no navbar action', () => {
    render(
      <Shell>
        <ResponsiveActions navbar={<button>Edit</button>} />
        <ResponsiveActions />
      </Shell>,
    );

    expect(screen.getByTestId('app-navbar').textContent).toBe('');
  });
});

describe('ResponsiveActions dock trigger', () => {
  afterEach(() => {
    cleanup();
  });

  it('hides the ⋮ when the sheet has no rows; when rows exist, ⋮ sits last with the sheet above it', () => {
    const { rerender } = render(
      <Shell>
        {/* Children that render nothing (e.g. mobile-suppressed page bars):
            the sheet would be empty, so the ⋮ must not appear at all —
            matching the sticky header's ⋮. */}
        <ResponsiveActions>{false}</ResponsiveActions>
        <ResponsiveActions fallback label="Page options" />
      </Shell>,
    );
    expect(screen.queryByTestId('actions-overflow')).toBeNull();

    rerender(
      <Shell>
        <ResponsiveActions fallback label="Page options">
          <button>Download</button>
        </ResponsiveActions>
      </Shell>,
    );

    const trigger = screen.getByTestId('actions-overflow');
    const dock = trigger.closest('[data-testid="actions-dock"]')!;
    // Stack top→bottom: buttons (primary + search), sheet, ⋮ at the corner.
    expect(dock.lastElementChild).toBe(trigger);
    const sheet = dock.querySelector('[role="dialog"]')!;
    expect(sheet).not.toBeNull();
    expect(sheet.hidden).toBe(true);
    expect([...dock.children].indexOf(sheet)).toBeLessThan([...dock.children].indexOf(trigger));
  });
});

describe('ResponsiveActions mobile layout', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the action row in normal document flow instead of positioned overlays', () => {
    render(
      <Shell>
        <ResponsiveActions fallback label="Page options">
          <button>Download</button>
        </ResponsiveActions>
      </Shell>,
    );

    const dock = screen.getByTestId('actions-dock');
    expect(dock.className).toContain('relative');
    expect(dock.className).not.toContain('fixed');
  });
});
