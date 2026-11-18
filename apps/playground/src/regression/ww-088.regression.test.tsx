/**
 * WW-088 — Equipment detail /equipment/:slug renders no canonical backlinks
 * to related Efforts or referencing workout Notes in <main>.
 *
 * Expected behavior: EquipmentDetailPage's main content renders an inline
 * Backlinks / Used-in section linking to related Efforts and referencing Notes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

describe('WW-088 — equipment detail renders an inline backlinks section', () => {
  it('renders an inline Backlinks / Used-in section in <main> linking related effort and note', async () => {
    host = await renderWithPlaygroundHost(<EquipmentDetailPage />, {
      route: '/equipment/dumbbell',
      routePath: '/equipment/:slug',
      world: {
        propertyNotes: [
          {
            kind: 'equipment',
            slug: 'dumbbell',
            label: 'Dumbbell',
            baseAttributes: { category: 'weights' },
            seedOrigin: 'seed',
          },
          {
            kind: 'effort',
            slug: 'dumbbell-snatch',
            label: 'Dumbbell Snatch',
            baseAttributes: { equipment: ['dumbbell'] },
            seedOrigin: 'seed',
          },
        ],
        notes: [
          {
            id: 'note-dumbbell-day',
            title: 'Dumbbell Day',
            rawContent: '# Dumbbell Day\n\n```time\n10 Dumbbell Snatch 50lb\n```',
          },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_LABEL).textContent).toBe('Dumbbell');
    });

    const main = host.rendered.container.querySelector('main') ?? host.rendered.container;
    const text = main.textContent ?? '';
    expect(text).toMatch(/backlinks|used in/i);
    expect(text).toContain('Dumbbell Snatch');
    expect(text).toContain('Dumbbell Day');
  });
});
