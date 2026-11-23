import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memo } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { TEST_IDS } from '@/lib/testIds';
import { setFabAlignment } from '../../lib/fabAlignment';
import { NavContext, initialNavState, type NavContextValue } from '../NavContext';
import { ResponsiveActions, ResponsiveActionsProvider, NavbarActions } from '../ResponsiveActions';

let isMobile = true;
let originalMatchMedia: typeof window.matchMedia;

function installMobileMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: isMobile,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeAll(() => {
  originalMatchMedia = window.matchMedia;
  installMobileMatchMedia();
});

afterAll(() => {
  window.matchMedia = originalMatchMedia;
});
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
  beforeEach(() => {
    installMobileMatchMedia();
  });
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
  beforeEach(() => {
    installMobileMatchMedia();
  });
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
    // Stack top→bottom: sheet, buttons (search + primary), ⋮ at the corner.
    expect(dock.lastElementChild).toBe(trigger);
    // Closed sheet stays mounted and hidden without exposing role="dialog" (WW-087).
    expect(dock.querySelector('[role="dialog"]')).toBeNull();
    const sheetId = trigger.getAttribute('aria-controls');
    expect(sheetId).toBeTruthy();
    const sheet = document.getElementById(sheetId!);
    expect(sheet).not.toBeNull();
    expect(sheet!.hidden).toBe(true);
    const searchFab = screen.getByTestId('search-fab');
    const buttonsContainer = searchFab.parentElement!;
    expect([...dock.children].indexOf(sheet!)).toBeLessThan([...dock.children].indexOf(buttonsContainer));
    expect([...dock.children].indexOf(buttonsContainer)).toBeLessThan([...dock.children].indexOf(trigger));

    // Opening the overflow trigger exposes the sheet as a dialog above the button stack and ⋮.
    fireEvent.click(trigger);
    const openSheet = dock.querySelector<HTMLElement>('[role="dialog"]');
    expect(openSheet).toBe(sheet);
    expect(openSheet!.hidden).toBe(false);
    expect(openSheet!.getAttribute('aria-modal')).toBe('true');
    expect([...dock.children].indexOf(openSheet!)).toBeLessThan([...dock.children].indexOf(buttonsContainer));
    expect([...dock.children].indexOf(openSheet!)).toBeLessThan([...dock.children].indexOf(trigger));
  });
});

