/**
 * WW-091 — Link-as-Alias target <select> renders 0 options on cold load —
 * Confirm Link permanently disabled.
 *
 * Expected behavior: cold-loading an unknown /effort/:slug hydrates the
 * effort registry and populates the Link-as-Alias target <select> with
 * registered efforts (including 'burpee').
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { EffortDetailPage } from '../../app/pages/EffortDetailPage';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';

let host: PlaygroundRenderResult | null = null;

afterEach(async () => {
  if (host) {
    await host.cleanup();
    host = null;
  }
});

describe('WW-091 — Link-as-Alias picker on cold load', () => {
  it('populates target effort options when cold-loading an unknown slug', async () => {
    host = await renderWithPlaygroundHost(<EffortDetailPage />, {
      route: '/effort/never-registered-qa',
      routePath: '/effort/:slug',
      world: {
        propertyNotes: [
          {
            kind: 'effort',
            slug: 'burpee',
            label: 'Burpee',
            baseAttributes: { met: 8 },
            seedOrigin: 'seed',
          },
        ],
      },
    });

    const notFound = await screen.findByTestId(TEST_IDS.EFFORT_NOT_FOUND);
    expect(notFound).toBeTruthy();

    fireEvent.click(screen.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_BTN));
    const select = await screen.findByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_SELECT);

    await waitFor(() => {
      const options = Array.from(select.querySelectorAll('option'));
      expect(options.length).toBeGreaterThan(0);
      expect(options.some((opt) => opt.getAttribute('value') === 'burpee')).toBe(true);
    });
  });
});
