import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router';
import { SidebarLayout } from '../SidebarLayout';
import { PAGE_SHELL_CONTAINER_CLASS, PAGE_SHELL_CONTENT_SURFACE_CLASS } from '../../panels/page-shells/contentSurface';
import { NavProvider } from '../../../app/nav/NavContext';
import { appNavTree } from '../../../app/nav/appNavTree';

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
      <MemoryRouter>
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

  it('exports centralized PAGE_SHELL_CONTAINER_CLASS with xl cap and no ultrawide cap', () => {
    expect(PAGE_SHELL_CONTAINER_CLASS).toContain('xl:max-w-[984px]');
    expect(PAGE_SHELL_CONTAINER_CLASS).toContain('2xl:max-w-none');
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
});
