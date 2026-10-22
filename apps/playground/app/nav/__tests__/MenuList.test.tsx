import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MenuList } from '../MenuList';
import type { MenuSpec } from '../menuModel';

function renderMenu(entries: MenuSpec, activeId?: string) {
  return render(
    <MemoryRouter>
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
});
