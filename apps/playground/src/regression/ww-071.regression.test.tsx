/**
 * WW-071 — On /effort/:slug (e.g. /effort/rowing), alias chips must NOT
 * self-link back to /effort/rowing (a no-op self-link).
 *
 * Expected behavior: alias chips in the frontmatter summary render as
 * non-link pills/badges when they resolve to the current effort's own
 * canonical URL.
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

describe('WW-071 — alias chips do not self-link on property detail pages', () => {
  it('renders /effort/rowing alias chips as non-link pills instead of self-links to /effort/rowing', async () => {
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
      expect(within(editorHost).queryByText('row')).not.toBeNull();
    });

    for (const alias of ['row', 'rower', 'concept2 row']) {
      expect(within(editorHost).getByText(alias)).toBeTruthy();
      expect(within(editorHost).queryByRole('link', { name: alias })).toBeNull();
    }
  });
});
