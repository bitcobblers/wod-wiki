import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { TEST_IDS } from '@/lib/testIds';
import * as queryServiceModule from '@/services/queryService';
import * as seedContentModule from '@/services/content/seedContent';
import * as useDashboardsModule from '../../hooks/useDashboards';
import { dashboardNotes } from '../../services/dashboardNotes';
import { journalNotes } from '../../services/journalNotes';
import { QueryToDashboardDialog } from './QueryToDashboardDialog';

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

const PREBUILT_RAW = `---
dashboard: true
title: Conditioning Trends
slug: conditioning-trends
---

# Conditioning Trends
`;

describe('QueryToDashboardDialog — prebuilt Clone & add', () => {
  let clonedSlugs: string[] = [];
  let updatedContent = '';

  beforeEach(() => {
    clonedSlugs = [];
    updatedContent = '';

    spyOn(seedContentModule, 'useSeedContent').mockReturnValue({
      'markdown/dashboards/conditioning-trends.md': PREBUILT_RAW,
    });
    spyOn(useDashboardsModule, 'useDashboardList').mockReturnValue({
      items: [{ slug: 'conditioning-trends', title: 'Conditioning Trends', editable: false }],
      loading: false,
    } as never);
    spyOn(queryServiceModule.queryService, 'runQuery').mockResolvedValue({
      parsed: { family: 'aggregate', raw: 'sum:totalVolume{} by {week}', agg: 'sum', metric: 'totalVolume', filters: [], groupBy: ['week'] },
      series: [{ key: 's', label: 's', points: [{ ts: Date.now(), value: 1200 }], unit: 'lb' }],
      stages: { selected: 1, buckets: 1, aggregated: 1, groups: 1 },
      matched: [],
    } as unknown as QueryResult);
    spyOn(dashboardNotes, 'cloneDashboard').mockImplementation((async (slug, rawContent) => {
      clonedSlugs.push(slug);
      return { id: `clone-${slug}`, rawContent };
    }) as never);
    spyOn(journalNotes, 'update').mockImplementation((async (note, rawContent) => {
      updatedContent = rawContent;
      return { ...note, rawContent };
    }) as never);
  });

  afterEach(() => {
    cleanup();
    mock.restore();
  });

  it('clones a prebuilt seed dashboard and appends the composed widget', async () => {
    const onOpenChange = mock(() => {});
    render(
      <MemoryRouter>
        <QueryToDashboardDialog
          open
          onOpenChange={onOpenChange}
          initialQuery="sum:totalVolume{} by {week}"
          subsetQuery={null}
        />
      </MemoryRouter>,
    );

    const cloneBtn = await screen.findByTestId(TEST_IDS.DASHBOARD_DEST_CLONE);
    fireEvent.click(cloneBtn);

    fireEvent.click(screen.getByTestId(TEST_IDS.WIDGET_COMPOSER_APPLY));

    await waitFor(() => expect(clonedSlugs).toEqual(['conditioning-trends']));
    expect(updatedContent).toContain('```query');
    expect(updatedContent).toContain('sum:totalVolume{} by {week}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
