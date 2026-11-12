import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { QueryResult } from '@bitcobblers/wod-wiki-engine';
import { parseDocument } from '@bitcobblers/wod-wiki-wql';

// EditorDialog focuses via requestAnimationFrame on open — polyfill where
// the test env lacks it.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
}

const DASH_RAW = `---
dashboard: true
title: Stale Board
slug: stale-board
---

## Volume
How much?

\`\`\`query:value
sum:totalVolume{}
\`\`\`
`;

// Every heading shape the outline must survive: a titled heading, two
// consecutive standalone headings, and a trailing heading after the last
// widget block.
const HEADING_RAW = `---
dashboard: true
title: Outline Board
slug: outline-board
---

# Outline Board

## First
What's first?

\`\`\`query:value
sum:totalVolume{}
\`\`\`

## Standalone A
## Standalone B
## Widget Two
Question two?

\`\`\`query:value
sum:tis{}
\`\`\`

## Trailing
`;

// The store behind the spied journalNotes — mutated directly to simulate
// a concurrent writer (another tab, another surface).
let storedRaw = DASH_RAW;
let updateCalls: string[] = [];
// dashboardNotes.deleteDashboard spy ledger (late finding #7).
let deleteDashboardCalls: string[] = [];

function resultOf(raw: string): QueryResult {
  return {
    parsed: { family: 'aggregate', raw, agg: 'sum', metric: 'totalVolume', filters: [], groupBy: [] },
    series: [{ key: 'total', label: 'total', points: [{ ts: Date.now(), value: 42 }], unit: 'reps' }],
    stages: { selected: 1, buckets: 1, aggregated: 1, groups: 0 },
    matched: [],
    unit: 'reps',
  } as unknown as QueryResult;
}

import { journalNotes } from '../../services/journalNotes';
import { dashboardNotes } from '../../services/dashboardNotes';
import { queryService } from '@/services/queryService';
import { storageService } from '@/services/storage';
import * as sampleModule from '@/services/analytics/sample';
import * as useAnalyticsRangeModule from '../../hooks/useAnalyticsRange';
import * as ResponsiveActionsModule from '../../nav/ResponsiveActions';
import * as useDashboardsModule from '../../hooks/useDashboards';

