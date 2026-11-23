import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { TEST_IDS } from '@/lib/testIds';
import { ResponsiveActionsProvider } from '../ResponsiveActions';
import { useNav, type L3ActionItem } from '../NavContext';
import { SecondaryNav } from '../SecondaryNav';
import { PlaygroundNotePage } from '../../pages/PlaygroundNotePage';

function L3ActionsProbe({ onActions }: { onActions: (items: L3ActionItem[]) => void }) {
  const { l3Actions } = useNav();
  onActions(l3Actions ?? []);
  return null;
}

describe('PlaygroundNotePage responsive action placement', () => {
  const originalMatchMedia = window.matchMedia;
  const activeHosts: PlaygroundRenderResult[] = [];

  afterEach(async () => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    for (const host of activeHosts.splice(0)) {
      await host.cleanup();
    }
  });

  function mockMobileMedia(isMobile: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: isMobile && query.includes('1023px'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  it('keeps Move to journal out of mobile ResponsiveActions overflow while preserving it in L3 Actions', async () => {
    mockMobileMedia(true);
    let latestActions: L3ActionItem[] = [];

    const host = await renderWithPlaygroundHost(
      <ResponsiveActionsProvider>
        <L3ActionsProbe onActions={(items) => { latestActions = items; }} />
        <PlaygroundNotePage theme="light" />
      </ResponsiveActionsProvider>,
      { route: '/playground' },
    );
    activeHosts.push(host);

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    await waitFor(() => {
      expect(latestActions.some(a => a.label === 'Move to journal')).toBe(true);
    });

    expect(screen.queryByRole('button', { name: 'Move to journal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Playground actions' })).toBeNull();
  });

  it('strips Move to journal from desktop sticky header and publishes it in L3 with < Playgrounds breadcrumb', async () => {
    mockMobileMedia(false);
    let latestActions: L3ActionItem[] = [];

    const host = await renderWithPlaygroundHost(
      <ResponsiveActionsProvider>
        <L3ActionsProbe onActions={(items) => { latestActions = items; }} />
        <PlaygroundNotePage theme="light" />
        <SecondaryNav />
      </ResponsiveActionsProvider>,
      { route: '/playground' },
    );
    activeHosts.push(host);

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    await waitFor(() => {
      expect(latestActions.some(a => a.label === 'Move to journal')).toBe(true);
    });

    const header = document.querySelector('[data-page-sticky-boundary="true"]') as HTMLElement;
    expect(header).toBeTruthy();
    const breadcrumb = within(header).getByTestId(TEST_IDS.PAGE_HEADER_PARENT_BREADCRUMB);
    expect(breadcrumb.getAttribute('href')).toBe('/playgrounds');
    expect(within(header).queryByRole('button', { name: 'Move to journal' })).toBeNull();

    expect(await screen.findByTestId(TEST_IDS.L3_PLAYGROUND_MOVE_JOURNAL)).toBeTruthy();
  });
});
