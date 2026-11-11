import { afterEach, describe, expect, it, mock } from 'bun:test';
// Must precede the react-router-dom import: repairs the partial
// react-router-dom mock that useJournalZipProcessor.test.ts leaks
// process-wide (see tests/helpers/repair-react-router-dom.ts).
import '../../../tests/helpers/repair-react-router-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavigationDrawerProvider } from '../NavigationDrawerContext';

mock.module('../../hooks/useDashboards', () => ({
  useDashboardList: () => ({
    items: [
      { slug: 'pr-board', title: 'PR Board', editable: true },
      { slug: 'strength-trends', title: 'Strength Trends', editable: false },
    ],
    loading: false,
  }),
}));

import { DashboardsNavPanel } from './DashboardsNavPanel';

afterEach(cleanup);

function renderPanel(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]} initialIndex={0}>
      <DashboardsNavPanel />
    </MemoryRouter>,
  );
}

describe('DashboardsNavPanel', () => {
  it('promotes the examples to the explorer L2, lists saved dashboards, and highlights the active example semantically', () => {
    // Deep link drops the catalog's empty `{}` braces — textually different
    // from 'avg:tis{} by {round}', canonically the same query. Raw string
    // equality would leave the row unhighlighted.
    renderPanel('/dashboards?q=avg:tis%20by%20%7Bround%7D');

    expect(screen.getByText('TIS by round').closest('button')!.className).toContain('bg-primary/10');
    expect(screen.getByText('Reps by lift').closest('button')!.className).not.toContain('bg-primary/10');
    // Saved dashboards and New dashboard are also reachable directly from /dashboards L2.
    expect(screen.getByText('PR Board')).toBeDefined();
    expect(screen.getByTestId('dashboards-nav-new')).toBeDefined();
  });

  it('keeps the dashboard list split into Saved dashboards and Prebuilt on detail paths; examples off', () => {
    renderPanel('/dashboard/pr-board');

    expect(screen.getByTestId('dashboards-nav-saved')).toBeDefined();
    expect(screen.getByTestId('dashboards-nav-prebuilt')).toBeDefined();
    expect(screen.getByText('PR Board').closest('button')!.className).toContain('bg-primary/10');
    expect(screen.getByText('Strength Trends').closest('button')!.className).not.toContain('bg-primary/10');
    expect(screen.getByTestId('dashboards-nav-new')).toBeDefined();
    expect(screen.queryByText('TIS by round')).toBeNull();
  });

  it('closes mobile drawer on navigation click', () => {
    let closed = 0;
    render(
      <MemoryRouter initialEntries={['/dashboards']}>
        <NavigationDrawerProvider close={() => { closed += 1; }}>
          <DashboardsNavPanel />
        </NavigationDrawerProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('TIS by round'));
    expect(closed).toBe(1);
  });
});
