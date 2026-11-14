import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { commitReferenceNote } from '@/repositories/referenceNotes';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { EffortDetailPage } from '../EffortDetailPage';

describe('EffortDetailPage — custom effort deletion (#719)', () => {
  let host: PlaygroundRenderResult | null = null;

  afterEach(async () => {
    if (host) {
      await host.cleanup();
      host = null;
    }
  });

  it('hides the Delete button on bundled efforts', async () => {
    host = await renderWithPlaygroundHost(<EffortDetailPage />, {
      route: '/effort/burpee',
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

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.EFFORT_DETAIL_SOURCE).textContent).toBe('Bundled');
    });
    expect(screen.queryByTestId(TEST_IDS.EFFORT_DETAIL_DELETE_BTN)).toBeNull();
  });

  it('deletes a user custom effort after confirmation and navigates back to /efforts', async () => {
    host = await renderWithPlaygroundHost(<EffortDetailPage />, {
      route: '/effort/burpee',
      routePath: '/effort/:slug',
    });

    await commitReferenceNote({
      kind: 'effort',
      slug: 'atlas-carry',
      title: 'Atlas Carry',
      expectedSourceRevision: 0,
      rawContent: [
        '---',
        'id: effort-user-atlas-carry',
        'slug: atlas-carry',
        'label: Atlas Carry',
        'baseAttributes:',
        '  met: 8.5',
        'registrySource: user',
        '---',
        '# Atlas Carry',
      ].join('\n'),
    });
    await host.cleanup();

    host = await renderWithPlaygroundHost(<EffortDetailPage />, {
      storage: host.storage,
      route: '/effort/atlas-carry',
      routePath: '/effort/:slug',
    });

    const deleteBtn = await screen.findByTestId(TEST_IDS.EFFORT_DETAIL_DELETE_BTN);
    expect(deleteBtn).toBeTruthy();

    fireEvent.click(deleteBtn);
    const dialog = await screen.findByTestId('effort-delete-dialog');
    expect(dialog).toBeTruthy();

    fireEvent.click(screen.getByTestId('effort-delete-confirm'));

    await waitFor(() => {
      expect(host!.getLocation().pathname).toBe('/efforts');
    });
    expect(await host.storageService.getEffort('atlas-carry')).toBeUndefined();
    expect(await host.storageService.getNote('effort/atlas-carry')).toBeUndefined();
  });
});
