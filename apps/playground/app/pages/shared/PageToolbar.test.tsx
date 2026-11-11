import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router';
import { PageDownloadAction } from './PageToolbar';
import { SidebarLayout } from '@/templates/SidebarLayout';
import { StickyPageHeader } from '@/panels/page-shells';
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

  it('omits the Page options trigger when L3 has no content across all 3 slots', () => {
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

  it('opens the RightL3Drawer from StickyPageHeader Page options trigger and renders all 3 L3 slots', () => {
    const scrollToSection = mock(() => {});
    const runClone = mock(() => {});
    const onToggleGroupDim = mock(() => {});

    const streamControls = {
      query: ':journal{tags:pr} last 4w',
      onQueryChange: mock(() => {}),
      groupDims: ['date'],
      onToggleGroupDim,
      availableGroupDims: [
        { id: 'date', label: 'Date' },
        { id: 'discipline', label: 'Discipline' },
      ],
      settings: { level: 'note' as const, layout: 'cards' as const, visibleFields: ['title'] },
      onLayoutChange: mock(() => {}),
      onToggleField: mock(() => {}),
      level: 'note' as const,
    };

    function PagePublisher() {
      const { setL3Items, setL3Actions, setStreamControls } = useNav();
      act(() => {
        setStreamControls(streamControls);
        setL3Items([
          { id: 'intro', label: 'Intro', level: 3, action: { type: 'scroll', sectionId: 'intro' } },
        ] satisfies NavItemL3[]);
        setL3Actions?.([
          { id: 'helpful-clone', label: 'Clone', onRun: runClone },
        ]);
      });
      return <StickyPageHeader title="Journal" />;
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
    // Active filter dot lights up because `:journal{tags:pr}` has a filter.
    expect(screen.getByTestId('header-filters-active')).toBeDefined();

    fireEvent.click(trigger);

    const drawer = screen.getByTestId('l3-right-drawer');
    expect(within(drawer).getByText('Date window')).toBeDefined();
    expect(within(drawer).getByText('On this page')).toBeDefined();
    expect(within(drawer).getByText('Actions')).toBeDefined();

    const groupBlock = within(drawer).getByTestId('l3-groupby-options');
    fireEvent.click(within(groupBlock).getByLabelText('Discipline'));
    expect(onToggleGroupDim).toHaveBeenCalledWith('discipline');
    // Modifier toggles keep the drawer open for multi-picking.
    expect(screen.queryByTestId('l3-right-drawer')).not.toBeNull();

    // Context action runs and closes the drawer cleanly.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Clone' }));
    expect(runClone).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('l3-right-drawer')).toBeNull();

    // Unused scroll mock check
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

    const drawer = screen.getByTestId('l3-right-drawer');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Intro' }));
    expect(scrollToSection).toHaveBeenCalledWith('intro');
  });
});
