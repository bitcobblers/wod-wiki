import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SyncSection } from './SyncSection';
import type { FeedStatus } from '@/services/feed/feedSync';

let subscribedFeeds = new Set<string>();
let subscribedNotebooks = new Set<string>();
let syncedSources: string[] = [];
const mockNavigate = mock();
mock.module('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

mock.module('@/services/feed/feedSubscriptions', () => ({
  getFeedSubscriptionMode: (id: string) => id === 'core' || subscribedFeeds.has(id) ? 'full' : subscribedNotebooks.size ? 'partial' : 'unsubscribed',
  isFeedSubscribed: (id: string) => subscribedFeeds.has(id),
  isNotebookSubscribed: (feedId: string, chunkId: string) =>
    subscribedFeeds.has(feedId) || subscribedNotebooks.has(`${feedId}#${chunkId}`),
  setFeedSubscribed: (id: string, val: boolean) => {
    if (val) subscribedFeeds.add(id);
    else subscribedFeeds.delete(id);
    return true;
  },
  setNotebookSubscribed: (feedId: string, chunkId: string, val: boolean) => {
    const key = `${feedId}#${chunkId}`;
    if (val) subscribedNotebooks.add(key);
    else subscribedNotebooks.delete(key);
    return true;
  },
  isFeedAutoSync: () => false,
  setFeedAutoSync: () => true,
  subscribeFeedSubscriptions: (cb: () => void) => () => {},
}));

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

mock.module('@/services/feed/feedSync', () => ({
  readFeedStatus: async () => mockStatus,
  syncFeedSource: async (id: string) => {
    syncedSources.push(id);
    return 'imported';
  },
  runFeedSync: async () => 'imported',
  subscribeFeedUpdates: () => () => {},
  unsubscribeFeedSource: async () => ({ deleted: 0 }),
  deleteFeedSource: async () => ({ deleted: 0 }),
}));

describe('SyncSection notebook subscriptions and filtering', () => {
  beforeEach(() => {
    subscribedFeeds = new Set(['core']);
    subscribedNotebooks = new Set();
    syncedSources = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to subscribed only and displays all notebooks when unchecked', async () => {
    render(<SyncSection />);

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
    render(<SyncSection />);

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
    render(<SyncSection />);

    fireEvent.click(screen.getByTestId('sync-subscribed-only-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('browse-notebooks-link-seed-crossfit')).toBeTruthy();
    });

    expect(screen.getByTestId('feed-sub-mode-seed-crossfit').textContent).toContain('Unsubscribed');

    fireEvent.click(screen.getByTestId('browse-notebooks-link-seed-crossfit'));
    expect(mockNavigate).toHaveBeenCalledWith('/notebooks?q=:notebook{feed:seed-crossfit,subscribed:true,false}');
  });
});
