/**
 * WW-038 — Invalid WQL on /dashboards destroys the rendered result pane,
 * overwrites the shareable ?q= URL, and offers no restore to the last valid query.
 *
 * Expected behavior:
 * 1. Editing the explorer draft with unparseable text must NOT rewrite ?q=.
 * 2. Landing on an invalid ?q= must NOT silently boot submitted as the broken
 *    query — it must surface an alert or restore affordance.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { useExplorerQueryState, type ExplorerQueryState } from '../../app/hooks/useExplorerQueryState';
import { AnalyticsExplorerPage } from '../../app/views/analytics/AnalyticsExplorerPage';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';

const VALID_QUERY = 'sum:totalVolume{} by {week}';
const INVALID_QUERY = ':broken{';

let host: PlaygroundRenderResult | null = null;

afterEach(async () => {
  if (host) {
    await host.cleanup();
    host = null;
  }
});

describe('WW-038 — explorer invalid-query URL protection and recovery', () => {
  it('does not overwrite ?q= with an unparseable draft', async () => {
    let captured!: ExplorerQueryState;
    function Probe() {
      captured = useExplorerQueryState({ defaultQuery: VALID_QUERY, runOnLanding: true });
      return <output data-testid="draft">{captured.draft}</output>;
    }

    host = await renderWithPlaygroundHost(<Probe />, {
      route: `/analytics/explorer?q=${encodeURIComponent(VALID_QUERY)}`,
      routePath: '/analytics/explorer',
    });

    expect(new URLSearchParams(host.getLocation().search).get('q')).toBe(VALID_QUERY);

    act(() => {
      captured.setDraft(INVALID_QUERY);
    });

    // Give effects a tick to settle, then assert ?q= still holds the valid query.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(new URLSearchParams(host.getLocation().search).get('q')).toBe(VALID_QUERY);
  });

  it('surfaces an alert or restore affordance when landing on an invalid ?q=', async () => {
    host = await renderWithPlaygroundHost(<AnalyticsExplorerPage />, {
      route: `/analytics/explorer?q=${encodeURIComponent(INVALID_QUERY)}`,
      routePath: '/analytics/explorer',
    });

    await waitFor(() => {
      const hasAlert = screen.queryAllByRole('alert').length > 0;
      const hasStale = screen.queryByTestId('explorer-results-stale') !== null;
      const hasRestore = screen.queryByRole('button', { name: /restore/i }) !== null;
      expect(hasAlert || hasStale || hasRestore).toBe(true);
    });
  });
});