// Mirrors useDashboardSource's real transition semantics: a refreshKey bump
// flips loading to true but KEEPS the previously resolved source until the
// new resolution lands.
function fakeUseDashboardSource(slug: string | undefined, refreshKey?: number) {
  const [source, setSource] = useState<{
    slug: string; title: string; rawContent: string; editable: boolean; noteId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.resolve().then(() => {
      if (cancelled || !slug) return;
      setSource({ slug, title: 'Stale Board', rawContent: storedRaw, editable: true, noteId: 'n1' });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [slug, refreshKey]);
  return { source, loading };
}

// Spies over the production singletons — no module replacement, so sibling
// test files in the same process keep their real imports.
function installSpies(): void {
  spyOn(journalNotes, 'getById').mockImplementation((async () => ({ id: 'n1', rawContent: storedRaw })) as never);
  spyOn(journalNotes, 'update').mockImplementation((async (_note: unknown, raw: string) => {
    updateCalls.push(raw);
    storedRaw = raw;
    return { id: 'n1', rawContent: raw };
  }) as never);
  spyOn(journalNotes, 'resolve').mockImplementation((async () => ({ id: 'n1', rawContent: storedRaw })) as never);
  spyOn(journalNotes, 'create').mockImplementation((async () => { throw new Error('not used'); }) as never);
  spyOn(journalNotes, 'listByDate').mockImplementation((async () => []) as never);
  spyOn(dashboardNotes, 'createDashboard').mockImplementation((async () => { throw new Error('not used'); }) as never);
  spyOn(dashboardNotes, 'cloneDashboard').mockImplementation((async () => { throw new Error('not used'); }) as never);
  deleteDashboardCalls = [];
  spyOn(dashboardNotes, 'deleteDashboard').mockImplementation((async (noteId: string) => {
    deleteDashboardCalls.push(noteId);
  }) as never);
  spyOn(queryService, 'runQuery').mockImplementation((async (raw: string) => resultOf(raw)) as never);
  spyOn(queryService, 'runFind').mockImplementation((async () => ({})) as never);
  spyOn(queryService, 'runRows').mockImplementation((async () => ({})) as never);
  spyOn(storageService, 'countEvents').mockImplementation((async () => 1) as never);
  spyOn(sampleModule, 'loadSampleData').mockImplementation((async () => ({ facts: 0 })) as never);
  spyOn(sampleModule, 'purgeSampleData').mockImplementation((async () => undefined) as never);
  spyOn(sampleModule, 'hasSampleData').mockImplementation((async () => false) as never);
  spyOn(useAnalyticsRangeModule, 'useAnalyticsRange').mockImplementation((() => [16, () => {}]) as never);
  // Pass-through: the real dock registers with a provider the test doesn't mount.
  spyOn(ResponsiveActionsModule, 'ResponsiveActions').mockImplementation(((props: { primary?: unknown; children?: unknown }) => (
    <>
      {props.primary}
      {props.children}
    </>
  )) as never);
  spyOn(useDashboardsModule, 'useDashboardSource').mockImplementation(fakeUseDashboardSource as never);
}

import { DashboardViewPage } from './DashboardViewPage';
import { NavContext, initialNavState } from '../../nav/NavContext';
import type { NavItemL3 } from '../../nav/navTypes';

afterEach(cleanup);
afterEach(() => mock.restore());

beforeEach(() => {
  installSpies();
  storedRaw = DASH_RAW;
  updateCalls = [];
});

function renderPage(slug = 'stale-board') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/${slug}`]} initialIndex={0}>
      <Routes>
        <Route path="/dashboard/:slug" element={<DashboardViewPage />} />
        <Route path="/dashboards" element={<div data-testid="dashboards-landing" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DashboardViewPage delete dashboard (late finding #7)', () => {
  it('deletes a user-owned vault dashboard after confirmation and lands on /dashboards', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Volume')).toBeDefined());
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));

    // Visible Delete affordance in the Edit-mode toolbar…
    fireEvent.click(screen.getByTestId('delete-dashboard-button'));
    // …guarded by a confirmation dialog; Cancel closes it without deleting.
    fireEvent.click(screen.getByTestId('cancel-delete-dashboard'));
    expect(screen.queryByTestId('confirm-delete-dashboard')).toBeNull();
    expect(deleteDashboardCalls).toHaveLength(0);

    // Confirming deletes the note, notifies listeners, and navigates away.
    fireEvent.click(screen.getByTestId('delete-dashboard-button'));
    fireEvent.click(screen.getByTestId('confirm-delete-dashboard'));
    await waitFor(() => expect(deleteDashboardCalls).toEqual(['n1']));
    await waitFor(() => expect(screen.getByTestId('dashboards-landing')).toBeTruthy());
  });

  it('offers no delete affordance on read-only prebuilt dashboards', async () => {
    const sourceModule = await import('../../hooks/useDashboards');
    spyOn(sourceModule, 'useDashboardSource').mockImplementation(((slug: string | undefined, refreshKey?: number) => {
      const base = fakeUseDashboardSource(slug, refreshKey);
      return { ...base, source: base.source ? { ...base.source, editable: false } : null };
    }) as never);

    renderPage();

    await waitFor(() => expect(screen.getByText('Volume')).toBeDefined());
    expect(screen.queryByTestId('delete-dashboard-button')).toBeNull();
    expect(screen.getByTestId('clone-dashboard')).toBeTruthy();
  });
});

describe('DashboardViewPage stale-refresh transition', () => {
  it('keeps the composer draft and refusal banner mounted across the refresh a failed Apply triggers', async () => {
    renderPage();

    // Board resolved in view mode.
    await waitFor(() => expect(screen.getByText('Volume')).toBeDefined());

    // Enter edit mode, open the widget composer, type a draft title.
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit widget Volume' }));

    const titleInput = (await screen.findByTestId('widget-composer-title')) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Keep this draft' } });

    // Concurrent writer lands before Apply; this page never sees a
    // refreshKey for it — the refusal must come from the revision check.
    storedRaw = `${DASH_RAW}\nExternal update\n`;
    updateCalls = [];

    fireEvent.click(screen.getByTestId('widget-composer-apply'));

    // Visible refusal…
    await waitFor(() =>
      expect(screen.getByTestId('widget-composer-error').textContent).toContain('changed'),
    );
    // …the draft survives the refreshKey bump the refusal triggers…
    expect((screen.getByTestId('widget-composer-title') as HTMLInputElement).value).toBe('Keep this draft');
    // …nothing was written…
    expect(updateCalls.length).toBe(0);
    // …and the page never dropped to the loading placeholder mid-refresh.
    expect(screen.queryByText('Loading dashboard…')).toBeNull();

    // Sanity: the composer is the open dialog, and the banner is inside it.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('widget-composer-error')).toBeDefined();
  });
});

describe('DashboardViewPage widget layers', () => {
  it('compiles, previews, and persists goal, baseline, and comparison series', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Volume')).toBeDefined());
    fireEvent.click(screen.getByTestId('dashboard-edit-toggle'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit widget Volume' }));

    fireEvent.change(await screen.findByTestId('widget-sentence-chart'), { target: { value: 'timeseries' } });
    fireEvent.click(screen.getByTestId('legend-chip-goal'));
    fireEvent.click(screen.getByTestId('legend-chip-baseline'));
    fireEvent.click(screen.getByTestId('legend-chip-compare'));

    const draft = screen.getByTestId('widget-composer-wql').textContent ?? '';
    const parsed = parseDocument(draft);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.show).toEqual(['primary', 'goal', 'baseline_4w', 'secondary']);
    expect(draft).toContain('goal = primary * 0 + 150');
    expect(draft).toContain('baseline_4w = sum:totalVolume{}.rollup(4w)');
    expect(draft).toContain('secondary = sum:reps{}');
    expect(screen.getByTestId('widget-composer-apply').getAttribute('disabled')).toBeNull();

    await screen.findByText('primary');
    await screen.findByText('baseline_4w');
    await screen.findByText('secondary');

    fireEvent.click(screen.getByTestId('legend-chip-baseline'));
    expect(screen.getByTestId('widget-composer-wql').textContent).toContain('baseline_12w');
    expect(screen.getByRole('button', { name: 'Remove goal' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove comparison' })).toBeDefined();

    fireEvent.click(screen.getByTestId('widget-composer-apply'));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toContain('view: timeseries');
    expect(updateCalls[0]).toContain('formula: primary * 0 + 150');
    expect(updateCalls[0]).toContain('query: sum:totalVolume{}.rollup(12w)');
    expect(updateCalls[0]).toContain('query: sum:reps{}');
  });
});

describe('DashboardViewPage L3 3-slot contract', () => {
  it('publishes pure structural anchors to l3Items, Range/Units to analyticsControls, and board actions to l3Actions', async () => {
    storedRaw = HEADING_RAW;
    const capturedOutline: NavItemL3[][] = [];
    let capturedAnalytics: unknown = null;
    let capturedActions: Array<{ id: string; label: string }> = [];
    render(
      <MemoryRouter initialEntries={['/dashboard/outline-board']} initialIndex={0}>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: (items: NavItemL3[]) => capturedOutline.push(items),
            setL3Actions: (actions) => { capturedActions = actions; },
            setAnalyticsControls: (controls) => { capturedAnalytics = controls; },
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
            setContextNav: () => {},
            setStreamControls: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => {},
          }}
        >
          <Routes>
            <Route path="/dashboard/:slug" element={<DashboardViewPage />} />
          </Routes>
        </NavContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Standalone A')).toBeDefined());
    await waitFor(() => {
      const ids = capturedOutline.at(-1)?.map((item) => item.id) ?? [];
      // Slot 2 ("On this page") holds ONLY pure document/widget anchors in document order.
      expect(ids).toEqual([
        'dashboard-title', 'widget-w0', 'note-h4', 'note-h5', 'widget-w1', 'note-h9',
      ]);
    });

    // Slot 1 (Modifiers): Range + Units via AnalyticsControlsNav.
    expect(capturedAnalytics).toEqual({ showRange: true, showUnits: true });

    // Slot 3 ("Actions"): Edit, Add widget (editable vault board), Delete dashboard, Copy link.
    expect(capturedActions.map(a => a.id)).toEqual([
      'helpful-edit',
      'helpful-add-widget',
      'helpful-delete-dashboard',
      'helpful-copy-link',
    ]);

    // Every heading entry targets a rendered anchor — no fake targets.
    for (const id of ['dashboard-title', 'note-h4', 'note-h5', 'note-h9']) {
      expect(globalThis.document.getElementById(id)).not.toBeNull();
    }
  });
});
