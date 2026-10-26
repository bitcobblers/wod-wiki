import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// Must precede the react-router-dom import: repairs the partial
// react-router-dom mock that useJournalZipProcessor.test.ts leaks
// process-wide (see tests/helpers/repair-react-router-dom.ts).
import '../../../tests/helpers/repair-react-router-dom';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { parseQuery, isFindQuery, type FindQueryResult, type ParsedAggregateQuery, type ParsedFindQuery, type QueryResult } from '@bitcobblers/wod-wiki-engine';

function resultOf(raw: string): QueryResult {
  return {
    parsed: parseQuery(raw) as ParsedAggregateQuery,
    series: [],
    stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
    matched: [],
  };
}

function scalarResult(raw: string): QueryResult {
  return {
    parsed: parseQuery(raw) as ParsedAggregateQuery,
    series: [{ key: 'total', label: 'total', points: [{ ts: Date.now(), value: 42 }], unit: 'kg' }],
    stages: { selected: 1, buckets: 1, aggregated: 1, groups: 0 },
    matched: [{ timestamp: Date.now(), value: 42, metricKey: 'totalVolume' } as unknown as QueryResult['matched'][number]],
  };
}

function findResultOf(raw: string): FindQueryResult {
  return {
    parsed: parseQuery(raw) as ParsedFindQuery,
    notes: [],
    blocks: [],
    stages: { selected: 0, matched: 0 },
  };
}

// A feed note with a parseable date — feeds the date-grouped find results.
const FEED_NOTE = {
  id: 'feeds/stronglifts/2026-07-01--5x5',
  title: 'StrongLifts 5×5',
  createdAt: Date.parse('2026-07-01T10:00:00Z'),
  type: 'note',
  sourceId: 'feed:stronglifts',
  catalog: 'stronglifts',
} as unknown as FindQueryResult['notes'][number];

// Page runs carry { rangeStart, rangeEnd, preferredUnit } options; the
// diagnostics-strip executor calls runQuery(ast.raw) bare. Tests use the
// argument shape to tell the two apart (run-on-submit vs live counts).
let runQueryCalls: Array<{ raw: string; hasOptions: boolean }> = [];
let runQueryImpl = async (raw: string) => resultOf(raw);
let runFindCalls: string[] = [];
let runFindImpl = async (raw: string) => findResultOf(raw);

mock.module('@/services/queryService', () => ({
  queryService: {
    runQuery: mock(async (raw: string, options?: unknown) => {
      runQueryCalls.push({ raw, hasOptions: options !== undefined });
      return runQueryImpl(raw);
    }),
    runFind: mock(async (parsed: { raw?: string }) => {
      runFindCalls.push(parsed.raw ?? '');
      return runFindImpl(parsed.raw ?? '');
    }),
  },
}));

let sampleDataPresent = false;

mock.module('@/services/analytics/sample', () => ({
  loadSampleData: mock(async () => { sampleDataPresent = true; return { facts: 120 }; }),
  purgeSampleData: mock(async () => { sampleDataPresent = false; }),
  hasSampleData: mock(async () => sampleDataPresent),
}));

// The save flow persists through these two services; tests observe the
// writes (exact WQL, failure surface) instead of touching real storage.
let createdDashboards: Array<{ title: string; rawContent: string }> = [];
let createDashboardImpl = async (title: string) => {
  const note = { id: `dash-${createdDashboards.length + 1}`, title, rawContent: `---\ndashboard: true\ntitle: ${title}\nslug: ${title.toLowerCase()}\n---\n` };
  createdDashboards.push(note);
  return note;
};
let noteUpdates: Array<{ id: string; rawContent: string }> = [];
let updateImpl = async (id: string, rawContent: string) => {
  noteUpdates.push({ id, rawContent });
  return { id, rawContent };
};

mock.module('../../services/dashboardNotes', () => ({
  dashboardNotes: {
    createDashboard: mock(async (title?: string) => createDashboardImpl(title ?? 'New Dashboard')),
    cloneDashboard: mock(async () => ({ id: 'clone' })),
  },
}));

