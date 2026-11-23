import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { SidebarLayout } from '../SidebarLayout';
import { PAGE_SHELL_CONTAINER_CLASS, PAGE_SHELL_CONTENT_SURFACE_CLASS } from '../../panels/page-shells/contentSurface';
import { NavContext, NavProvider, initialNavState, type NavContextValue } from '../../../app/nav/NavContext';
import { NavSidebar } from '../../../app/nav/NavSidebar';
import { appNavTree } from '../../../app/nav/appNavTree';
import { TEST_IDS } from '../../lib/testIds';

function NavigateTo({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>{label}</button>;
}

function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
}

function makeBaseNavContext(over: Partial<NavContextValue> = {}): NavContextValue {
  return {
    tree: [],
    navState: initialNavState,
    dispatch: () => {},
    peekTarget: null,
    openPeek: () => {},
    closePeek: () => {},
    l3Items: [],
    setL3Items: () => {},
    l3Connections: undefined,
    setL3Connections: () => {},
    l3Actions: [],
    setL3Actions: () => {},
    secondarySpec: undefined,
    setSecondarySpec: () => {},
    streamControls: null,
    setStreamControls: () => {},
    analyticsControls: null,
    setAnalyticsControls: () => {},
    scrollToSection: () => {},
    registerScrollFn: () => {},
    openCreateJournal: () => {},
    registerCreateJournal: () => {},
    setContextNav: () => {},
    ...over,
  };
}

/**
 * Asserts the drawer's real close lifecycle — Headless unmounts the dialog
 * after its rAF-driven leave transition, so poll real timers until the dialog
 * leaves the accessibility tree.
 */
async function expectDrawerClosed() {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (!screen.queryByRole('button', { name: 'Close navigation' })) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 25);
    await promise;
  }
  expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull();
}

