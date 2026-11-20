import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { FindQueryResult, QueryResult, RowsRun } from '@bitcobblers/wod-wiki-wql';
import { TEST_IDS } from '@/lib/testIds';
import { resetFeedReadinessForTest } from '@/services/feed/feedReadiness';
import * as queryServiceModule from '@/services/queryService';
import * as rpeModule from '@/services/analytics/captureSessionRpe';
import * as correctionModule from '@/services/analytics/captureMetricCorrection';
import * as seedContentModule from '@/services/content/seedContent';
import * as useDashboardsModule from '../hooks/useDashboards';
import { MainLandmark } from '@/templates/SidebarLayout';
import { SessionResultsPage } from './SessionResultsPage';

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const T0 = Date.parse('2026-10-24T10:00:00Z');

function makeSegEvent(
  id: string,
  effort: string,
  reps: number,
  loadKg: number,
  started: number,
  ended: number,
): EventRecord {
  return {
    id,
    resultId: 'res-fran-1',
    noteId: 'note-fran',
    blockId: 'wod-1',
    blockVersion: 1,
    blockContentId: 'bc-fran',
    timestamp: started,
    grain: 'event',
    outputType: 'segment',
    effortSlug: effort,
    sourceBlockKey: `blk-${id}`,
    sourceStatementId: 1,
    stackLevel: 0,
    timeSpan: { started, ended },
    metrics: [
      { type: 'effort', value: effort, origin: 'parser' },
      { type: 'rep', value: reps, unit: 'reps', origin: 'parser' },
      { type: 'weight', value: loadKg, unit: 'kg', origin: 'parser' },
      { type: 'elapsed', value: ended - started, unit: 'ms', origin: 'runtime' },
    ],
  } as EventRecord;
}

const BASE_EVENTS: EventRecord[] = [
  makeSegEvent('ev-1', 'kettlebell-swing', 21, 24, T0, T0 + 45_000),
  makeSegEvent('ev-2', 'burpee', 15, 0, T0 + 45_000, T0 + 95_000),
];

const BASE_RUN: RowsRun = {
  resultId: 'res-fran-1',
  noteId: 'note-fran',
  timestamp: T0,
  durationMs: 95_000,
  events: BASE_EVENTS,
  summary: {
    noteTitle: 'KB Fran Benchmark',
    blockContentId: 'bc-fran',
    notebooks: ['notebook/benchmarks'],
    elapsedMs: 95_000,
    totalReps: 36,
    totalVolume: 504,
    volumeUnit: 'kg',
    totalDistance: 0,
    distanceUnit: 'm',
    tis: 48,
    rpe: 8,
    roundsCompleted: 1,
    splitCount: 2,
    efforts: ['kettlebell-swing', 'burpee'],
    movementRollup: [
      {
        effortSlug: 'kettlebell-swing',
        label: 'Kettlebell Swing',
        splits: 1,
        totalReps: 21,
        bestWeight: 24,
        totalVolume: 504,
        volumeUnit: 'kg',
        totalDistance: 0,
        totalElapsedMs: 45_000,
      },
      {
        effortSlug: 'burpee',
        label: 'Burpee',
        splits: 1,
        totalReps: 15,
        totalVolume: 0,
        volumeUnit: 'kg',
        totalDistance: 0,
        totalElapsedMs: 50_000,
      },
    ],
  },
};

const PRIOR_RUN: RowsRun = {
  resultId: 'res-fran-prior',
  noteId: 'note-fran',
  timestamp: T0 - 7 * 86_400_000,
  durationMs: 112_000,
  events: [makeSegEvent('ev-prior', 'kettlebell-swing', 21, 24, T0 - 7 * 86_400_000, T0 - 7 * 86_400_000 + 60_000)],
  summary: {
    noteTitle: 'KB Fran Benchmark',
    blockContentId: 'bc-fran',
    elapsedMs: 112_000,
    totalReps: 36,
    totalVolume: 504,
    volumeUnit: 'kg',
    totalDistance: 0,
    distanceUnit: 'm',
    rpe: 9,
    roundsCompleted: 1,
    splitCount: 2,
    efforts: ['kettlebell-swing', 'burpee'],
    movementRollup: [],
  },
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MainLandmark>
        <Routes>
          <Route path="/results/:sessionId" element={<SessionResultsPage />} />
        </Routes>
      </MainLandmark>
    </MemoryRouter>,
  );
}

