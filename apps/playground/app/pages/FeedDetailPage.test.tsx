import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  PlaygroundProviderTree,
  setupPlaygroundTestHost,
  type PlaygroundHostHandle,
} from '@/testing/host';
import {
  resetFeedSubscriptionsForTest,
  setFeedOfflinePolicy,
  setFeedSubscribed,
} from '@/services/feed/feedSubscriptions';
import { addCustomFeedSource } from '@/services/feed/feedSources';
import { saveFeedCatalogManifest } from '@/services/feed/feedCatalog';
import type { FeedSyncOutcome } from '@/services/feed/feedSync';
import type { SeedManifest } from '@bitcobblers/wod-wiki-engine';
import { TEST_IDS } from '@/lib/testIds';
import { useNav, type L3ActionItem } from '../nav/NavContext';
import { SecondaryNav } from '../nav/SecondaryNav';
import { FeedDetailPage } from './FeedDetailPage';

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
}

function L3ActionProbe({ onActions }: { onActions: (items: L3ActionItem[]) => void }) {
  const { l3Actions } = useNav();
  onActions(l3Actions ?? []);
  return null;
}

describe('FeedDetailPage Subscribe/Unsubscribe, Manifest Notebooks & Offline Download (WW-014)', () => {
  let host: PlaygroundHostHandle | null = null;

  beforeEach(async () => {
    localStorage.removeItem('wodwiki.seedSubscriptions');
    localStorage.removeItem('wodwiki.seedAutoSync');
    localStorage.removeItem('wodwiki.seedSources');
    resetFeedSubscriptionsForTest();
    host = await setupPlaygroundTestHost();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.removeItem('wodwiki.seedSubscriptions');
    localStorage.removeItem('wodwiki.seedAutoSync');
    localStorage.removeItem('wodwiki.seedSources');
    resetFeedSubscriptionsForTest();
    if (host) {
      await host.cleanup();
      host = null;
    }
  });

  it('shows pending state while subscribing index-first via L3 and keeps StickyPageHeader free of standalone S3 actions', async () => {
    let resolveSync!: (outcome: FeedSyncOutcome) => void;
    let subscribeCalls = 0;
    let latestL3: L3ActionItem[] = [];

    await act(async () => {
      render(
        <PlaygroundProviderTree route="/feed/sport-hyrox">
          <L3ActionProbe onActions={(items) => { latestL3 = items; }} />
          <FeedDetailPage
            feedSlug="sport-hyrox"
            deps={{
              probeFeedManifest: vi.fn().mockRejectedValue(new Error('offline')) as never,
              subscribeFeed: async (id) => {
                subscribeCalls += 1;
                const outcome = await new Promise<FeedSyncOutcome>((res) => {
                  resolveSync = res;
                });
                if (outcome === 'imported' || outcome === 'current') {
                  setFeedSubscribed(id, true);
                }
                return outcome;
              },
            }}
          />
          <SecondaryNav />
        </PlaygroundProviderTree>,
      );
    });

    // Sticky header carries < Feeds parent breadcrumb and zero standalone S3 buttons
    const header = document.querySelector('[data-page-sticky-boundary="true"]') as HTMLElement;
    expect(header).toBeTruthy();
    const breadcrumb = within(header).getByTestId(TEST_IDS.PAGE_HEADER_PARENT_BREADCRUMB);
    expect(breadcrumb.getAttribute('href')).toBe('/feeds');
    expect(within(header).queryByTestId(TEST_IDS.FEED_DETAIL_SUBSCRIBE_BUTTON)).toBeNull();

    const subscribeBtn = screen.getByTestId(TEST_IDS.FEED_DETAIL_SUBSCRIBE_BUTTON) as HTMLButtonElement;
    expect(subscribeBtn.textContent).toContain('Subscribe');
    expect(subscribeBtn.disabled).toBe(false);
    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Not subscribed');
    expect(latestL3.some((a) => a.label === 'Subscribe')).toBe(true);

    fireEvent.click(subscribeBtn);

    await waitFor(() => {
      expect(subscribeBtn.disabled).toBe(true);
    });
    expect(subscribeBtn.textContent).toContain('Subscribing…');
    expect(subscribeCalls).toBe(1);

    await act(async () => {
      resolveSync('imported');
    });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.L3_FEED_UNSUBSCRIBE)).toBeTruthy();
    });
    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Subscribed');
    expect(screen.getByText('Index-only')).toBeTruthy();
    expect(screen.getByTestId(TEST_IDS.L3_FEED_DOWNLOAD_OFFLINE)).toBeTruthy();
    expect(latestL3.some((a) => a.label === 'Unsubscribe')).toBe(true);
    expect(latestL3.some((a) => a.label === 'Subscribe')).toBe(false);
  });

  it('lists real notebooks from cached custom feed manifest (never a bogus placeholder) and supports Download offline via L3', async () => {
    const added = addCustomFeedSource('Strength Gym', 'https://gym.example.org/feed/');
    const manifest: SeedManifest = {
      name: 'Strength Gym',
      description: 'Barbell & conditioning cycles',
      schema: 10,
      version: 3,
      builtAt: '2026-11-20T00:00:00.000Z',
      chunkBytes: 8192,
      chunks: [
        { id: 'notebook.strength-cycle', path: 'chunks/notebook.strength-cycle.json', sha256: 'a'.repeat(64), bytes: 4096, count: 12 },
        { id: 'notebook.gpp-blocks', path: 'chunks/notebook.gpp-blocks.json', sha256: 'b'.repeat(64), bytes: 4096, count: 9 },
      ],
      notebooks: [
        {
          notebookId: 'notebook.strength-cycle',
          label: 'Strength Cycle',
          indexPath: 'indexes/notebooks/notebook.strength-cycle.json',
          version: 3,
          commit: 'c1',
          builtAt: '2026-11-20T00:00:00.000Z',
          sha256: 'a'.repeat(64),
          bytes: 512,
          chunkBytes: 4096,
          count: 12,
        },
        {
          notebookId: 'notebook.gpp-blocks',
          label: 'GPP Conditioning',
          indexPath: 'indexes/notebooks/notebook.gpp-blocks.json',
          version: 3,
          commit: 'c1',
          builtAt: '2026-11-20T00:00:00.000Z',
          sha256: 'b'.repeat(64),
          bytes: 512,
          chunkBytes: 4096,
          count: 9,
        },
      ],
    };
    await saveFeedCatalogManifest(added.id, manifest, host!.storage);
    setFeedSubscribed(added.id, true);
    setFeedOfflinePolicy(added.id, 'index-only');

    let downloadCalls = 0;
    await act(async () => {
      render(
        <PlaygroundProviderTree route={`/feed/${added.id}`}>
          <FeedDetailPage
            feedSlug={added.id}
            deps={{
              downloadFeedOffline: async (id) => {
                downloadCalls += 1;
                setFeedOfflinePolicy(id, 'offline-full');
                return 'imported';
              },
            }}
          />
          <SecondaryNav />
        </PlaygroundProviderTree>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Strength Cycle')).toBeTruthy();
      expect(screen.getByText('GPP Conditioning')).toBeTruthy();
    });
    expect(screen.getByText('12 items')).toBeTruthy();
    expect(screen.getByText('9 items')).toBeTruthy();

    // Card links must opt out of link underlines cleanly
    const strengthLink = screen.getByText('Strength Cycle').closest('a')!;
    expect(strengthLink.className).toContain('no-underline');
    expect(strengthLink.getAttribute('href')).toContain(`/notebook/strength-cycle?feed=${added.id}`);

    const dlBtn = screen.getByTestId(TEST_IDS.L3_FEED_DOWNLOAD_OFFLINE);
    expect(dlBtn.textContent).toContain('8.0 KB');
    await act(async () => {
      fireEvent.click(dlBtn);
    });
    expect(downloadCalls).toBe(1);
  });

  it('guards Unsubscribe with accessible EditorDialog reassuring about pinned sessions and restores Subscribe state', async () => {
    setFeedSubscribed('sport-hyrox', true);
    let unsubCalls = 0;
    let latestL3: L3ActionItem[] = [];

    await act(async () => {
      render(
        <PlaygroundProviderTree route="/feed/sport-hyrox">
          <L3ActionProbe onActions={(items) => { latestL3 = items; }} />
          <FeedDetailPage
            feedSlug="sport-hyrox"
            deps={{
              probeFeedManifest: vi.fn().mockRejectedValue(new Error('offline')) as never,
              unsubscribeFeedSource: async (id) => {
                unsubCalls += 1;
                setFeedSubscribed(id, false);
                return { deleted: 14, preservedPinned: 2 };
              },
            }}
          />
          <SecondaryNav />
        </PlaygroundProviderTree>,
      );
    });

    const unsubBtn = screen.getByTestId(TEST_IDS.L3_FEED_UNSUBSCRIBE);
    fireEvent.click(unsubBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/remain safely pinned locally and will not be deleted/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(unsubCalls).toBe(0);
    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Subscribed');

    // Now confirm via L3 Page options action
    const l3Unsub = latestL3.find((a) => a.label === 'Unsubscribe');
    expect(l3Unsub).toBeDefined();
    await act(async () => {
      l3Unsub!.onRun();
    });

    const confirmDialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Unsubscribe' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.FEED_DETAIL_SUBSCRIBE_BUTTON)).toBeTruthy();
    });
    expect(unsubCalls).toBe(1);
    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Not subscribed');
  });

  it('protects core feed from unsubscribing', async () => {
    let latestL3: L3ActionItem[] = [];

    await act(async () => {
      render(
        <PlaygroundProviderTree route="/feed/core">
          <L3ActionProbe onActions={(items) => { latestL3 = items; }} />
          <FeedDetailPage feedSlug="core" />
          <SecondaryNav />
        </PlaygroundProviderTree>,
      );
    });

    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Subscribed');
    expect(screen.queryByTestId(TEST_IDS.FEED_DETAIL_SUBSCRIBE_BUTTON)).toBeNull();
    expect(screen.queryByTestId(TEST_IDS.L3_FEED_UNSUBSCRIBE)).toBeNull();
    expect(latestL3.some((a) => a.label === 'Unsubscribe')).toBe(false);
  });
});
