import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { SidebarLayout } from '../SidebarLayout';
import { PAGE_SHELL_CONTAINER_CLASS, PAGE_SHELL_CONTENT_SURFACE_CLASS } from '../../panels/page-shells/contentSurface';
import { NavContext, NavProvider, initialNavState } from '../../../app/nav/NavContext';
import { appNavTree } from '../../../app/nav/appNavTree';
import { TEST_IDS } from '../../lib/testIds';

function NavigateTo({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>{label}</button>;
}

function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
}

/**
 * Asserts the drawer's real close lifecycle — Headless unmounts the dialog
 * after its rAF-driven leave transition, but RTL `waitFor` never observes
 * that unmount under bun test (its MutationObserver/interval polling stalls),
 * so poll real timers until the dialog leaves the accessibility tree.
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

describe('SidebarLayout mobile folding zones', () => {
  afterEach(() => {
    cleanup();
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

  it('renders zone-4 secondary nav aside gated on 2xl breakpoint (not xl)', () => {
    const { container } = render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<div>Sidebar</div>}
              secondary={[{ id: 'item-1', label: 'Item 1', to: '/test' }]}
            >
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    const aside = container.querySelector('aside');
    const classes = aside?.className.split(/\s+/) ?? [];
    expect(classes).toContain('hidden');
    expect(classes).toContain('2xl:flex');
    expect(classes).not.toContain('xl:flex');
  });

  it('owns the width measure in the layout column, leaving the shell card uncapped', () => {
    // One owner for the measure: the column caps app routes at 984px and the
    // home route grows to fill; the shell card inherits whichever column it
    // renders in, so it must not carry a second, contradictory cap.
    expect(PAGE_SHELL_CONTAINER_CLASS).not.toContain('max-w-[984px]');
    expect(PAGE_SHELL_CONTAINER_CLASS).not.toContain('3xl:max-w');
    expect(PAGE_SHELL_CONTENT_SURFACE_CLASS).toContain('bg-background');
  });

  it('shows the fixed Apply footer on filter L1s and closes the drawer on click', async () => {
    render(
      <MemoryRouter initialEntries={['/pages']}>
        <NuqsAdapter>
          <NavProvider tree={appNavTree}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await expectDrawerClosed();
  });

  it('renders no Apply footer on non-filter L1s', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <NuqsAdapter>
          <NavProvider tree={appNavTree}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Content</div>
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );
    openDrawer();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('keeps the drawer open across route navigation (explicit close only)', () => {
    render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout
              navbar={<div>Navbar</div>}
              // Navigation trigger rides the sidebar prop so it lives inside
              // the drawer — outside content is aria-hidden while open.
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
    const desktopColumn = document.querySelector('nav[aria-label="Main"] div[class*="w-60"]');
    expect(desktopColumn?.className).toContain('lg:hidden');
    // Mobile drawer is untouched by the flag: sidebar content still opens there.
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

  it('omits RightL3Drawer Apply footer when no stream/analytics controls are active and shows it when streamControls exist', () => {
    const baseCtx = {
      tree: [],
      dispatch: () => {},
      l3Items: [{ id: 'intro', label: 'Intro', level: 3 as const, action: { type: 'scroll' as const, sectionId: 'intro' } }],
      setL3Items: () => {},
      secondarySpec: undefined,
      setSecondarySpec: () => {},
      setStreamControls: () => {},
      scrollToSection: () => {},
      registerScrollFn: () => {},
      openCreateJournal: () => {},
      registerCreateJournal: () => {},
      setContextNav: () => {},
    };

    const { unmount } = render(
      <MemoryRouter initialEntries={['/note/1']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={{
              ...baseCtx,
              navState: { ...initialNavState, rightDrawerOpen: true },
              streamControls: null,
              analyticsControls: null,
            }}
          >
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Note Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    const drawerWithoutApply = screen.getByTestId('l3-right-drawer');
    expect(within(drawerWithoutApply).getByText('Page options').className).toContain('text-xs');
    expect(within(drawerWithoutApply).queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(document.activeElement).not.toBe(within(drawerWithoutApply).getByRole('button', { name: 'Close page options' }));
    unmount();

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={{
              ...baseCtx,
              navState: { ...initialNavState, rightDrawerOpen: true },
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
              analyticsControls: null,
            }}
          >
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <div>Stream Content</div>
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    const drawerWithApply = screen.getByTestId('l3-right-drawer');
    expect(within(drawerWithApply).getByRole('button', { name: 'Apply' })).toBeTruthy();
  });

  it('hides the 2xl+ inline L3 aside when inspectorDrawerOpen is true', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/note/1']}>
        <NuqsAdapter>
          <NavContext.Provider
            value={{
              tree: [],
              navState: { ...initialNavState, inspectorDrawerOpen: true },
              dispatch: () => {},
              l3Items: [],
              setL3Items: () => {},
              secondarySpec: [{ kind: 'link', id: 'item-1', label: 'Item 1', to: '/test' }],
              setSecondarySpec: () => {},
              setStreamControls: () => {},
              scrollToSection: () => {},
              registerScrollFn: () => {},
              openCreateJournal: () => {},
              registerCreateJournal: () => {},
              setContextNav: () => {},
            }}
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
    expect(screen.queryByTestId('l3-right-drawer')).toBeNull();
  });
});
