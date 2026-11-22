import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavigationDrawerProvider } from '../NavigationDrawerContext';
import { DashboardsNavPanel } from './DashboardsNavPanel';
import type { DashboardListItem } from '../../hooks/useDashboards';

const ITEMS: DashboardListItem[] = [
  { slug: 'pr-board', title: 'PR Board', editable: true },
  { slug: 'strength-trends', title: 'Strength Trends', editable: false },
];

afterEach(cleanup);

const LOCATION = { pathname: '/dashboards', search: '', hash: '', state: null, key: 'test' };

function renderPanel(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]} initialIndex={0}>
      <DashboardsNavPanel itemsOverride={ITEMS} currentPath="/dashboards" location={LOCATION} />
    </MemoryRouter>,
  );
}

describe('DashboardsNavPanel', () => {
  it('renders unified SidebarItem rows on /dashboards without 13 inline examples or 9px prebuilt badges', () => {
    const { container } = renderPanel('/dashboards');

    const explorerBtn = screen.getByText('Explorer').closest('button')!;
    expect(explorerBtn.getAttribute('aria-current')).toBe('page');
    expect(explorerBtn.getAttribute('data-current')).toBe('true');

    // Examples moved into the inline Explorer bar on AnalyticsExplorerPage.
    expect(screen.queryByText('TIS by round')).toBeNull();
    expect(screen.queryByText('Reps by lift')).toBeNull();

    // Saved dashboards, Prebuilt boards, and New dashboard footer are cleanly listed without 9px badges.
    expect(screen.getByTestId('dashboards-nav-saved')).toBeDefined();
    expect(screen.getByTestId('dashboards-nav-prebuilt')).toBeDefined();
    expect(screen.getByText('PR Board')).toBeDefined();
    expect(screen.getByText('Strength Trends')).toBeDefined();
    expect(screen.queryByText('prebuilt')).toBeNull();
    expect(container.innerHTML).not.toContain('text-[9px]');
    expect(container.innerHTML).not.toContain('text-[10px]');

    // Mobile 44px touch target floor enforced on New dashboard CTA and SidebarItems.
    const newBtn = screen.getByTestId('dashboards-nav-new');
    expect(newBtn.className).toContain('max-lg:min-h-11');
    expect(explorerBtn.className).toContain('min-h-11');
  });

  it('highlights the active dashboard row via SidebarItem on detail paths', () => {
    renderPanel('/dashboard/pr-board');

    expect(screen.getByTestId('dashboards-nav-saved')).toBeDefined();
    expect(screen.getByTestId('dashboards-nav-prebuilt')).toBeDefined();
    expect(screen.getByText('PR Board').closest('button')!.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Strength Trends').closest('button')!.getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('dashboards-nav-new')).toBeDefined();
  });

  it('closes mobile drawer on navigation click', () => {
    let closed = 0;
    render(
      <MemoryRouter initialEntries={['/dashboards']}>
        <NavigationDrawerProvider close={() => { closed += 1; }}>
          <DashboardsNavPanel itemsOverride={ITEMS} currentPath="/dashboards" location={LOCATION} />
        </NavigationDrawerProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('PR Board'));
    expect(closed).toBe(1);
  });
});
