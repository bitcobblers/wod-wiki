import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Location } from 'react-router-dom';
import { SyncSection } from './SyncSection';
import {
  PlaygroundProviderTree,
  setupPlaygroundTestHost,
  type PlaygroundHostHandle,
} from '@/testing/host';
import { resetFeedSubscriptionsForTest } from '@/services/feed/feedSubscriptions';
import type { FeedStatus } from '@/services/feed/feedSync';

const mockStatus: FeedStatus = {
  sources: [
    {
      id: 'core',
      label: 'Core Guides',
      url: 'https://seed.test/core/',
      autoImport: true,
      notebooks: [
        { id: 'guides', label: 'Guides', chunkId: 'canvas', count: 5, bytes: 500, imported: true, subscribed: true },
      ],
      stored: { version: 1, schema: 9, builtAt: '2026-10-20', importedAt: 1000 },
      remote: { version: 1, schema: 9, builtAt: '2026-10-20' },
      remoteError: null,
      upToDate: true,
      count: 5,
      bytes: 500,
      checkedAt: 1000,
      subscribed: true,
      autoSync: true,
    },
    {
      id: 'seed-crossfit',
      label: 'CrossFit',
      url: 'https://seed.test/crossfit/',
      autoImport: false,
      notebooks: [
        { id: 'games', label: 'CrossFit Games', chunkId: 'notebook.crossfit-games', count: 10, bytes: 1000, imported: false, subscribed: false },
        { id: 'heroes', label: 'Hero WODs', chunkId: 'notebook.heroes', count: 20, bytes: 2000, imported: false, subscribed: false },
      ],
      stored: null,
      remote: { version: 2, schema: 9, builtAt: '2026-10-21' },
      remoteError: null,
      upToDate: false,
      count: 30,
      bytes: 3000,
      checkedAt: 1000,
      subscribed: false,
      autoSync: false,
    },
  ],
};

const openHosts: PlaygroundHostHandle[] = [];

// SyncSection rides the real router through PlaygroundProviderTree; only the
// network-touching feed seams are injected (readFeedStatus et al.).
async function renderSync() {
  const host = await setupPlaygroundTestHost();
  openHosts.push(host);
  let location: Location | null = null;
  await act(async () => {
    render(
      <PlaygroundProviderTree route="/settings/sync" onLocationChange={(loc) => { location = loc; }}>
        <SyncSection deps={{ readFeedStatus: async () => mockStatus }} />
      </PlaygroundProviderTree>,
    );
  });
  return { host, getLocation: () => location };
}

beforeEach(() => {
  // feedSubscriptions caches its maps: drop both the persisted records and
  // the in-memory cache so each test starts unsubscribed (core stays full).
  localStorage.removeItem('wodwiki.seedSubscriptions');
  localStorage.removeItem('wodwiki.seedAutoSync');
  resetFeedSubscriptionsForTest();
});

afterEach(async () => {
  cleanup();
  resetFeedSubscriptionsForTest();
  for (const host of openHosts.splice(0)) await host.cleanup();
});

describe('SyncSection notebook subscriptions and filtering', () => {
  it('defaults to subscribed only and displays all notebooks when unchecked', async () => {
    await renderSync();

    await waitFor(() => {
      expect(screen.getByTestId('feed-source-core')).toBeTruthy();
    });

    // By default: subscribed only is checked, so seed-crossfit is not in the list
    expect(screen.queryByTestId('feed-source-seed-crossfit')).toBeNull();

    // Uncheck subscribed only -> seed-crossfit becomes visible with its notebooks
    const subToggle = screen.getByTestId('sync-subscribed-only-toggle');
    fireEvent.click(subToggle);

    await waitFor(() => {
      expect(screen.getByTestId('feed-source-seed-crossfit')).toBeTruthy();
    });
    expect(screen.getByTestId('feed-notebooks-seed-crossfit')).toBeTruthy();
    expect(screen.getByTestId('browse-notebooks-link-seed-crossfit')).toBeTruthy();
  });

  it('filters by feed selector', async () => {
    await renderSync();

    // Uncheck subscribed only so both sources are candidates
    fireEvent.click(screen.getByTestId('sync-subscribed-only-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('feed-source-seed-crossfit')).toBeTruthy();
    });

    // Filter to CrossFit only
    const select = screen.getByTestId('sync-feed-source-filter');
    fireEvent.change(select, { target: { value: 'seed-crossfit' } });

    expect(screen.getByTestId('feed-source-seed-crossfit')).toBeTruthy();
    expect(screen.queryByTestId('feed-source-core')).toBeNull();
  });

  it('renders subscription mode summary and link to Library browser', async () => {
    const { getLocation } = await renderSync();

    fireEvent.click(screen.getByTestId('sync-subscribed-only-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('browse-notebooks-link-seed-crossfit')).toBeTruthy();
    });

    expect(screen.getByTestId('feed-sub-mode-seed-crossfit').textContent).toContain('Unsubscribed');

    fireEvent.click(screen.getByTestId('browse-notebooks-link-seed-crossfit'));
    await waitFor(() => {
      expect(getLocation()?.pathname).toBe('/notebooks');
      expect(getLocation()?.search).toBe('?q=:notebook{feed:seed-crossfit,subscribed:true,false}');
    });
  });

  it('dismisses more actions menu on Escape and backdrop click', async () => {
    await renderSync();
    fireEvent.click(screen.getByTestId('sync-subscribed-only-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('feed-more-seed-crossfit')).toBeTruthy();
    });

    const details = screen.getByTestId('feed-more-seed-crossfit') as HTMLDetailsElement;
    details.open = true;
    expect(details.open).toBe(true);

    fireEvent.keyDown(details, { key: 'Escape' });
    expect(details.open).toBe(false);

    details.open = true;
    const backdrop = details.querySelector('[data-testid="feed-more-backdrop"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(details.open).toBe(false);
  })
});
