import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Location } from 'react-router-dom';
import { SyncSection, type SyncSectionDeps } from './SyncSection';
import {
  PlaygroundProviderTree,
  setupPlaygroundTestHost,
  type PlaygroundHostHandle,
} from '@/testing/host';
import { resetFeedSubscriptionsForTest } from '@/services/feed/feedSubscriptions';
import { customFeedSources } from '@/services/feed/feedSources';
import type { FeedStatus } from '@/services/feed/feedSync';
import type { ProbedFeedManifest } from '@/services/feed/feedCatalog';

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
}

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
      offlinePolicy: 'offline-full',
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
        { id: 'games', label: 'CrossFit Games', chunkId: 'notebook.crossfit-games', count: 10, bytes: 1000, indexBytes: 256, chunkBytes: 4096, imported: false, subscribed: false },
        { id: 'heroes', label: 'Hero WODs', chunkId: 'notebook.heroes', count: 20, bytes: 2000, indexBytes: 512, chunkBytes: 8192, imported: false, subscribed: false },
      ],
      stored: null,
      remote: { version: 2, schema: 10, builtAt: '2026-10-21' },
      remoteError: null,
      upToDate: false,
      count: 30,
      bytes: 3000,
      indexBytes: 768,
      chunkBytes: 12288,
      hasOfflineChunks: true,
      offlinePolicy: 'index-only',
      checkedAt: 1000,
      subscribed: false,
      autoSync: false,
    },
  ],
};

const openHosts: PlaygroundHostHandle[] = [];

async function renderSync(extraDeps: Partial<SyncSectionDeps> = {}) {
  const host = await setupPlaygroundTestHost();
  openHosts.push(host);
  let location: Location | null = null;
  await act(async () => {
    render(
      <PlaygroundProviderTree route="/settings/sync" onLocationChange={(loc) => { location = loc; }}>
        <SyncSection deps={{ readFeedStatus: async () => mockStatus, ...extraDeps }} />
      </PlaygroundProviderTree>,
    );
  });
  return { host, getLocation: () => location };
}

beforeEach(() => {
  localStorage.removeItem('wodwiki.seedSubscriptions');
  localStorage.removeItem('wodwiki.seedAutoSync');
  localStorage.removeItem('wodwiki.seedSources');
  resetFeedSubscriptionsForTest();
});

afterEach(async () => {
  vi.restoreAllMocks();
  cleanup();
  resetFeedSubscriptionsForTest();
  for (const host of openHosts.splice(0)) await host.cleanup();
});