mock.module('../../services/journalNotes', () => ({
  journalNotes: {
    update: mock(async (id: string, rawContent: string) => updateImpl(id, rawContent)),
    resolve: mock(async () => { throw new Error('not used in these tests'); }),
    getById: mock(async () => { throw new Error('not used in these tests'); }),
    create: mock(async () => { throw new Error('not used in these tests'); }),
    listByDate: mock(async () => []),
    moveToDate: mock(async () => { throw new Error('not used in these tests'); }),
    delete: mock(async () => undefined),
  },
}));

import { AnalyticsExplorerPage } from './AnalyticsExplorerPage';

afterEach(cleanup);

let capturedNavigate: ReturnType<typeof useNavigate>;
function NavProbe() {
  capturedNavigate = useNavigate();
  return null;
}

function renderPage(initialQuery: string) {
  const suffix = initialQuery ? `?q=${encodeURIComponent(initialQuery)}` : '';
  return render(
    <MemoryRouter initialEntries={[`/analytics/explorer${suffix}`]} initialIndex={0}>
      <NavProbe />
      <AnalyticsExplorerPage />
    </MemoryRouter>,
  );
}

const pageRuns = () => runQueryCalls.filter((c) => c.hasOptions).map((c) => c.raw);

/** The widget composer's query editor: the exact-WQL textarea for
 *  non-guided drafts, otherwise the guided combobox input. */
async function composerEditor(dialog: HTMLElement): Promise<HTMLTextAreaElement | HTMLInputElement> {
  return waitFor(() => {
    const textarea = within(dialog).queryByTestId('wql-composer-wql');
    if (textarea) return textarea as HTMLTextAreaElement;
    return within(dialog).getByTestId('wql-composer-input') as HTMLInputElement;
  });
}

