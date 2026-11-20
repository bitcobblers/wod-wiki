import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SessionActionContext } from '@bitcobblers/wod-wiki-ui';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { TEST_IDS } from '@/lib/testIds';
import * as queryServiceModule from '@/services/queryService';
import * as seedContentModule from '@/services/content/seedContent';
import * as useDashboardsModule from '../../hooks/useDashboards';
import { dashboardNotes } from '../../services/dashboardNotes';
import { journalNotes } from '../../services/journalNotes';
import { AddToDashboardSheet } from './AddToDashboardSheet';

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

const CONTEXT: SessionActionContext = {
  resultId: 'res-fran-1',
  noteId: 'note-fran',
  noteTitle: 'Fran',
  blockContentId: 'bc-fran',
  notebooks: ['notebook/benchmarks'],
  summary: {
    noteTitle: 'Fran',
    blockContentId: 'bc-fran',
    notebooks: ['notebook/benchmarks'],
    elapsedMs: 185_000,
    totalReps: 90,
    totalVolume: 4275,
    volumeUnit: 'lb',
    totalDistance: 0,
    distanceUnit: 'm',
    roundsCompleted: 3,
    splitCount: 6,
    efforts: ['thruster', 'pull-up'],
    movementRollup: [
      { effortSlug: 'thruster', label: 'Thruster', splits: 3, totalReps: 45, totalVolume: 4275, volumeUnit: 'lb', totalDistance: 0, totalElapsedMs: 95_000 },
      { effortSlug: 'pull-up', label: 'Pull-up', splits: 3, totalReps: 45, totalVolume: 0, volumeUnit: 'lb', totalDistance: 0, totalElapsedMs: 90_000 },
    ],
  },
};

const PREBUILT_SEED = `---
dashboard: true
title: Strength Overview
slug: strength-overview
---

# Strength Overview
`;