describe('SyncSection notebook subscriptions, filtering, probing, and confirmation', () => {
  it('defaults Subscribed only to false so available feeds are immediately visible, and filters when checked', async () => {
    await renderSync();

    await waitFor(() => {
      expect(screen.getByTestId('feed-source-core')).toBeTruthy();
      expect(screen.getByTestId('feed-source-seed-crossfit')).toBeTruthy();
    });

    const subToggle = screen.getByTestId('sync-subscribed-only-toggle') as HTMLInputElement;
    expect(subToggle.checked).toBe(false);

    // Check subscribed only -> unsubscribed seed-crossfit drops out
    fireEvent.click(subToggle);
    expect(screen.queryByTestId('feed-source-seed-crossfit')).toBeNull();
    expect(screen.getByTestId('feed-source-core')).toBeTruthy();
  });

  it('filters by feed selector and wires per-notebook toggle subscriptions', async () => {
    const toggleNotebookSpy = vi.fn().mockResolvedValue({ outcome: 'imported' });
    await renderSync({ toggleNotebookSubscription: toggleNotebookSpy });

    await waitFor(() => {
      expect(screen.getByTestId('feed-source-seed-crossfit')).toBeTruthy();
    });

    const select = screen.getByTestId('sync-feed-source-filter');
    fireEvent.change(select, { target: { value: 'seed-crossfit' } });

    expect(screen.getByTestId('feed-source-seed-crossfit')).toBeTruthy();
    expect(screen.queryByTestId('feed-source-core')).toBeNull();

    const gamesToggle = screen.getByTestId('feed-notebook-toggle-seed-crossfit-notebook.crossfit-games');
    await act(async () => {
      fireEvent.click(gamesToggle);
    });
    expect(toggleNotebookSpy).toHaveBeenCalledWith('seed-crossfit', 'notebook.crossfit-games', true);
  });

  it('renders flat subscription mode summary without nested card border and links to Library browser', async () => {
    const { getLocation } = await renderSync();

    await waitFor(() => {
      expect(screen.getByTestId('browse-notebooks-link-seed-crossfit')).toBeTruthy();
    });

    const notebookSection = screen.getByTestId('feed-notebooks-seed-crossfit');
    expect(notebookSection.className).not.toContain('rounded-lg border');
    expect(screen.getByTestId('feed-sub-mode-seed-crossfit').textContent).toContain('Unsubscribed');

    fireEvent.click(screen.getByTestId('browse-notebooks-link-seed-crossfit'));
    await waitFor(() => {
      expect(getLocation()?.pathname).toBe('/notebooks');
      expect(getLocation()?.search).toBe('?q=:notebook{feed:seed-crossfit,subscribed:true,false}');
    });
  });

  it('dismisses more actions menu on Escape and backdrop click', async () => {
    await renderSync();
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
  });

  it('shows Subscribing… pending state and aria-busy while subscribe sync is in flight (WW-086)', async () => {
    let resolveSub!: (v: 'imported') => void;
    const subscribeFeed = () => new Promise<'imported'>((resolve) => { resolveSub = resolve; });
    await renderSync({ subscribeFeed: subscribeFeed as never });

    const btn = await screen.findByTestId('feed-subscribe-seed-crossfit');
    fireEvent.click(btn);

    await waitFor(() => {
      const activeBtn = screen.getByTestId('feed-subscribe-seed-crossfit') as HTMLButtonElement;
      expect(activeBtn.disabled).toBe(true);
      expect(activeBtn.getAttribute('aria-busy')).toBe('true');
      expect(activeBtn.textContent).toContain('Subscribing…');
    });

    await act(async () => {
      resolveSub('imported');
    });
  });

  it('probes custom feed URL in Add a Source before persisting, and refuses broken URLs', async () => {
    const probeSpy = vi.fn<() => Promise<ProbedFeedManifest>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        url: 'https://valid.example.org/feed/',
        manifest: {
          name: 'Valid Coach Feed',
          schema: 10,
          version: 1,
          builtAt: '2026-11-20T00:00:00.000Z',
          chunks: [],
          notebooks: [
            {
              notebookId: 'notebook.coach',
              label: 'Coach Picks',
              indexPath: 'indexes/notebooks/notebook.coach.json',
              version: 1,
              commit: 'c1',
              builtAt: '2026-11-20T00:00:00.000Z',
              sha256: '1'.repeat(64),
              bytes: 256,
              indexBytes: 256,
              count: 5,
            },
          ],
        },
        name: 'Valid Coach Feed',
        version: 1,
        schema: 10,
        builtAt: '2026-11-20T00:00:00.000Z',
        notebooks: [
          {
            notebookId: 'notebook.coach',
            label: 'Coach Picks',
            indexPath: 'indexes/notebooks/notebook.coach.json',
            version: 1,
            commit: 'c1',
            builtAt: '2026-11-20T00:00:00.000Z',
            sha256: '1'.repeat(64),
            bytes: 256,
            indexBytes: 256,
            count: 5,
          },
        ],
        notebookCount: 1,
        itemCount: 5,
        indexBytes: 256,
        chunkBytes: 0,
        hasOfflineChunks: false,
      });

    await renderSync({ probeFeedManifest: probeSpy });

    const urlInput = screen.getByLabelText('Feed directory URL');
    fireEvent.change(urlInput, { target: { value: 'https://broken.example.org/feed/' } });
    fireEvent.click(screen.getByTestId('feed-add-button'));

    const errBox = await screen.findByTestId('feed-add-error');
    expect(errBox.textContent).not.toContain('Failed to fetch');
    expect(customFeedSources()).toHaveLength(0);

    fireEvent.change(urlInput, { target: { value: 'https://valid.example.org/feed/' } });
    fireEvent.click(screen.getByTestId('feed-add-button'));

    const preview = await screen.findByTestId('unknown-feed-intake-banner');
    expect(preview.textContent).toContain('Valid Coach Feed');
    expect(preview.textContent).toContain('Coach Picks');
    // Still not persisted until user clicks Subscribe!
    expect(customFeedSources()).toHaveLength(0);
  });

  it('guards Unsubscribe with EditorDialog reassuring that logged sessions stay pinned', async () => {
    const subscribedStatus: FeedStatus = {
      sources: [
        mockStatus.sources[0]!,
        { ...mockStatus.sources[1]!, subscribed: true },
      ],
    };
    const unsubSpy = vi.fn().mockResolvedValue({ deleted: 12, preservedPinned: 3 });

    await renderSync({
      readFeedStatus: async () => subscribedStatus,
      unsubscribeFeedSource: unsubSpy,
    });

    const unsubBtn = await screen.findByTestId('feed-unsubscribe-seed-crossfit');
    fireEvent.click(unsubBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/remain safely pinned locally and will not be deleted/i)).toBeTruthy();
    expect(unsubSpy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unsubscribe' }));
    await waitFor(() => {
      expect(unsubSpy).toHaveBeenCalledWith('seed-crossfit');
    });
  });
});