describe('ResponsiveActions mobile fixed thumb dock', () => {
  beforeEach(() => {
    installMobileMatchMedia();
    setFabAlignment('right');
  });
  afterEach(() => {
    cleanup();
    setFabAlignment('right');
  });

  it('pins the thumb dock fixed to the corner with --thumb-dock-lift and honors fabAlignment', () => {
    render(
      <Shell>
        <ResponsiveActions fallback label="Page options">
          <button>Download</button>
        </ResponsiveActions>
      </Shell>,
    );

    const dock = screen.getByTestId('actions-dock');
    expect(dock.className).toContain('fixed');
    expect(dock.className).toContain('z-40');
    expect(dock.className).toContain('lg:hidden');
    expect(dock.className).toContain('w-auto');
    expect(dock.className).toContain('right-4');
    expect(dock.className).toContain('items-end');
    expect(dock.className).not.toContain('relative');
    expect(dock.className).not.toContain('mt-4');
    expect(dock.className).not.toContain('w-full');
    expect(dock.getAttribute('style')).toContain('--thumb-dock-lift');
    expect(dock.getAttribute('style')).toContain('safe-area-inset-bottom');

    act(() => {
      setFabAlignment('left');
    });
    expect(dock.className).toContain('left-4');
    expect(dock.className).toContain('items-start');
    expect(dock.className).not.toContain('right-4');
  });

  it('orders the overflow sheet above primary/search/trigger and caps sheet height with --thumb-dock-lift', () => {
    render(
      <Shell>
        <ResponsiveActions primary={<button type="button">New Note</button>} label="Note actions">
          <button type="button">Duplicate</button>
        </ResponsiveActions>
      </Shell>,
    );

    const dock = screen.getByTestId('actions-dock');
    const trigger = screen.getByTestId('actions-overflow');
    const sheetId = trigger.getAttribute('aria-controls')!;
    const sheet = document.getElementById(sheetId)!;
    const searchFab = screen.getByTestId('search-fab');
    const primaryBtn = screen.getByRole('button', { name: 'New Note' });
    const buttonsCluster = searchFab.parentElement!;

    expect(buttonsCluster.contains(primaryBtn)).toBe(true);
    const children = [...dock.children];
    expect(children.indexOf(sheet)).toBeLessThan(children.indexOf(buttonsCluster));
    expect(children.indexOf(buttonsCluster)).toBeLessThan(children.indexOf(trigger));
    expect(dock.lastElementChild).toBe(trigger);

    fireEvent.click(trigger);
    expect(sheet.hidden).toBe(false);
    expect(sheet.getAttribute('style')).toContain('8rem');
    expect(sheet.getAttribute('style')).toContain('--thumb-dock-lift');
  });

  it('auto-yields (invisible pointer-events-none) and closes sheet when mobile-wheel-composer or mobile-typing-bar mounts', async () => {
    function Harness({ showWheel, showTyping }: { showWheel?: boolean; showTyping?: boolean }) {
      return (
        <Shell>
          <ResponsiveActions fallback label="Page options">
            <button type="button">Download</button>
          </ResponsiveActions>
          {showWheel && <div data-testid="mobile-wheel-composer">Wheel</div>}
          {showTyping && <div data-testid="mobile-typing-bar">Typing</div>}
        </Shell>
      );
    }

    const { rerender } = render(<Harness />);
    const dock = screen.getByTestId('actions-dock');
    const trigger = screen.getByTestId('actions-overflow');

    expect(dock.className).not.toContain('invisible');
    expect(dock.className).not.toContain('pointer-events-none');

    fireEvent.click(trigger);
    const sheet = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(sheet.hidden).toBe(false);

    rerender(<Harness showWheel />);
    await waitFor(() => {
      expect(dock.className).toContain('invisible');
      expect(dock.className).toContain('pointer-events-none');
      expect(sheet.hidden).toBe(true);
    });

    rerender(<Harness />);
    await waitFor(() => {
      expect(dock.className).not.toContain('invisible');
      expect(dock.className).not.toContain('pointer-events-none');
    });

    rerender(<Harness showTyping />);
    await waitFor(() => {
      expect(dock.className).toContain('invisible');
      expect(dock.className).toContain('pointer-events-none');
    });
  });

  it('auto-yields when results-mobile-bar is visible in the DOM', async () => {
    function Harness({ showResultsBar, hidden }: { showResultsBar: boolean; hidden?: boolean }) {
      return (
        <Shell>
          <ResponsiveActions fallback label="Page options">
            <button type="button">Download</button>
          </ResponsiveActions>
          {showResultsBar && (
            <div data-testid="results-mobile-bar" hidden={hidden}>
              Results Bar
            </div>
          )}
        </Shell>
      );
    }

    const { rerender } = render(<Harness showResultsBar={false} />);
    const dock = screen.getByTestId('actions-dock');
    expect(dock.className).not.toContain('invisible');

    rerender(<Harness showResultsBar={true} />);
    await waitFor(() => {
      expect(dock.className).toContain('invisible');
      expect(dock.className).toContain('pointer-events-none');
    });

    rerender(<Harness showResultsBar={true} hidden />);
    await waitFor(() => {
      expect(dock.className).not.toContain('invisible');
    });
  });

  it('auto-yields when a visible .cm-frontmatter-preview input geometrically intersects the dock footprint', async () => {
    let inputRect: DOMRect = new DOMRect(200, 680, 140, 36);
    const dockRect: DOMRect = new DOMRect(300, 660, 56, 120);

    const origInnerHeight = window.innerHeight;
    const origInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });

    try {
      render(
        <Shell>
          <ResponsiveActions fallback label="Page options">
            <button type="button">Download</button>
          </ResponsiveActions>
          <div className="cm-frontmatter-preview">
            <input aria-label="Value for metrics.met" defaultValue="5" />
          </div>
        </Shell>,
      );

      const dock = screen.getByTestId('actions-dock');
      const input = document.querySelector<HTMLInputElement>('.cm-frontmatter-preview input')!;
      dock.getBoundingClientRect = () => dockRect;
      input.getBoundingClientRect = () => inputRect;
      input.focus();

      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      await waitFor(() => {
        expect(dock.className).toContain('invisible');
        expect(dock.className).toContain('pointer-events-none');
      });

      // Scroll input above the dock footprint (no longer intersecting)
      inputRect = new DOMRect(200, 100, 140, 36);
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      await waitFor(() => {
        expect(dock.className).not.toContain('invisible');
        expect(dock.className).not.toContain('pointer-events-none');
      });
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: origInnerHeight });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: origInnerWidth });
    }
  });

  it('unifies detail/board SecondaryNav L3 lazily inside the mobile dock sheet with honest Done/Reset and yields on peek', async () => {
    const onRun = mock(() => {});
    const onReset = mock(() => {});
    const baseNav = (over: Partial<NavContextValue> = {}): NavContextValue => ({
      tree: [],
      navState: initialNavState,
      dispatch: () => {},
      peekTarget: null,
      openPeek: () => {},
      closePeek: () => {},
      l3Items: [{ id: 'intro', label: 'Intro', level: 3, action: { type: 'scroll', sectionId: 'intro' } }],
      setL3Items: () => {},
      l3Connections: [
        {
          kind: 'section',
          id: 'efforts',
          label: 'Efforts',
          entries: [{ kind: 'link', id: 'fran', label: 'Fran', to: '/effort/fran' }],
        },
      ],
      setL3Connections: () => {},
      l3Actions: [{ id: 'run', label: 'Run Workout', group: 'primary', onRun }],
      setL3Actions: () => {},
      analyticsControls: { weeks: 8, onWeeksChange: () => {}, onReset },
      setAnalyticsControls: () => {},
      secondarySpec: undefined,
      setSecondarySpec: () => {},
      streamControls: null,
      setStreamControls: () => {},
      scrollToSection: () => {},
      registerScrollFn: () => {},
      openCreateJournal: () => {},
      registerCreateJournal: () => {},
      setContextNav: () => {},
      ...over,
    });

    function L3Harness({ peekActive = false }: { peekActive?: boolean }) {
      const target = peekActive ? ({ kind: 'effort', slug: 'fran', label: 'Fran' } as const) : null;
      return (
        <MemoryRouter initialEntries={['/note/1']}>
          <NuqsAdapter>
            <NavContext.Provider
              value={baseNav({
                navState: { ...initialNavState, inspectorDrawerOpen: peekActive, peekTarget: target },
                peekTarget: target,
              })}
            >
              <ResponsiveActionsProvider onSearch={() => {}}>
                <div>Note</div>
              </ResponsiveActionsProvider>
            </NavContext.Provider>
          </NuqsAdapter>
        </MemoryRouter>
      );
    }

    const { rerender } = render(<L3Harness />);

    // Overflow trigger appears because L3 has content; SecondaryNav is NOT mounted while closed
    const trigger = screen.getByTestId(TEST_IDS.ACTIONS_OVERFLOW);
    expect(screen.queryByTestId(TEST_IDS.ACTIONS_SHEET_L3)).toBeNull();

    // Opening the bottom sheet mounts SecondaryNav ONCE with honest Done & Reset controls
    fireEvent.click(trigger);
    const l3Sheet = screen.getByTestId(TEST_IDS.ACTIONS_SHEET_L3);
    expect(within(l3Sheet).getByText('On this page')).toBeTruthy();
    expect(within(l3Sheet).getByTestId(TEST_IDS.L3_CONNECTIONS)).toBeTruthy();
    expect(within(l3Sheet).getByTestId(TEST_IDS.L3_ACTIONS_PRIMARY)).toBeTruthy();

    fireEvent.click(screen.getByTestId(TEST_IDS.L3_DRAWER_RESET_BTN));
    expect(onReset).toHaveBeenCalledTimes(1);

    fireEvent.click(within(l3Sheet).getByRole('button', { name: 'Run Workout' }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(TEST_IDS.ACTIONS_SHEET_L3)).toBeNull();

    // Auto-yields when a mobile peek drawer is active
    rerender(<L3Harness peekActive />);
    const dock = screen.getByTestId(TEST_IDS.ACTIONS_DOCK);
    await waitFor(() => {
      expect(dock.className).toContain('invisible');
      expect(dock.className).toContain('pointer-events-none');
    });
  });
});
