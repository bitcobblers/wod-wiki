import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotebookLibraryBrowser } from './NotebookLibraryBrowser';

mock.module('@/hooks/useBrowserServices', () => ({
  notebookService: {
    getAllNotebooks: async () => [
      { id: 'u1', notebookId: 'my-garage-gym', slug: 'my-garage-gym', name: 'My Garage Gym', description: 'Personal garage workouts', origin: 'user' },
      { id: 'd1', notebookId: 'starter-workouts', slug: 'starter-workouts', name: 'Starter Workouts', description: 'App core starter workouts', origin: 'default' },
    ],
    delete: async () => true,
  },
}));

mock.module('@/services/feed/feedSources', () => ({
  listFeedSources: () => [
    { id: 'core', label: 'Core Reference', url: 'https://seed.test/core/', autoImport: true },
    { id: 'seed-crossfit', label: 'CrossFit', url: 'https://seed.test/crossfit/', autoImport: false },
  ],
  notebooksOfFeed: (feedId: string) =>
    feedId === 'seed-crossfit'
      ? [
          { id: 'crossfit-girls', chunkId: 'notebook.crossfit-girls', label: 'The Girls', description: 'Benchmark workouts', category: 'benchmarks', count: 20 },
          { id: 'crossfit-heroes', chunkId: 'notebook.crossfit-heroes', label: 'Hero WODs', description: 'Hero workouts', category: 'benchmarks', count: 30 },
        ]
      : [],
}));

let mockSubscribedNotebooks: Record<string, boolean> = {
  'seed-crossfit#notebook.crossfit-girls': true,
  'seed-crossfit#notebook.crossfit-heroes': false,
};

mock.module('@/services/feed/feedSubscriptions', () => ({
  getFeedSubscriptionMode: (id: string) =>
    id === 'core' ? 'full' : mockSubscribedNotebooks['seed-crossfit#notebook.crossfit-girls'] ? 'partial' : 'unsubscribed',
  isNotebookSubscribed: (feedId: string, chunkId: string) =>
    Boolean(mockSubscribedNotebooks[`${feedId}#${chunkId}`]),
  setFeedSubscribed: () => true,
  setNotebookSubscribed: () => true,
  subscribeFeedSubscriptions: () => () => {},
}));

mock.module('@/services/feed/feedStorageDefault', () => ({
  mainThreadFeedImportStorage: () => ({
    getSeedMeta: async (key: string) =>
      key === 'seed:seed-crossfit'
        ? {
            key,
            schema: 9,
            seedVersion: 10,
            builtAt: '2026-10-25',
            chunks: {
              'notebook.crossfit-girls': { sha256: 'sha1', version: 10, noteIds: ['n1', 'n2'] },
            },
          }
        : undefined,
  }),
}));

describe('NotebookLibraryBrowser component', () => {
  beforeEach(() => {
    mockSubscribedNotebooks = {
      'seed-crossfit#notebook.crossfit-girls': true,
      'seed-crossfit#notebook.crossfit-heroes': false,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders cards layout with user, core, and feed notebooks', async () => {
    render(
      <MemoryRouter>
        <NotebookLibraryBrowser
          query=":notebook{}"
          layout="cards"
          refreshKey={0}
          onChanged={() => {}}
          onQueryChange={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('notebook-card-my-garage-gym')).toBeTruthy();
      expect(screen.getByTestId('notebook-card-starter-workouts')).toBeTruthy();
      expect(screen.getByTestId('notebook-card-crossfit-girls')).toBeTruthy();
    });

    // Unsubscribed notebook is excluded under default predicate
    expect(screen.queryByTestId('notebook-card-crossfit-heroes')).toBeNull();
  });

  it('includes unsubscribed notebooks when subscribed:true,false is queried', async () => {
    render(
      <MemoryRouter>
        <NotebookLibraryBrowser
          query=":notebook{subscribed:true,false}"
          layout="cards"
          refreshKey={0}
          onChanged={() => {}}
          onQueryChange={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('notebook-card-my-garage-gym')).toBeTruthy();
      expect(screen.getByTestId('notebook-card-crossfit-girls')).toBeTruthy();
      expect(screen.getByTestId('notebook-card-crossfit-heroes')).toBeTruthy();
    });
  });

  it('renders directory table when layout="rows"', async () => {
    render(
      <MemoryRouter>
        <NotebookLibraryBrowser
          query=":notebook{subscribed:true,false}"
          layout="rows"
          refreshKey={0}
          onChanged={() => {}}
          onQueryChange={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('notebook-directory-table')).toBeTruthy();
      expect(screen.getByTestId('notebook-row-crossfit-girls')).toBeTruthy();
    });
  });
});