describe('AddToDashboardSheet', () => {
  let updatedCalls: Array<{ id: string; rawContent: string }> = [];
  let createdCalls: Array<{ title: string; rawContent: string }> = [];
  let clonedSlugs: string[] = [];

  beforeEach(() => {
    updatedCalls = [];
    createdCalls = [];
    clonedSlugs = [];

    spyOn(seedContentModule, 'useSeedContent').mockReturnValue({
      'markdown/dashboards/strength-overview.md': PREBUILT_SEED,
    });
    spyOn(useDashboardsModule, 'useDashboardList').mockReturnValue({
      items: [
        { slug: 'my-training', title: 'My Training', editable: true },
        { slug: 'strength-overview', title: 'Strength Overview', editable: false },
      ],
      loading: false,
    } as never);
    spyOn(queryServiceModule, 'setContextualPageSources').mockResolvedValue(new Map());
    spyOn(queryServiceModule.queryService, 'runQuery').mockResolvedValue({
      parsed: { family: 'aggregate', raw: 'sum:totalVolume{}', agg: 'sum', metric: 'totalVolume', filters: [], groupBy: [] },
      series: [{ key: 's', label: 's', points: [{ ts: Date.now(), value: 4275 }], unit: 'lb' }],
      stages: { selected: 1, buckets: 1, aggregated: 1, groups: 1 },
      matched: [],
    } as unknown as QueryResult);
    spyOn(queryServiceModule.queryService, 'runFind').mockResolvedValue({
      parsed: { family: 'find', raw: ':session{result:res-fran-1}', target: 'session', filters: [] },
      notes: [],
      blocks: [],
      runs: [],
      stages: { selected: 0, matched: 0 },
    } as never);

    spyOn(journalNotes, 'resolve').mockResolvedValue({
      id: 'dash-existing',
      rawContent: '---\ndashboard: true\ntitle: My Training\nslug: my-training\n---\n\n# My Training\n',
    } as never);
    spyOn(journalNotes, 'update').mockImplementation((async (note, rawContent) => {
      updatedCalls.push({ id: note.id, rawContent });
      return { ...note, rawContent };
    }) as never);
    spyOn(journalNotes, 'create').mockImplementation((async (input) => {
      createdCalls.push({ title: input.title, rawContent: input.rawContent });
      return { id: 'dash-new-1', ...input };
    }) as never);
    spyOn(dashboardNotes, 'cloneDashboard').mockImplementation((async (slug, rawContent) => {
      clonedSlugs.push(slug);
      return { id: `cloned-${slug}`, rawContent };
    }) as never);
  });

  afterEach(() => {
    cleanup();
    mock.restore();
  });

  it('configures measure/scope/token options with YAML disclosure and appends widget to existing dashboard', async () => {
    const onOpenChange = mock(() => {});
    const onNav = mock(() => {});

    render(
      <MemoryRouter>
        <AddToDashboardSheet open onOpenChange={onOpenChange} context={CONTEXT} onNavigateDashboard={onNav} />
      </MemoryRouter>,
    );

    await screen.findByTestId(TEST_IDS.ADD_DASHBOARD_SHEET);

    // Toggle YAML disclosure in Step 1
    fireEvent.click(screen.getByTestId(TEST_IDS.ADD_DASHBOARD_WQL_DISCLOSURE));
    expect(screen.getByText(/view:\s*timeseries/)).toBeDefined();

    // Advance to Step 2 and commit to existing dashboard
    fireEvent.click(screen.getByTestId(TEST_IDS.ADD_DASHBOARD_STEP_NEXT));
    fireEvent.click(await screen.findByTestId(TEST_IDS.ADD_DASHBOARD_COMMIT));

    await waitFor(() => expect(updatedCalls).toHaveLength(1));
    expect(updatedCalls[0]!.rawContent).toContain('```query');
    expect(onNav).toHaveBeenCalledWith('my-training');
  });

  it('supports Clone Prebuilt & Add destination mode', async () => {
    const onOpenChange = mock(() => {});
    const onNav = mock(() => {});

    render(
      <MemoryRouter>
        <AddToDashboardSheet open onOpenChange={onOpenChange} context={CONTEXT} onNavigateDashboard={onNav} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId(TEST_IDS.ADD_DASHBOARD_STEP_NEXT));
    fireEvent.click(screen.getByTestId(TEST_IDS.ADD_DASHBOARD_MODE_CLONE));
    fireEvent.click(screen.getByTestId(TEST_IDS.ADD_DASHBOARD_COMMIT));

    await waitFor(() => expect(clonedSlugs).toEqual(['strength-overview']));
    expect(updatedCalls).toHaveLength(1);
    expect(updatedCalls[0]!.rawContent).toContain('```query');
    expect(onNav).toHaveBeenCalledWith('strength-overview');
  });

  it('scaffolds a linked 4-panel workout dashboard in New Workout Dashboard mode', async () => {
    const onOpenChange = mock(() => {});
    const onNav = mock(() => {});

    render(
      <MemoryRouter>
        <AddToDashboardSheet open onOpenChange={onOpenChange} context={CONTEXT} onNavigateDashboard={onNav} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId(TEST_IDS.ADD_DASHBOARD_STEP_NEXT));
    fireEvent.click(screen.getByTestId(TEST_IDS.ADD_DASHBOARD_MODE_NEW));
    fireEvent.change(screen.getByTestId(TEST_IDS.ADD_DASHBOARD_NEW_TITLE), {
      target: { value: 'Fran Block Tracker' },
    });
    fireEvent.click(screen.getByTestId(TEST_IDS.ADD_DASHBOARD_COMMIT));

    await waitFor(() => expect(createdCalls).toHaveLength(1));
    expect(createdCalls[0]!.title).toBe('Fran Block Tracker');
    expect(createdCalls[0]!.rawContent).toContain('view: summary');
    expect(createdCalls[0]!.rawContent).toContain(':session{block:$block}');
    expect(createdCalls[0]!.rawContent).toContain('dashboard.block: bc-fran');
    expect(onNav).toHaveBeenCalledWith('fran-block-tracker');
  });
});
