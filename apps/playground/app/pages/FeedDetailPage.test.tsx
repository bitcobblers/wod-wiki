import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  PlaygroundProviderTree,
  setupPlaygroundTestHost,
  type PlaygroundHostHandle,
} from '@/testing/host';
import {
  resetFeedSubscriptionsForTest,
  setFeedSubscribed,
} from '@/services/feed/feedSubscriptions';
import type { FeedSyncOutcome } from '@/services/feed/feedSync';
import { useNav, type L3ActionItem } from '../nav/NavContext';
import { FeedDetailPage } from './FeedDetailPage';

function L3ActionProbe({ onActions }: { onActions: (items: L3ActionItem[]) => void }) {
  const { l3Actions } = useNav();
  onActions(l3Actions ?? []);
  return null;
}

describe('FeedDetailPage Subscribe/Unsubscribe affordances (WW-014)', () => {
  let host: PlaygroundHostHandle | null = null;

  beforeEach(async () => {
    localStorage.removeItem('wodwiki.seedSubscriptions');
    localStorage.removeItem('wodwiki.seedAutoSync');
    resetFeedSubscriptionsForTest();
    host = await setupPlaygroundTestHost();
  });

  afterEach(async () => {
    cleanup();
    localStorage.removeItem('wodwiki.seedSubscriptions');
    localStorage.removeItem('wodwiki.seedAutoSync');
    resetFeedSubscriptionsForTest();
    if (host) {
      await host.cleanup();
      host = null;
    }
  });

  it('shows pending state while subscribing and toggles header + L3 actions to Unsubscribe', async () => {
    let resolveSync!: (outcome: FeedSyncOutcome) => void;
    let syncCalls = 0;
    let latestL3: L3ActionItem[] = [];

    await act(async () => {
      render(
        <PlaygroundProviderTree route="/feed/sport-hyrox">
          <L3ActionProbe onActions={(items) => { latestL3 = items; }} />
          <FeedDetailPage
            feedSlug="sport-hyrox"
            deps={{
              syncFeedSource: async (id) => {
                syncCalls += 1;
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
        </PlaygroundProviderTree>,
      );
    });

    const subscribeBtn = screen.getByTestId('feed-detail-subscribe-button') as HTMLButtonElement;
    expect(subscribeBtn.textContent).toContain('Subscribe');
    expect(subscribeBtn.disabled).toBe(false);
    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Not subscribed');
    expect(latestL3.some((a) => a.label === 'Subscribe')).toBe(true);

    fireEvent.click(subscribeBtn);

    await waitFor(() => {
      expect(subscribeBtn.disabled).toBe(true);
    });
    expect(subscribeBtn.getAttribute('aria-busy')).toBe('true');
    expect(subscribeBtn.textContent).toContain('Subscribing…');
    expect(syncCalls).toBe(1);

    await act(async () => {
      resolveSync('imported');
    });

    await waitFor(() => {
      expect(screen.getByTestId('feed-detail-unsubscribe-button')).toBeTruthy();
    });
    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Subscribed');
    expect(latestL3.some((a) => a.label === 'Unsubscribe')).toBe(true);
    expect(latestL3.some((a) => a.label === 'Subscribe')).toBe(false);
  });

  it('guards Unsubscribe with confirmation and restores Subscribe state when confirmed', async () => {
    setFeedSubscribed('sport-hyrox', true);
    const confirmMessages: string[] = [];
    let allowConfirm = false;
    let unsubCalls = 0;
    let latestL3: L3ActionItem[] = [];

    await act(async () => {
      render(
        <PlaygroundProviderTree route="/feed/sport-hyrox">
          <L3ActionProbe onActions={(items) => { latestL3 = items; }} />
          <FeedDetailPage
            feedSlug="sport-hyrox"
            deps={{
              confirm: (msg) => {
                confirmMessages.push(msg);
                return allowConfirm;
              },
              unsubscribeFeedSource: async (id) => {
                unsubCalls += 1;
                setFeedSubscribed(id, false);
                return { deleted: 14 };
              },
            }}
          />
        </PlaygroundProviderTree>,
      );
    });

    const unsubBtn = screen.getByTestId('feed-detail-unsubscribe-button');
    fireEvent.click(unsubBtn);

    expect(confirmMessages.length).toBe(1);
    expect(confirmMessages[0]).toContain('HYROX');
    expect(unsubCalls).toBe(0);
    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Subscribed');

    // Now allow confirmation via L3 Page options action
    allowConfirm = true;
    const l3Unsub = latestL3.find((a) => a.label === 'Unsubscribe');
    expect(l3Unsub).toBeDefined();

    await act(async () => {
      l3Unsub!.onRun();
    });

    await waitFor(() => {
      expect(screen.getByTestId('feed-detail-subscribe-button')).toBeTruthy();
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
        </PlaygroundProviderTree>,
      );
    });

    expect(screen.getByTestId('feed-detail-subscription-status').textContent).toContain('Subscribed');
    expect(screen.queryByTestId('feed-detail-subscribe-button')).toBeNull();
    expect(screen.queryByTestId('feed-detail-unsubscribe-button')).toBeNull();
    expect(latestL3.some((a) => a.label === 'Unsubscribe')).toBe(false);
  });
});