describe('SidebarLayout 4-role shell & breakpoints', () => {
  const originalMatchMedia = window.matchMedia;

  function mockViewport(opts: { is2xl?: boolean; isMobile?: boolean }) {
    window.matchMedia = ((query: string) => ({
      matches:
        (Boolean(opts.is2xl) && query.includes('1520px')) ||
        (Boolean(opts.isMobile) && query.includes('1023px')),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it('renders content column with xl max-width cap and 2xl release', () => {
    render(
      <MemoryRouter initialEntries={['/pages']}>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    const contentEl = screen.getByText('Content');
    const contentColumn = contentEl.closest('[class*="xl:max-w-"]');
    expect(contentColumn).not.toBeNull();
    expect(contentColumn?.className).toContain('xl:max-w-[984px]');
    expect(contentColumn?.className).toContain('2xl:max-w-none');
  });

  it('renders the home route content column wide (no xl cap)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    const contentEl = screen.getByText('Content');
    const contentColumn = contentEl.closest('[class*="xl:max-w-"]');
    expect(contentColumn).not.toBeNull();
    expect(contentColumn?.className).toContain('xl:max-w-none');
    expect(contentColumn?.className).not.toContain('xl:max-w-[984px]');
    expect(contentColumn?.className).toContain('2xl:max-w-none');
  });

  it('mounts SecondaryNav ONCE per breakpoint: 2xl inline labeled aside vs lg–2xl RightL3Drawer', () => {
    // 2xl+ viewport: inline labeled <aside> mounts SecondaryNav once; drawer is not mounted
    mockViewport({ is2xl: true, isMobile: false });
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/note/1']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={makeBaseNavContext({
              navState: { ...initialNavState, rightDrawerOpen: true },
              l3Actions: [{ id: 'run', label: 'Run Workout', group: 'primary', onRun: () => {} }],
            })}
          >
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<div>Sidebar</div>}
              secondary={[{ kind: 'link', id: 'item-1', label: 'Item 1', to: '/test' }]}
            >
              <div>Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute('aria-label')).toBe('Page outline and actions');
    const classes = aside?.className.split(/\s+/) ?? [];
    expect(classes).toContain('hidden');
    expect(classes).toContain('2xl:flex');
    expect(classes).not.toContain('xl:flex');
    expect(screen.getAllByTestId(TEST_IDS.L3_ACTIONS)).toHaveLength(1);
    expect(screen.queryByTestId(TEST_IDS.L3_RIGHT_DRAWER)).toBeNull();
    unmount();

    // Below 2xl (lg–2xl laptop): inline <aside> is NOT mounted; RightL3Drawer mounts SecondaryNav once
    mockViewport({ is2xl: false, isMobile: false });
    const { container: laptopContainer } = render(
      <MemoryRouter initialEntries={['/note/1']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={makeBaseNavContext({
              navState: { ...initialNavState, rightDrawerOpen: true },
              l3Actions: [{ id: 'run', label: 'Run Workout', group: 'primary', onRun: () => {} }],
            })}
          >
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<div>Sidebar</div>}
              secondary={[{ kind: 'link', id: 'item-1', label: 'Item 1', to: '/test' }]}
            >
              <div>Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    expect(laptopContainer.querySelector('aside')).toBeNull();
    expect(screen.getByTestId(TEST_IDS.L3_RIGHT_DRAWER)).toBeTruthy();
    expect(screen.getAllByTestId(TEST_IDS.L3_ACTIONS)).toHaveLength(1);
  });

  it('keeps resting L3 at 0px (no aside) on streams even at 2xl+ when only legacy streamControls exist', () => {
    mockViewport({ is2xl: true, isMobile: false });
    const { container } = render(
      <MemoryRouter initialEntries={['/journal']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={makeBaseNavContext({
              streamControls: {
                query: ':journal{}',
                onQueryChange: () => {},
                groupDims: [],
                onToggleGroupDim: () => {},
                availableGroupDims: [],
                settings: { level: 'note', layout: 'cards', visibleFields: ['title'] },
                onLayoutChange: () => {},
                onToggleField: () => {},
                level: 'note',
              },
            })}
          >
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Stream</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    expect(container.querySelector('aside')).toBeNull();
    expect(screen.queryByTestId(TEST_IDS.L3_INLINE_RAIL)).toBeNull();
  });

  it('flattens nested <nav> landmarks across desktop AppRail and NavSidebar', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/journal']}>
        <NuqsAdapter>
          <NavProvider tree={appNavTree}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<NavSidebar />}>
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    expect(container.querySelectorAll('nav nav')).toHaveLength(0);
    const navs = Array.from(container.querySelectorAll('nav'));
    expect(navs.length).toBeGreaterThanOrEqual(2);
    for (const navEl of navs) {
      expect(navEl.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('owns the width measure in the layout column, leaving the shell card uncapped', () => {
    expect(PAGE_SHELL_CONTAINER_CLASS).not.toContain('max-w-[984px]');
    expect(PAGE_SHELL_CONTAINER_CLASS).not.toContain('3xl:max-w');
    expect(PAGE_SHELL_CONTENT_SURFACE_CLASS).toContain('bg-background');
  });

  it('removes placebo DrawerApplyFooter from MobileSidebar and removes top-right Open page options trigger', () => {
    mockViewport({ is2xl: false, isMobile: true });
    render(
      <MemoryRouter initialEntries={['/pages']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={makeBaseNavContext({
              tree: appNavTree,
              l3Items: [{ id: 'sec-1', label: 'Overview', level: 3, action: { type: 'scroll', sectionId: 'sec-1' } }],
            })}
          >
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    // Top-right "Open page options" trigger is gone from mobile header
    expect(screen.queryByRole('button', { name: 'Open page options' })).toBeNull();
    // Mobile L3 access lives in the thumb dock overflow trigger instead
    expect(screen.getByTestId(TEST_IDS.ACTIONS_OVERFLOW)).toBeTruthy();

    openDrawer();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(screen.queryByTestId(TEST_IDS.DRAWER_APPLY_BTN)).toBeNull();
  });

  it('keeps the drawer open across route navigation (explicit close only)', () => {
    render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<NavigateTo to="/elsewhere" label="Go" />}
            >
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    openDrawer();
    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeTruthy();
    const drawerFrame = document.querySelector<HTMLElement>('.bg-card.h-full');
    expect(drawerFrame).not.toBeNull();
    fireEvent.click(within(drawerFrame!).getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeTruthy();
  });

  it('closes the drawer when the rail Settings flow navigates via the close seam', async () => {
    render(
      <MemoryRouter initialEntries={['/library']}>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    openDrawer();
    const drawerFrame = document.querySelector<HTMLElement>('.bg-card.h-full');
    expect(drawerFrame).not.toBeNull();
    fireEvent.click(within(drawerFrame!).getByTestId('nav-settings'));
    await expectDrawerClosed();
  });

  it('hides only the desktop L2 column when hideDesktopSidebar is set; the drawer keeps the sidebar', () => {
    render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<div>L2 Sidebar</div>}
              hideDesktopSidebar
            >
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    const desktopColumn = document.querySelector('[data-shell-nav="desktop"] div[class*="w-60"]');
    expect(desktopColumn?.className).toContain('lg:hidden');
    openDrawer();
    const drawerFrame = document.querySelector<HTMLElement>('.bg-card.h-full');
    expect(within(drawerFrame!).getByText('L2 Sidebar')).toBeTruthy();
  });

  it('lifts the xl max-width cap when hideDesktopSidebar is set on guide routes', () => {
    render(
      <MemoryRouter initialEntries={['/page/guide-start']}>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>} hideDesktopSidebar>
              <div>Guide Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    const contentColumn = screen.getByText('Guide Content').closest('[class*="xl:max-w-"]');
    expect(contentColumn).not.toBeNull();
    expect(contentColumn?.className).toContain('xl:max-w-none');
    expect(contentColumn?.className).not.toContain('xl:max-w-[984px]');
  });

  it('renders labeled mobile L1 rail inside MobileSidebar and does not focus the close button on open', () => {
    render(
      <MemoryRouter initialEntries={['/journal']}>
        <NuqsAdapter>
          <NavProvider tree={appNavTree}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>L2 Sidebar</div>}>
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    openDrawer();
    const drawer = screen.getByTestId(TEST_IDS.MOBILE_NAV_DRAWER);
    expect(within(drawer).getByText('Home')).toBeTruthy();
    expect(within(drawer).getByText('Notebooks')).toBeTruthy();
    expect(within(drawer).getByText('Search')).toBeTruthy();
    expect(within(drawer).queryAllByRole('tooltip')).toHaveLength(0);

    const closeBtn = screen.getByTestId(TEST_IDS.MOBILE_NAV_CLOSE);
    expect(document.activeElement).not.toBe(closeBtn);
  });

  it('uses honest Done / Reset controls in RightL3Drawer when analyticsControls exist (never placebo Apply)', () => {
    const onReset = mock(() => {});
    const dispatch = mock(() => {});

    const { unmount } = render(
      <MemoryRouter initialEntries={['/note/1']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={makeBaseNavContext({
              navState: { ...initialNavState, rightDrawerOpen: true },
              l3Items: [{ id: 'intro', label: 'Intro', level: 3, action: { type: 'scroll', sectionId: 'intro' } }],
            })}
          >
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Note Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    const drawerWithoutFooter = screen.getByTestId(TEST_IDS.L3_RIGHT_DRAWER);
    expect(within(drawerWithoutFooter).getByText('Page options').className).toContain('text-xs');
    expect(within(drawerWithoutFooter).queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(within(drawerWithoutFooter).queryByTestId(TEST_IDS.L3_DRAWER_DONE_BTN)).toBeNull();
    expect(document.activeElement).not.toBe(within(drawerWithoutFooter).getByRole('button', { name: 'Close page options' }));
    unmount();

    render(
      <MemoryRouter initialEntries={['/dashboard/strength']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={makeBaseNavContext({
              dispatch,
              navState: { ...initialNavState, rightDrawerOpen: true },
              analyticsControls: {
                weeks: 8,
                onWeeksChange: () => {},
                onReset,
              },
            })}
          >
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Dashboard Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    const drawerWithControls = screen.getByTestId(TEST_IDS.L3_RIGHT_DRAWER);
    expect(within(drawerWithControls).queryByRole('button', { name: 'Apply' })).toBeNull();
    fireEvent.click(within(drawerWithControls).getByTestId(TEST_IDS.L3_DRAWER_RESET_BTN));
    expect(onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(within(drawerWithControls).getByTestId(TEST_IDS.L3_DRAWER_DONE_BTN));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_RIGHT_DRAWER', open: false });
  });

  it('renders peekSlot in the 340px right-edge slot with spacer + backdrop and dismisses on backdrop/Esc', () => {
    mockViewport({ is2xl: true, isMobile: false });
    const closePeek = mock(() => {});
    const { container } = render(
      <MemoryRouter initialEntries={['/note/1']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={makeBaseNavContext({
              navState: {
                ...initialNavState,
                inspectorDrawerOpen: true,
                peekTarget: { kind: 'effort', slug: 'back-squat', label: 'Back Squat' },
              },
              peekTarget: { kind: 'effort', slug: 'back-squat', label: 'Back Squat' },
              closePeek,
            })}
          >
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<div>Sidebar</div>}
              secondary={[{ kind: 'link', id: 'item-1', label: 'Item 1', to: '/test' }]}
              peekSlot={<aside aria-label="Entity Peek Drawer">Back Squat Preview</aside>}
            >
              <div>Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId(TEST_IDS.L3_INLINE_RAIL)).toBeNull();
    expect(screen.getByTestId(TEST_IDS.INSPECTOR_DRAWER_RAIL_SPACER)).toBeTruthy();
    const slot = screen.getByTestId(TEST_IDS.PEEK_DRAWER_SLOT);
    expect(within(slot).getByText('Back Squat Preview')).toBeTruthy();
    expect(container.querySelectorAll('aside')).toHaveLength(1);

    const contentColumn = screen.getByText('Content').closest('[class*="xl:max-w-"]');
    expect(contentColumn?.className).toContain('xl:max-w-none');

    fireEvent.click(screen.getByTestId(TEST_IDS.PEEK_DRAWER_BACKDROP));
    expect(closePeek).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closePeek).toHaveBeenCalledTimes(2);
  });

  it('hides the 2xl+ inline L3 aside when inspectorDrawerOpen is true (e.g. WhiteboardInspectorDrawer)', () => {
    mockViewport({ is2xl: true, isMobile: false });
    const { container } = render(
      <MemoryRouter initialEntries={['/note/1']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={makeBaseNavContext({
              navState: { ...initialNavState, inspectorDrawerOpen: true },
              secondarySpec: [{ kind: 'link', id: 'item-1', label: 'Item 1', to: '/test' }],
            })}
          >
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<div>Sidebar</div>}
              secondary={[{ kind: 'link', id: 'item-1', label: 'Item 1', to: '/test' }]}
            >
              <div>Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    expect(container.querySelector('aside')).toBeNull();
    expect(screen.getByTestId(TEST_IDS.INSPECTOR_DRAWER_RAIL_SPACER)).toBeTruthy();
    const contentColumn = screen.getByText('Content').closest('[class*="xl:max-w-"]');
    expect(contentColumn?.className).toContain('xl:max-w-none');
    expect(contentColumn?.className).not.toContain('xl:max-w-[984px]');
  });

  it('ignores defaultPrevented Cmd+. / Ctrl+. keydown events', () => {
    render(
      <MemoryRouter initialEntries={['/note/1']}>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<div>Sidebar</div>}
              secondary={[{ kind: 'link', id: 'item-1', label: 'Item 1', to: '/test' }]}
            >
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    const ev = new KeyboardEvent('keydown', { key: '.', ctrlKey: true, cancelable: true, bubbles: true });
    ev.preventDefault();
    window.dispatchEvent(ev);
    expect(screen.queryByTestId(TEST_IDS.L3_RIGHT_DRAWER)).toBeNull();
  });
});
