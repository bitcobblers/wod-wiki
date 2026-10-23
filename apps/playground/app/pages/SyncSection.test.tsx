import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SyncSection } from './SyncSection';
import type { SeedStatus } from '@/services/seed/seedSync';

let subscribedSeeds = new Set<string>();
let subscribedNotebooks = new Set<string>();
let syncedSources: string[] = [];

mock.module('@/services/seed/seedSubscriptions', () => ({
  isSeedSubscribed: (id: string) => subscribedSeeds.has(id),
  isNotebookSubscribed: (seedId: string, chunkId: string) =>
    subscribedSeeds.has(seedId) || subscribedNotebooks.has(`${seedId}#${chunkId}`),
  setSeedSubscribed: (id: string, val: boolean) => {
    if (val) subscribedSeeds.add(id);
    else subscribedSeeds.delete(id);
    return true;
  },
  setNotebookSubscribed: (seedId: string, chunkId: string, val: boolean) => {
    const key = `${seedId}#${chunkId}`;
    if (val) subscribedNotebooks.add(key);
    else subscribedNotebooks.delete(key);
    return true;
  },
  isSeedAutoSync: () => false,
  setSeedAutoSync: () => true,
  subscribeSeedSubscriptions: (cb: () => void) => () => {},
}));

const mockStatus: SeedStatus = {
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
        { id: 'games', label: 'CrossFit Games', chunkId: 'collection.crossfit-games', count: 10, bytes: 1000, imported: false, subscribed: false },
        { id: 'heroes', label: 'Hero WODs', chunkId: 'collection.heroes', count: 20, bytes: 2000, imported: false, subscribed: false },
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

mock.module('@/services/seed/seedSync', () => ({
  readSeedStatus: async () => mockStatus,
  syncSeedSource: async (id: string) => {
    syncedSources.push(id);
    return 'imported';
  },
  runSeedSync: async () => 'imported',
  subscribeCatalogUpdates: () => () => {},
  unsubscribeSeedSource: async () => ({ deleted: 0 }),
  deleteSeedSource: async () => ({ deleted: 0 }),
}));

describe('SyncSection notebook subscriptions and filtering', () => {
  beforeEach(() => {
    subscribedSeeds = new Set(['core']);
    subscribedNotebooks = new Set();
    syncedSources = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to subscribed only and displays all notebooks when unchecked', async () => {
    render(<SyncSection />);

    await waitFor(() => {
      expect(screen.getByTestId('seed-source-core')).toBeTruthy();
    });

    // By default: subscribed only is checked, so seed-crossfit is not in the list
    expect(screen.queryByTestId('seed-source-seed-crossfit')).toBeNull();

    // Uncheck subscribed only -> seed-crossfit becomes visible with its notebooks
    const subToggle = screen.getByTestId('sync-subscribed-only-toggle');
    fireEvent.click(subToggle);

    await waitFor(() => {
      expect(screen.getByTestId('seed-source-seed-crossfit')).toBeTruthy();
    });
    expect(screen.getByTestId('seed-notebook-seed-crossfit-collection.crossfit-games')).toBeTruthy();
    expect(screen.getByTestId('seed-notebook-seed-crossfit-collection.heroes')).toBeTruthy();
  });

  it('filters by seed source selector', async () => {
    render(<SyncSection />);

    // Uncheck subscribed only so both sources are candidates
    fireEvent.click(screen.getByTestId('sync-subscribed-only-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('seed-source-seed-crossfit')).toBeTruthy();
    });

    // Filter to CrossFit only
    const select = screen.getByTestId('sync-seed-source-filter');
    fireEvent.change(select, { target: { value: 'seed-crossfit' } });

    expect(screen.getByTestId('seed-source-seed-crossfit')).toBeTruthy();
    expect(screen.queryByTestId('seed-source-core')).toBeNull();
  });

  it('toggles individual notebook subscription and triggers sync', async () => {
    render(<SyncSection />);

    fireEvent.click(screen.getByTestId('sync-subscribed-only-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('seed-notebook-toggle-seed-crossfit-collection.heroes')).toBeTruthy();
    });

    const toggleBtn = screen.getByTestId('seed-notebook-toggle-seed-crossfit-collection.heroes');
    expect(toggleBtn.textContent).toBe('Subscribe');

    fireEvent.click(toggleBtn);

    expect(subscribedNotebooks.has('seed-crossfit#collection.heroes')).toBe(true);
    expect(syncedSources).toContain('seed-crossfit');
  });
});
