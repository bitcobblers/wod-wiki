import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResultsExperiencePrototypePage from './ResultsExperiencePrototypePage';

function renderProto(initialUrl = '/proto/results-experience') {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <ResultsExperiencePrototypePage />
    </MemoryRouter>,
  );
}

describe('ResultsExperiencePrototypePage', () => {
  it('renders all 4 prototype surfaces cleanly via ?view=...', () => {
    renderProto('/proto/results-experience?view=note');
    expect(screen.getByTestId('proto-note-injection-view')).toBeTruthy();
    expect(screen.getByTestId('proto-session-summary-card')).toBeTruthy();

    fireEvent.click(screen.getByTestId('proto-nav-spreadsheet'));
    expect(screen.getByTestId('proto-results-spreadsheet-view')).toBeTruthy();

    fireEvent.click(screen.getByTestId('proto-nav-dashboard'));
    expect(screen.getByTestId('proto-bound-dashboard-view')).toBeTruthy();

    fireEvent.click(screen.getByTestId('proto-nav-wql'));
    expect(screen.getByTestId('proto-wql-extensions-view')).toBeTruthy();
  });

  it('injects explicit YAML view: summary after running workout and preserves legacy 1-line table mode', () => {
    renderProto('/proto/results-experience?view=note');

    // Reset to pre-run first, then simulate finishing the workout
    fireEvent.click(screen.getByTestId('proto-reset-run'));
    expect(screen.getByTestId('proto-pre-run-placeholder')).toBeTruthy();

    fireEvent.click(screen.getByTestId('proto-run-workout-btn'));
    expect(screen.getByTestId('proto-session-summary-card')).toBeTruthy();
    const markdownPre = screen.getByTestId('proto-note-markdown-source');
    expect(markdownPre.textContent).toContain('view: summary');
    expect(markdownPre.textContent).toContain('query: :session{result:01a1f5f2-9361-767c-b727-8dd7634d4b3b}');

    // Legacy 1-line mode keeps rendering a compact table cleanly
    fireEvent.click(screen.getByTestId('proto-format-legacy'));
    expect(screen.getByTestId('proto-legacy-table-block')).toBeTruthy();
    expect(markdownPre.textContent).not.toContain('view: summary');
    expect(markdownPre.textContent).toContain(':session{result:01a1f5f2-9361-767c-b727-8dd7634d4b3b}');
  });

  it('recalculates spreadsheet totals and summary KPIs when editing a split cell', () => {
    renderProto('/proto/results-experience?view=spreadsheet');

    // Initial Fran volume: 21*95 + 15*95 + 9*105 = 1995 + 1425 + 945 = 4,365
    expect(screen.getByTestId('proto-footer-volume').textContent).toContain('4,365');

    // Edit R3 Thruster load from 105 -> 115 (+90 lb total volume => 4,455)
    fireEvent.click(screen.getByTestId('proto-cell-fran-r3-thruster-load'));
    const input = screen.getByTestId('proto-inline-cell-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '115' } });
    fireEvent.click(screen.getByTestId('proto-inline-cell-save'));

    expect(screen.getByTestId('proto-footer-volume').textContent).toContain('4,455');

    // Return to Note & Summary and verify summary KPI updated live
    fireEvent.click(screen.getByTestId('proto-back-to-note'));
    const summaryCard = screen.getByTestId('proto-session-summary-card');
    expect(summaryCard.textContent).toContain('4,455 lb');
  });

  it('uses accessible <button> sort headers inside <th> and avoids nested interactive elements', () => {
    renderProto('/proto/results-experience?view=spreadsheet');
    const table = screen.getByTestId('proto-results-spreadsheet');
    const sortBtn = within(table).getByTestId('proto-sort-reps');
    expect(sortBtn.tagName).toBe('BUTTON');
    const th = sortBtn.closest('th');
    expect(th?.getAttribute('aria-sort')).toBe('none');

    fireEvent.click(sortBtn);
    expect(th?.getAttribute('aria-sort')).toBe('ascending');

    // Verify no tr or div has nested interactive buttons inside role="button"
    expect(table.querySelectorAll('tr[role="button"]').length).toBe(0);
  });

  it('creates a new workout-scoped dashboard from AddToDashboardSheet with comparison scopes', () => {
    renderProto('/proto/results-experience?view=note');

    fireEvent.click(screen.getByTestId('proto-summary-add-dashboard'));
    expect(screen.getByTestId('proto-add-to-dashboard-sheet')).toBeTruthy();

    // Toggle comparison against Strength Cycle notebook & Prior runs
    fireEvent.click(screen.getByTestId('proto-scope-otherNotebook'));
    expect(screen.getByTestId('proto-other-notebook-select')).toBeTruthy();

    // Advance to Step 2 and create a new workout dashboard
    fireEvent.click(screen.getByTestId('proto-add-dash-next-step'));
    fireEvent.click(screen.getByTestId('proto-dest-mode-new'));
    const titleInput = screen.getByTestId('proto-new-dashboard-title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Fran Block Tracker' } });
    fireEvent.click(screen.getByTestId('proto-add-dash-confirm'));

    // Lands on Dashboard Binding view with the newly created dashboard active
    const dashboardView = screen.getByTestId('proto-bound-dashboard-view');
    expect(dashboardView).toBeTruthy();
    expect(dashboardView.textContent).toContain('Fran Block Tracker');
  });
});
