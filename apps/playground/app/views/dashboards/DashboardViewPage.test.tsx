import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
// Must precede the react-router-dom import: repairs the partial
// react-router-dom mock that useJournalZipProcessor.test.ts leaks
// process-wide (see tests/helpers/repair-react-router-dom.ts).
import '../../../tests/helpers/repair-react-router-dom';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { QueryResult } from '@bitcobblers/wod-wiki-engine';

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

// The store behind the mocked journalNotes — mutated directly to simulate
// a concurrent writer (another tab, another surface).
let storedRaw = DASH_RAW;
let updateCalls: string[] = [];

mock.module('../../services/journalNotes', () => ({
  journalNotes: {
    getById: mock(async () => ({ id: 'n1', rawContent: storedRaw })),
    update: mock(async (_note: { id: string }, raw: string) => {
      updateCalls.push(raw);
      storedRaw = raw;
      return { id: 'n1', rawContent: raw };
    }),
    resolve: mock(async () => ({ id: 'n1', rawContent: storedRaw })),
    create: mock(async () => { throw new Error('not used'); }),
    listByDate: mock(async () => []),
    moveToDate: mock(async () => { throw new Error('not used'); }),
    delete: mock(async () => undefined),
  },
}));

mock.module('../../services/dashboardNotes', () => ({
  dashboardNotes: {
    createDashboard: mock(async () => { throw new Error('not used'); }),
    cloneDashboard: mock(async () => { throw new Error('not used'); }),
  },
}));

function resultOf(raw: string): QueryResult {
  return {
    parsed: { family: 'aggregate', raw, agg: 'sum', metric: 'totalVolume', filters: [], groupBy: [] },
    series: [],
    stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
    matched: [],
    unit: 'reps',
  } as unknown as QueryResult;
}

mock.module('@/services/queryService', () => ({
  queryService: {
    runQuery: mock(async (raw: string) => resultOf(raw)),
    runFind: mock(async () => ({}) as never),
    runRows: mock(async () => ({}) as never),
  },
}));

import { storageService } from '@/services/storage';
storageService.countEvents = mock(async () => 1);

mock.module('@/services/analytics/sample', () => ({
  loadSampleData: mock(async () => ({ facts: 0 })),
  purgeSampleData: mock(async () => undefined),
  hasSampleData: mock(async () => false),
}));

mock.module('../../hooks/useAnalyticsRange', () => ({
  useAnalyticsRange: () => [16, () => {}],
}));

// Pass-through: the real dock registers with a provider the test doesn't mount.
mock.module('../../nav/ResponsiveActions', () => ({
  ResponsiveActions: ({ primary, children }: { primary?: unknown; children?: unknown }) => (
    <>
      {primary}
      {children}
    </>
  ),
}));

// Mirrors useDashboardSource's real transition semantics: a refreshKey bump
// flips loading to true but KEEPS the previously resolved source until the
// new resolution lands.
mock.module('../../hooks/useDashboards', () => ({
  useDashboardSource: (slug: string | undefined, refreshKey?: number) => {
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
  },
}));

import { DashboardViewPage } from './DashboardViewPage';
import { NavContext, initialNavState } from '../../nav/NavContext';
import type { NavItemL3 } from '../../nav/navTypes';

afterEach(cleanup);

beforeEach(() => {
  storedRaw = DASH_RAW;
  updateCalls = [];
});

function renderPage(slug = 'stale-board') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/${slug}`]} initialIndex={0}>
      <Routes>
        <Route path="/dashboard/:slug" element={<DashboardViewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

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

describe('DashboardViewPage L3 outline', () => {
  it('publishes real anchors for consecutive and trailing headings without lossy remapping', async () => {
    storedRaw = HEADING_RAW;
    const captured: NavItemL3[][] = [];
    render(
      <MemoryRouter initialEntries={['/dashboard/outline-board']} initialIndex={0}>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: (items: NavItemL3[]) => captured.push(items),
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
            setContextNav: () => {},
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
      const ids = captured.at(-1)?.map((item) => item.id) ?? [];
      // Document order: sticky title, titled widget, both consecutive
      // standalone headings (each its own anchor), second widget, trailing —
      // then the L3 view-control widgets and helpful actions (whiteboard:
      // on-this-page first, Edit/Clone/range/units/Copy link after).
      expect(ids).toEqual([
        'dashboard-title', 'widget-w0', 'note-h4', 'note-h5', 'widget-w1', 'note-h9',
        'dashboard-range', 'dashboard-units', 'helpful-edit', 'helpful-copy-link',
      ]);
    });

    // Every heading entry targets a rendered anchor — no fake targets.
    for (const id of ['dashboard-title', 'note-h4', 'note-h5', 'note-h9']) {
      expect(globalThis.document.getElementById(id)).not.toBeNull();
    }
  });
});
