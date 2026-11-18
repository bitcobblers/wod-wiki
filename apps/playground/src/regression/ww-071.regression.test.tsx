/**
 * WW-071 — Alias chips on /effort/:slug and /equipment/:slug are
 * non-interactive spans instead of links to the canonical property route.
 *
 * Expected behavior: alias chips in the frontmatter summary render as links
 * (`<a href="/effort/rowing">`) targeting the canonical property route.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

describe('WW-071 — alias chips are links on property detail pages', () => {
  it('renders /effort/rowing alias chips as links to /effort/rowing', async () => {
    host = await renderWithPlaygroundHost(<EffortDetailPage />, {
      route: '/effort/rowing',
      routePath: '/effort/:slug',
      world: {
        propertyNotes: [
          {
            kind: 'effort',
            slug: 'rowing',
            label: 'Rowing',
            aliases: ['row', 'rower', 'concept2 row'],
            baseAttributes: { met: 7 },
            seedOrigin: 'seed',
          },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.EFFORT_DETAIL_LABEL).textContent).toBe('Rowing');
    });

    const editorHost = screen.getByTestId(TEST_IDS.EFFORT_DETAIL_NOTEBOOK_EDITOR);
    await waitFor(() => {
      const link = within(editorHost).queryByRole('link', { name: 'row' });
      expect(link).not.toBeNull();
    });

    for (const alias of ['row', 'rower', 'concept2 row']) {
      const link = within(editorHost).getByRole('link', { name: alias });
      expect(link.getAttribute('href')).toMatch(/\/effort\/rowing$/);
    }
  });
});
