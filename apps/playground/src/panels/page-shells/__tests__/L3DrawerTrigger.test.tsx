import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { L3DrawerTrigger, L3DrawerStateProvider } from '../L3DrawerTrigger';
import { JournalPageShell } from '../JournalPageShell';
import { SidebarLayout } from '../../../templates/SidebarLayout';
import { NavProvider } from '../../../../app/nav/NavContext';

describe('L3DrawerTrigger & JournalPageShell landmark parity', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
  });

  it('returns null at 2xl+ (>= 1520px) and on <lg mobile (<= 1023px), and renders at lg–2xl', () => {
    const setMockMedia = (matches: (query: string) => boolean) => {
      window.matchMedia = ((query: string) => ({
        matches: matches(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    };

    // 2xl+ desktop: inline rail is mounted, no trigger
    setMockMedia((query) => query === '(min-width: 1520px)');
    const { unmount: unmount2xl } = render(
      <L3DrawerStateProvider value={{ railHasContent: true, hasAppliedFilters: false, openRightDrawer: () => {} }}>
        <L3DrawerTrigger />
      </L3DrawerStateProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Page options' })).toBeNull();
    unmount2xl();

    // <lg mobile: thumb-zone ResponsiveActionsDock owns L3, no top-right trigger
    setMockMedia((query) => query.includes('max-width: 1023px'));
    const { unmount: unmountMobile } = render(
      <L3DrawerStateProvider value={{ railHasContent: true, hasAppliedFilters: false, openRightDrawer: () => {} }}>
        <L3DrawerTrigger />
      </L3DrawerStateProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Page options' })).toBeNull();
    unmountMobile();

    // lg–2xl tablet/medium desktop: trigger renders cleanly
    setMockMedia(() => false);
    render(
      <L3DrawerStateProvider value={{ railHasContent: true, hasAppliedFilters: false, openRightDrawer: () => {} }}>
        <L3DrawerTrigger />
      </L3DrawerStateProvider>,
    );
    expect(screen.getByRole('button', { name: 'Page options' })).toBeTruthy();
  });

  it('renders a single <main> landmark when JournalPageShell is inside SidebarLayout', () => {
    const { container } = render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavProvider tree={[]}>
            <SidebarLayout navbar={<div>Navbar</div>} sidebar={<div>Sidebar</div>}>
              <JournalPageShell title="Test Note" editor={<div>Editor Body</div>} />
            </SidebarLayout>
          </NavProvider>
        </NuqsAdapter>
      </MemoryRouter>,
    );

    const mains = container.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]!.querySelector('main')).toBeNull();
    expect(screen.getByText('Editor Body')).toBeTruthy();
  });
});
