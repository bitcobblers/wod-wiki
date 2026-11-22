import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { commitReferenceNote } from '@/repositories/referenceNotes';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { SecondaryNav } from '../../nav/SecondaryNav';
import { EffortDetailPage } from '../EffortDetailPage';

describe('EffortDetailPage — header cleanup, parent breadcrumb & L3 deletion (#719)', () => {
  let host: PlaygroundRenderResult | null = null;

  afterEach(async () => {
    if (host) {
      await host.cleanup();
      cleanup();
      host = null;
    }
  });

  it('renders < Efforts parent breadcrumb, strips S3 buttons from sticky header, and hides Delete on bundled efforts', async () => {
    host = await renderWithPlaygroundHost(
      <>
        <EffortDetailPage />
        <SecondaryNav />
      </>,
      {
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
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.EFFORT_DETAIL_SOURCE).textContent).toBe('Bundled');
    });

    // Guaranteed < Efforts parent breadcrumb inside sticky header
    const header = document.querySelector('[data-page-sticky-boundary="true"]') as HTMLElement;
    expect(header).toBeTruthy();
    const breadcrumb = within(header).getByTestId(TEST_IDS.PAGE_HEADER_PARENT_BREADCRUMB);
    expect(breadcrumb.getAttribute('href')).toBe('/efforts');
    expect(breadcrumb.textContent).toContain('Efforts');

    // No standalone S3 Override/Clone/Delete buttons in sticky header
    expect(within(header).queryByRole('button', { name: /Override/i })).toBeNull();
    expect(within(header).queryByRole('button', { name: /Clone/i })).toBeNull();
    expect(within(header).queryByRole('button', { name: /Delete/i })).toBeNull();

    // Bundled actions live in L3; Delete is hidden on bundled efforts
    expect(screen.getByTestId(TEST_IDS.L3_EFFORT_OVERRIDE)).toBeTruthy();
    expect(screen.getByTestId(TEST_IDS.EFFORT_DETAIL_CLONE_BTN)).toBeTruthy();
    expect(screen.queryByTestId(TEST_IDS.EFFORT_DETAIL_DELETE_BTN)).toBeNull();
  });

  it('deletes a user custom effort from L3 danger action after confirmation and navigates back to /efforts', async () => {
    host = await renderWithPlaygroundHost(
      <>
        <EffortDetailPage />
        <SecondaryNav />
      </>,
      {
        route: '/effort/burpee',
        routePath: '/effort/:slug',
      },
    );

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
    cleanup();

    host = await renderWithPlaygroundHost(
      <>
        <EffortDetailPage />
        <SecondaryNav />
      </>,
      {
        storage: host.storage,
        route: '/effort/atlas-carry',
        routePath: '/effort/:slug',
      },
    );

    const deleteBtn = await screen.findByTestId(TEST_IDS.EFFORT_DETAIL_DELETE_BTN);
    expect(deleteBtn).toBeTruthy();

    // Delete lives in L3, not the sticky header
    const header = document.querySelector('[data-page-sticky-boundary="true"]') as HTMLElement;
    expect(within(header).queryByTestId(TEST_IDS.EFFORT_DETAIL_DELETE_BTN)).toBeNull();

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
