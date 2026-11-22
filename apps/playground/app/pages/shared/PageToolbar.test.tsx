import { useEffect } from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { PageDownloadAction } from './PageToolbar';
import { SidebarLayout } from '@/templates/SidebarLayout';
import { StickyPageHeader } from '@/panels/page-shells';
import { TEST_IDS } from '@/lib/testIds';
import { NavContext, NavProvider, initialNavState, useNav } from '../../nav/NavContext';
import { NavigationDrawerProvider } from '../../nav/NavigationDrawerContext';
import type { NavItemL3 } from '../../nav/navTypes';

describe('PageDownloadAction', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when document content is empty', () => {
    const { container } = render(
      <PageDownloadAction currentWorkout={{ name: 'Test', content: '' }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('invokes onDownload and closes the enclosing L3 drawer when clicked', () => {
    const onDownload = mock(() => {});
    const closeDrawer = mock(() => {});
    render(
      <NavigationDrawerProvider close={closeDrawer}>
        <PageDownloadAction currentWorkout={{ name: 'Test', content: '# Test' }} onDownload={onDownload} />
      </NavigationDrawerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }));
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

describe('Unified L3 slide-over drawer (L3DrawerTrigger + RightL3Drawer)', () => {
  afterEach(() => {
    cleanup();
  });

  it('omits the Page options trigger when L3 has no content across all slots', () => {
    render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <StickyPageHeader title="Empty Page" />
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Page options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open page options' })).toBeNull();
  });

  it('opens RightL3Drawer from StickyPageHeader Page options trigger and renders analytics, outline, connections, and actions once', () => {
    const scrollToSection = mock(() => {});
    const runClone = mock(() => {});
    const onWeeksChange = mock(() => {});
    const onReset = mock(() => {});

    function PagePublisher() {
      const { setL3Items, setL3Connections, setL3Actions, setAnalyticsControls } = useNav();
      useEffect(() => {
        setAnalyticsControls?.({
          weeks: 8,
          onWeeksChange,
          onReset,
        });
        setL3Items([
          { id: 'intro', label: 'Intro', level: 3, action: { type: 'scroll', sectionId: 'intro' } },
        ] satisfies NavItemL3[]);
        setL3Connections?.([
          {
            kind: 'section',
            id: 'efforts',
            label: 'Efforts',
            entries: [{ kind: 'link', id: 'fran', label: 'Fran', to: '/effort/fran' }],
          },
        ]);
        setL3Actions?.([
          { id: 'helpful-clone', label: 'Clone', group: 'organize', onRun: runClone },
        ]);
      }, [setAnalyticsControls, setL3Items, setL3Connections, setL3Actions]);
      return <StickyPageHeader title="Strength Board" />;
    }

    render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout
              navbar={<div>Navbar</div>}
              sidebar={<div>Sidebar</div>}
              pageAction={<PageDownloadAction currentWorkout={{ name: 'Test', content: '# Test' }} onDownload={() => {}} />}
            >
              <PagePublisher />
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: 'Page options' });
    expect(trigger.className).toContain('lg:inline-flex');
    expect(trigger.className).toContain('2xl:hidden');

    fireEvent.click(trigger);

    const drawer = screen.getByTestId(TEST_IDS.L3_RIGHT_DRAWER);
    expect(within(drawer).getByTestId(TEST_IDS.L3_ANALYTICS_CONTROLS)).toBeDefined();
    expect(within(drawer).getByText('On this page')).toBeDefined();
    expect(within(drawer).getByTestId(TEST_IDS.L3_CONNECTIONS)).toBeDefined();
    expect(within(drawer).getByText('Actions')).toBeDefined();
    // Single mount: no duplicate L3 testids in DOM
    expect(screen.getAllByTestId(TEST_IDS.L3_ACTIONS)).toHaveLength(1);

    // Modifier clicks keep drawer open for multi-picking
    fireEvent.click(within(drawer).getByTestId('l3-range-4w'));
    expect(onWeeksChange).toHaveBeenCalledWith(4);
    expect(screen.queryByTestId(TEST_IDS.L3_RIGHT_DRAWER)).not.toBeNull();

    // Honest Reset button invokes onReset
    fireEvent.click(within(drawer).getByTestId(TEST_IDS.L3_DRAWER_RESET_BTN));
    expect(onReset).toHaveBeenCalledTimes(1);

    // Context action runs and closes the drawer cleanly
    fireEvent.click(within(drawer).getByRole('button', { name: 'Clone' }));
    expect(runClone).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(TEST_IDS.L3_RIGHT_DRAWER)).toBeNull();

    expect(scrollToSection).not.toHaveBeenCalled();
  });

  it('scrolls to section when clicking an On this page anchor inside SecondaryNav', () => {
    const scrollToSection = mock(() => {});
    const items: NavItemL3[] = [
      { id: 'intro', label: 'Intro', level: 3, action: { type: 'scroll', sectionId: 'intro' } },
    ];

    render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavContext.Provider
            value={{
              tree: [],
              navState: { ...initialNavState, rightDrawerOpen: true },
              dispatch: () => {},
              l3Items: items,
              setL3Items: () => {},
              secondarySpec: undefined,
              setSecondarySpec: () => {},
              streamControls: null,
              setStreamControls: () => {},
              scrollToSection,
              registerScrollFn: () => {},
              openCreateJournal: () => {},
              registerCreateJournal: () => {},
              setContextNav: () => {},
            }}
          >
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <StickyPageHeader title="Guide" />
            </SidebarLayout>
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    const drawer = screen.getByTestId(TEST_IDS.L3_RIGHT_DRAWER);
    fireEvent.click(within(drawer).getByRole('button', { name: 'Intro' }));
    expect(scrollToSection).toHaveBeenCalledWith('intro');
  });
});
