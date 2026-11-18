/**
 * WW-070 — Scoped equipment override commits silently — no navigation to
 * /equipment/:slug?notebook=... and header 'Bundled' badge stays stale.
 *
 * Expected behavior: saving a notebook-scoped equipment override navigates to
 * /equipment/:slug?notebook=notebook/:slug and updates the source badge to Scoped.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { EquipmentDetailPage } from '../../app/pages/EquipmentDetailPage';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';

let host: PlaygroundRenderResult | null = null;

afterEach(async () => {
  if (host) {
    await host.cleanup();
    host = null;
  }
});

describe('WW-070 — scoped equipment override navigates and re-badges on save', () => {
  it('navigates to the scoped route with a Scoped badge after saving an override', async () => {
    host = await renderWithPlaygroundHost(<EquipmentDetailPage />, {
      route: '/equipment/kettlebell',
      routePath: '/equipment/:slug',
      world: {
        propertyNotes: [
          {
            kind: 'equipment',
            slug: 'kettlebell',
            label: 'Kettlebell',
            baseAttributes: { category: 'weights' },
            seedOrigin: 'seed',
          },
        ],
        notes: [
          {
            id: 'notebook/qa-override-club',
            type: 'notebook',
            title: 'QA Override Club',
            rawContent: '# QA Override Club',
          },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_SOURCE).textContent).toBe('Bundled');
    });

    fireEvent.click(screen.getByTestId('equipment-detail-override-btn'));
    const sheet = await screen.findByTestId('property-override-sheet');
    expect(sheet).toBeTruthy();

    const targetBtn = await screen.findByTestId('override-target-notebook/qa-override-club');
    fireEvent.click(targetBtn);

    await waitFor(() => {
      const loc = host!.getLocation();
      expect(`${loc.pathname}${loc.search}`).toBe(
        `/equipment/kettlebell?notebook=${encodeURIComponent('notebook/qa-override-club')}`,
      );
    });

    await waitFor(() => {
      const badge = screen.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_SOURCE).textContent ?? '';
      expect(badge).toContain('Scoped');
    });
  });
});
