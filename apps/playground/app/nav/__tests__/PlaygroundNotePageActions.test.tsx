import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { ResponsiveActionsProvider } from '../ResponsiveActions';
import { useNav, type L3ActionItem } from '../NavContext';
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

  it('renders Move to journal in desktop header actions', async () => {
    mockMobileMedia(false);

    const host = await renderWithPlaygroundHost(
      <ResponsiveActionsProvider>
        <PlaygroundNotePage theme="light" />
      </ResponsiveActionsProvider>,
      { route: '/playground' },
    );
    activeHosts.push(host);

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    expect(await screen.findByRole('button', { name: 'Move to journal' })).toBeTruthy();
  });
});