describe('SessionResultsPage', () => {
  beforeEach(() => {
    act(() => resetFeedReadinessForTest());
    spyOn(seedContentModule, 'useSeedContent').mockReturnValue({});
    spyOn(useDashboardsModule, 'useDashboardList').mockReturnValue({
      items: [{ slug: 'my-board', title: 'My Board', editable: true }],
      loading: false,
    } as never);
    spyOn(queryServiceModule, 'setContextualPageSources').mockResolvedValue(new Map());
    spyOn(queryServiceModule, 'clearContextualPageSources').mockImplementation(() => {});
    spyOn(rpeModule, 'captureSessionRpe').mockResolvedValue('captured');
    spyOn(correctionModule, 'clearMetricCorrection').mockResolvedValue('captured');
    spyOn(queryServiceModule.queryService, 'runQuery').mockResolvedValue({
      parsed: { family: 'aggregate', raw: 'count:rep{}', agg: 'count', metric: 'rep', filters: [], groupBy: [] },
      series: [],
      stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
      matched: [],
    } as unknown as QueryResult);
    spyOn(queryServiceModule.queryService, 'runFind').mockImplementation((async (parsed) => {
      if (parsed.raw.includes('!result:')) {
        return { parsed, notes: [], blocks: [], runs: [PRIOR_RUN], stages: { selected: 1, matched: 1 } } as FindQueryResult;
      }
      if (parsed.target === 'segment') {
        const effortFilter = parsed.filters.find((f) => f.key === 'effort')?.values[0]?.value;
        const filtered = effortFilter
          ? BASE_EVENTS.filter((ev) => ev.effortSlug === effortFilter)
          : BASE_EVENTS;
        return {
          parsed,
          notes: [],
          blocks: [],
          events: filtered,
          stages: { selected: BASE_EVENTS.length, matched: filtered.length },
        } as FindQueryResult;
      }
      if (parsed.raw.includes('missing-session')) {
        return { parsed, notes: [], blocks: [], runs: [], stages: { selected: 0, matched: 0 } } as FindQueryResult;
      }
      return {
        parsed,
        notes: [],
        blocks: [],
        runs: [BASE_RUN],
        stages: { selected: 1, matched: 1 },
      } as FindQueryResult;
    }) as never);
  });

  afterEach(() => {
    cleanup();
    mock.restore();
    act(() => resetFeedReadinessForTest());
  });

  it('renders SessionSummaryCard hero, Compare Runs history, and Spreadsheet splits on desktop', async () => {
    renderAt('/results/res-fran-1');

    const kpiStrip = await screen.findByTestId(TEST_IDS.RESULTS_SESSION_KPI_STRIP);
    expect(kpiStrip.textContent).toContain('KB Fran Benchmark');
    expect(kpiStrip.textContent).toContain('RPE 8/10');

    const table = screen.getByTestId(TEST_IDS.PROPERTY_TABLE);
    const tbody = table.querySelector('tbody')!;
    expect(tbody.textContent).toMatch(/Kettlebell Swing/i);
    expect(tbody.textContent).toMatch(/Burpee/i);

    fireEvent.click(screen.getByTestId('results-tab-compare'));
    const comparePanel = await screen.findByTestId('results-tab-panel-compare');
    expect(comparePanel.textContent).toContain('1:52');

    await waitFor(() => {
      expect(screen.getByRole('main').getAttribute('data-agent-status')).toBe('ready');
    });
  });

  it('narrows ResultsSpreadsheetGrid rows when ?q=:segment{...effort:...} is supplied', async () => {
    const q = ':segment{result:res-fran-1,effort:kettlebell-swing}';
    renderAt(`/results/res-fran-1?q=${encodeURIComponent(q)}`);

    const table = await screen.findByTestId(TEST_IDS.PROPERTY_TABLE);
    await waitFor(() => {
      const text = table.querySelector('tbody')?.textContent ?? '';
      expect(text).toMatch(/Kettlebell Swing/i);
      expect(text).not.toMatch(/Burpee/i);
    });
  });

  it('opens AddToDashboardSheet from the hero action CTA', async () => {
    renderAt('/results/res-fran-1');

    const cta = await screen.findByTestId(TEST_IDS.RESULTS_ADD_DASHBOARD_BTN);
    fireEvent.click(cta);

    const sheet = await screen.findByTestId(TEST_IDS.ADD_DASHBOARD_SHEET);
    expect(sheet).toBeDefined();
    expect(within(sheet).getByText('Visualization')).toBeDefined();
  });

  it('renders empty recovery panel and settles main data-agent-status="ready" when session is missing', async () => {
    renderAt('/results/missing-session');

    const recovery = await screen.findByTestId(TEST_IDS.RESULTS_EMPTY_RECOVERY);
    expect(recovery.textContent).toContain('missing-session');
    await waitFor(() => {
      expect(screen.getByRole('main').getAttribute('data-agent-status')).toBe('ready');
    });
  });
});
