import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { MenuList } from '../MenuList';
import type { MenuSpec } from '../menuModel';

let currentLoc: Location | null = null;
function LocProbe() {
  currentLoc = useLocation();
  return null;
}

function renderMenu(entries: MenuSpec, activeId?: string) {
  currentLoc = null;
  return render(
    <MemoryRouter initialEntries={['/note/1']}>
      <LocProbe />
      <MenuList entries={entries} activeId={activeId} />
    </MemoryRouter>,
  );
}

describe('MenuList', () => {
  afterEach(() => {
    cleanup();
  });

  it('invokes onRun when a run-affordance link row is clicked', () => {
    const onRun = mock(() => {});
    renderMenu([{ kind: 'link', id: 'workout-1', label: 'Fran', onRun, runIcon: 'play' }]);

    screen.getByText('Fran').click();
    expect(onRun).toHaveBeenCalled();
  });

  it('renders section labels above their entries', () => {
    renderMenu([
      {
        kind: 'section',
        id: 'sec',
        label: 'Recent entries',
        entries: [{ kind: 'link', id: 'e1', label: 'Fran' }],
      },
    ]);

    expect(screen.getByText('Recent entries')).toBeTruthy();
    expect(screen.getByText('Fran')).toBeTruthy();
  });

  it('hides WQL sections that resolved with no rows', () => {
    renderMenu([
      { kind: 'section', id: 'empty', label: 'Recent entries', entries: [] },
      { kind: 'link', id: 'plain', label: 'Plain link' },
    ]);

    expect(screen.queryByText('Recent entries')).toBeNull();
    expect(screen.getByText('Plain link')).toBeTruthy();
  });

  it('highlights exactly the row whose section id is active', () => {
    // The rail marks the current section by section id (the same id space
    // the scroll-spy dispatches). One row is highlighted; the rest share one
    // inactive style, so "dimmed" only ever means "not the current section".
    renderMenu(
      [
        { kind: 'link', id: 'welcome', label: 'Welcome', sectionId: 'tour-hero' },
        { kind: 'link', id: 'insights', label: 'Session Insights', sectionId: 'tour-section-insights' },
      ],
      'tour-section-insights',
    );

    const active = screen.getByText('Session Insights').closest('button')!;
    expect(active.className).toContain('bg-primary/10');
    expect(active.className).toContain('font-semibold');
    expect(active.className).toContain('text-primary');

    const inactive = screen.getByText('Welcome').closest('button')!;
    expect(inactive.className).not.toContain('bg-primary/10');
    expect(inactive.className).not.toContain('text-primary');
    expect(inactive.className).toContain('text-muted-foreground');
  });

  it('renders 2-part facet links as sibling buttons (entity page vs library filter) and supports onSelect', () => {
    const onSelect = mock(() => {});
    renderMenu([
      {
        kind: 'link',
        id: 'effort:fran',
        label: 'Fran',
        to: '/effort/fran',
        filterTo: '/notes?q=%3Anote%7Beffort%3Afran%7D',
        filterLabel: 'Filter notes by effort Fran',
      },
      {
        kind: 'link',
        id: 'unrecognized:zottman-curl',
        label: 'Zottman Curl',
        badge: 'define',
        onSelect,
        filterTo: '/notes?q=%3Anote%7Btext%3A%22Zottman%20Curl%22%7D',
      },
    ]);

    const primaryBtn = screen.getByText('Fran').closest('button')!;
    const filterBtn = screen.getByTestId('menu-filter-effort:fran');
    // Accessible sibling buttons — never nested inside each other.
    expect(primaryBtn.contains(filterBtn)).toBe(false);

    fireEvent.click(primaryBtn);
    expect(currentLoc?.pathname).toBe('/effort/fran');

    fireEvent.click(filterBtn);
    expect(currentLoc?.pathname).toBe('/notes');
    expect(currentLoc?.search).toBe('?q=%3Anote%7Beffort%3Afran%7D');

    fireEvent.click(screen.getByText('Zottman Curl').closest('button')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