describe('AnalyticsExplorerPage', () => {
  beforeEach(() => {
    runQueryCalls = [];
    runFindCalls = [];
    runQueryImpl = async (raw: string) => resultOf(raw);
    runFindImpl = async (raw: string) => findResultOf(raw);
    createdDashboards = [];
    noteUpdates = [];
    createDashboardImpl = async (title: string) => {
      const note = { id: `dash-${createdDashboards.length + 1}`, title, rawContent: `---\ndashboard: true\ntitle: ${title}\nslug: ${title.toLowerCase()}\n---\n` };
      createdDashboards.push(note);
      return note;
    };
    updateImpl = async (id: string, rawContent: string) => {
      noteUpdates.push({ id, rawContent });
      return { id, rawContent };
    };
  });

  it('lands on a valid default draft — no parse error, grammar as placeholder', () => {
    renderPage('');

    // The first-visit state is calm: a seeded valid draft, not `sum:`.
    expect(screen.queryByText(/Cannot parse/)).toBeNull();
    expect(screen.getByTestId('draft-validity').textContent).toContain('valid');
    expect(screen.getByTestId('wql-composer-input').getAttribute('placeholder')).toContain('agg:metric{filters}');
  });

  it('the dashboards landing actually searches dashboards (:dashboard{} runs on landing)', async () => {
    renderPage('');
    await waitFor(() => expect(runFindCalls).toContain(':dashboard{}'));
  });

  it('a deep-linked ?q= wins over the landing search', async () => {
    renderPage('sum:totalVolume{}');
    await waitFor(() => expect(pageRuns()).toContain('sum:totalVolume{}'));
    expect(runFindCalls).not.toContain(':dashboard{}');
  });

  it('runs example deep links; the examples themselves live in the L2 panel', async () => {
    // The L2 panel deep-links analyticsExplorerPath({ q }) — the page only
    // has to run whatever ?q= carries (the semantic example match lives in
    // the panel). Empty braces drop in the clause round-trip, so this link
    // also guards restore normalization.
    renderPage('avg:tis{} by {round}');
    await waitFor(() => expect(pageRuns()).toContain('avg:tis{} by {round}'));

    // No combo remains on the page surface.
    expect(screen.queryByTestId('explorer-examples')).toBeNull();
  });

  it('hides pipeline anatomy behind the Inspect pipeline disclosure', async () => {
    renderPage('sum:totalVolume{}');
    await waitFor(() => expect(pageRuns()).toContain('sum:totalVolume{}'));

    // Collapsed by default; stage counts appear once opened.
    expect(screen.queryByTestId('pipeline-anatomy')).toBeNull();
    fireEvent.click(await waitFor(() => screen.getByTestId('inspect-pipeline')));
    await waitFor(() => expect(screen.getByTestId('pipeline-anatomy')).toBeDefined());
  });

  it('renders find results in the Library date-grouped format', async () => {
    runFindImpl = async (raw: string) => ({
      ...findResultOf(raw),
      notes: [FEED_NOTE],
      stages: { selected: 1, matched: 1 },
    });
    renderPage(':note{tags:pr,source:journal}');

    // The shared entry pipeline renders the same grouped rows as the Library.
    await waitFor(() => expect(screen.getByTestId('library-group-count').textContent).toBe('1'));
    expect(screen.getByTestId('library-row-note').textContent).toContain('StrongLifts 5×5');
  });

  it('Save seeds the composer with the exact current draft — no reconstruction', async () => {
    renderPage(':note{tags:pr,source:journal}');
    await waitFor(() => expect(screen.getByTestId('save-query')).toBeDefined());

    fireEvent.click(screen.getByTestId('save-query'));

    // Dataset: the find query is the subset (data source).
    expect(screen.getByTestId('widget-composer-subset').textContent).toContain(':note{tags:pr,source:journal}');
    // The calculation composer seeds the EXACT draft (never a sum:{}
    // reconstruction) — the live preview is what gets persisted.
    await waitFor(() => expect(screen.getByTestId('widget-composer-wql').textContent).toContain(':note{tags:pr,source:journal}'));
    // The seeded find is itself a valid table widget — Apply is ready.
    expect(screen.getByTestId('widget-composer-apply').getAttribute('disabled')).toBeNull();
    // Destination defaults to creating a new dashboard.
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-dest-new').getAttribute('aria-pressed')).toBe('true'),
    );
  });

  it('Save persists the exact composed WQL as a widget on a new dashboard', async () => {
    renderPage(':note{tags:pr,source:journal}');
    fireEvent.click(await waitFor(() => screen.getByTestId('save-query')));

    // Commit a full valid calculation through the composer, replacing the
    // exact find seed.
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    fireEvent.change(await composerEditor(dialog), { target: { value: 'sum:totalVolume{} where :note{tags:pr,source:journal}' } });
    await waitFor(() =>
      expect(screen.getByTestId('widget-composer-wql').textContent).toContain('sum:totalVolume{} where :note{tags:pr,source:journal}'),
    );

    fireEvent.change(screen.getByTestId('widget-composer-title'), { target: { value: 'PR Volume' } });
    const newTitleInput = await waitFor(() => screen.getByTestId('dashboard-new-title'));
    fireEvent.change(newTitleInput, { target: { value: 'My Board' } });
    fireEvent.click(screen.getByTestId('widget-composer-apply'));

    await waitFor(() => expect(noteUpdates.length).toBe(1));
    expect(createdDashboards[0].title).toBe('My Board');
    const raw = noteUpdates[0].rawContent;
    // The locked widget section: heading + question-less fence, exact WQL.
    expect(raw).toContain('## PR Volume');
    expect(raw).toContain('```query');
    expect(raw).toContain('sum:totalVolume{} where :note{tags:pr,source:journal}');
  });

  it('Save keeps the draft open with a visible error when persistence fails', async () => {
    updateImpl = async () => { throw new Error('quota exceeded'); };
    renderPage(':note{tags:pr,source:journal}');
    fireEvent.click(await waitFor(() => screen.getByTestId('save-query')));

    const dialog = await waitFor(() => screen.getByRole('dialog'));
    fireEvent.change(await composerEditor(dialog), { target: { value: 'sum:totalVolume{} where :note{tags:pr,source:journal}' } });
    await waitFor(() => expect(screen.getByTestId('widget-composer-apply').getAttribute('disabled')).toBeNull());

    fireEvent.click(screen.getByTestId('widget-composer-apply'));

    await waitFor(() =>
      expect(screen.getByTestId('dashboard-save-error').textContent).toContain('quota exceeded'),
    );
    // Nothing silently dropped: the dialog (and draft) is still open.
    expect(screen.getByTestId('widget-composer-apply')).toBeDefined();
    expect(noteUpdates.length).toBe(0);
  });

  it('shows the records behind a calculation as a Library-style list', async () => {
    runFindImpl = async (raw: string) => ({
      ...findResultOf(raw),
      notes: raw.includes('tags:pr') ? [FEED_NOTE] : [],
      stages: { selected: 1, matched: 1 },
    });
    renderPage('sum:totalVolume{tags:pr} by {week}');

    // Chart pipeline ran…
    await waitFor(() => expect(pageRuns()).toContain('sum:totalVolume{tags:pr} by {week}'));
    // …and the derived records query sits behind the Records disclosure.
    expect(screen.queryByTestId('records-wql')).toBeNull();
    fireEvent.click(await waitFor(() => screen.getByTestId('records-toggle')));
    // Semantic, not spelling: the derived records query is a find over the
    // chart's tags filter with a 16-week window (serialization may append
    // an explicit scope clause).
    await waitFor(() => {
      const parsed = parseQuery(screen.getByTestId('records-wql').textContent ?? '');
      expect(isFindQuery(parsed)).toBe(true);
      if (isFindQuery(parsed)) {
        expect(parsed.filters.some((f) => f.key === 'tags' && f.values.some((v) => v.value === 'pr'))).toBe(true);
        expect(parsed.window).toEqual({ kind: 'relative', size: 16, unit: 'w' });
      }
    });
    await waitFor(() => expect(screen.getByTestId('library-row-note').textContent).toContain('StrongLifts 5×5'));
  });

  it('keeps range and units in the options menu; examples are not duplicated on the page', async () => {
    renderPage('sum:totalVolume{}');
    await waitFor(() => expect(pageRuns()).toContain('sum:totalVolume{}'));

    // The options menu no longer hosts examples (they moved to the L2 panel).
    fireEvent.click(screen.getByTestId('explorer-options'));
    await waitFor(() => expect(screen.getByText('Past 4 weeks')).toBeDefined());
    expect(screen.queryByText('Weekly strength volume')).toBeNull();

    // Changing the range re-runs the submitted analytics query.
    const runsBefore = pageRuns().length;
    fireEvent.click(screen.getByText('Past 4 weeks'));
    await waitFor(() => expect(pageRuns().length).toBeGreaterThan(runsBefore));
  });

  it('renders the shared WqlComposer in place of the legacy WqlQueryComposer', () => {
    renderPage('');
    expect(screen.getByTestId('wql-composer')).toBeDefined();
    // Legacy composer markers are gone.
    expect(screen.queryByText('Composition Mode:')).toBeNull();
    expect(screen.queryByTestId('wql-query-field')).toBeNull();
  });

  it('hydrates the composer from ?q= and runs the query', async () => {
    renderPage('sum:totalVolume{discipline:strength} by {week}');

    // The draft hydrated verbatim (valid indicator, no rewrite)…
    await waitFor(() => expect(screen.getByTestId('draft-validity').textContent).toContain('valid'));
    // …and the deep-linked query ran.
    await waitFor(() => expect(pageRuns()).toContain('sum:totalVolume{discipline:strength} by {week}'));
  });

  it('updates parsed chips while editing before running the query', async () => {
    // An example query with a tag filter — the L2 panel deep-links it as ?q=.
    renderPage('sum:totalVolume{discipline:strength} by {week}');

    // The parsed chips render inside the Inspect pipeline disclosure.
    fireEvent.click(await waitFor(() => screen.getByTestId('inspect-pipeline')));

    // Wait for the initial run to complete and the filter chip to appear.
    await waitFor(() => expect(screen.queryByText('discipline:strength')).not.toBeNull());

    // Remove the filter using the composer pill; this should not submit a new query.
    fireEvent.click(screen.getByTestId('token-slot-remove-discipline'));

    // The chip should disappear immediately because the anatomy is driven by the live draft.
    await waitFor(() => expect(screen.queryByText('discipline:strength')).toBeNull());
  });

  it('runs on submit only: edits do not re-run, Run Query runs the current draft', async () => {
    renderPage('sum:totalVolume{discipline:strength} by {week}');
    await waitFor(() => expect(pageRuns()).toContain('sum:totalVolume{discipline:strength} by {week}'));

    // Edit the draft (remove the discipline filter) — no page run may follow.
    fireEvent.click(screen.getByTestId('token-slot-remove-discipline'));
    await waitFor(() => expect(screen.getByTestId('token-slot-metric')).toBeDefined());
    expect(pageRuns()).not.toContain('sum:totalVolume{} by {week}');

    // Submit via the composer-owned Run button — the page runs the edited draft.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(pageRuns()).toContain('sum:totalVolume{} by {week}'));
  });

  it('restores composer state on browser back and re-runs the restored query', async () => {
    renderPage('sum:totalVolume{discipline:strength} by {week}');
    await waitFor(() => expect(screen.getByTestId('token-slot-metric').textContent).toContain('totalVolume'));

    // The L2 panel's example row pushes the second example as a URL — same
    // history shape the promoted examples produce.
    capturedNavigate(`/dashboards?q=${encodeURIComponent('avg:tis{effort:thruster} by {week}')}`);
    await waitFor(() => expect(screen.getByTestId('token-slot-metric').textContent).toContain('tis'));

    const runsBeforeBack = pageRuns().length;

    // Back restores the previous composer state…
    capturedNavigate(-1);
    await waitFor(() => expect(screen.getByTestId('token-slot-metric').textContent).toContain('totalVolume'));
    expect(screen.getByTestId('token-slot-discipline').textContent).toContain('strength');

    // …and re-runs what it restored.
    await waitFor(() => expect(pageRuns().length).toBeGreaterThan(runsBeforeBack));
    expect(pageRuns()[pageRuns().length - 1]).toBe('sum:totalVolume{discipline:strength} by {week}');
  });

  it('meta-line metric chip selection populates the composer and submits', async () => {
    renderPage('sum:reps{}');

    fireEvent.click(await waitFor(() => screen.getByText('tis')));
    await waitFor(() => expect(screen.getByTestId('token-slot-metric').textContent).toContain('tis'));
    await waitFor(() => expect(pageRuns()).toContain('sum:tis{}'));
  });

  it('dispatches find queries through runFind', async () => {
    renderPage(':note{tags:pr,source:journal}');

    await waitFor(() => expect(runFindCalls).toContain(':note{tags:pr,source:journal}'));
    await waitFor(() => expect(screen.queryByText('No notes found.')).not.toBeNull());
  });

  it('runs a non-composer-restorable deep link (negated filter) and still shows pipeline telemetry', async () => {
    // The clause model cannot restore `!tags:fran` (wqlToClauses returns null),
    // but the query must still run and PipelineAnatomy must still appear —
    // the legacy page showed telemetry for any deep-linked q.
    renderPage('sum:totalVolume{!tags:fran}');

    await waitFor(() => expect(pageRuns()).toContain('sum:totalVolume{!tags:fran}'));
    fireEvent.click(await waitFor(() => screen.getByTestId('inspect-pipeline')));
    await waitFor(() => expect(screen.queryByText(/1\. SELECT/)).not.toBeNull());
  });

  it('empty state offers sample-data preview when store is empty', async () => {
    sampleDataPresent = false;
    renderPage('sum:totalVolume{}');

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    await waitFor(() => expect(screen.queryByText('Facts appear when you log or run workouts.')).not.toBeNull());
    expect(screen.getByText('Preview with sample data')).toBeDefined();
  });

  it('shows a purge banner when sample data is present', async () => {
    sampleDataPresent = true;

    renderPage('sum:totalVolume{}');

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    await waitFor(() => expect(screen.queryAllByText('Sample data loaded').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Purge sample data').length).toBeGreaterThan(0);
  });

  it('shows the purge banner even when the active query returns results', async () => {
    sampleDataPresent = true;
    runQueryImpl = async (raw: string) => scalarResult(raw);

    renderPage('sum:totalVolume{}');

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    await waitFor(() => expect(screen.queryByText('42')).not.toBeNull());
    await waitFor(() => expect(screen.queryAllByText('Sample data loaded').length).toBe(1));
    expect(screen.getByText('Purge sample data')).toBeDefined();
  });

  it('purges sample data from the Explorer banner and re-runs the active query', async () => {
    sampleDataPresent = true;
    runQueryImpl = async (raw: string) => scalarResult(raw);

    renderPage('sum:totalVolume{}');

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    await waitFor(() => expect(screen.queryByText('42')).not.toBeNull());

    const callsBeforePurge = runQueryCalls.length;

    const purgeButton = screen.getByText('Purge sample data');
    fireEvent.click(purgeButton);

    await waitFor(() => expect(screen.queryByText('Sample data loaded')).toBeNull());
    // Banner removal and the query re-run are separate async chains; wait on
    // the re-run itself so a slow scheduler can't lose the race.
    await waitFor(() => expect(runQueryCalls.length).toBeGreaterThan(callsBeforePurge));
  });
});
