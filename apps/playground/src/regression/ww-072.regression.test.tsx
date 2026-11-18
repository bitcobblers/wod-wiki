/**
 * WW-072 — /subscribe probe failure surfaces raw browser error 'Failed to fetch'
 * with no remediation hint.
 *
 * Expected behavior: when the feed-manifest probe fails at the network level,
 * FeedIntakeBanner reports a human-readable error with a next-step hint and
 * never leaks the raw TypeError string "Failed to fetch".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SubscribePage } from '../../app/pages/SubscribePage';
import { TEST_IDS } from '@/lib/testIds';
import { resetFeedSubscriptionsForTest } from '@/services/feed/feedSubscriptions';

const BROKEN_SOURCE = 'https://unreachable.example.org/training/';

beforeEach(() => {
  resetFeedSubscriptionsForTest();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  resetFeedSubscriptionsForTest();
});

describe('WW-072 — /subscribe probe failure error copy', () => {
  it('shows a human-readable error with a remediation hint, not raw Failed to fetch', async () => {
    render(
      <MemoryRouter initialEntries={[`/subscribe?source=${encodeURIComponent(BROKEN_SOURCE)}`]}>
        <SubscribePage />
      </MemoryRouter>,
    );

    const banner = await screen.findByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await waitFor(() => {
      expect(banner.textContent).toContain('Feed Probe Failed');
    });

    expect(banner.textContent).not.toContain('Failed to fetch');
    expect(banner.textContent).toMatch(
      /check (the )?(url|link|address|connection)|try again|could not reach|unable to reach|unreachable/i,
    );
  });
});
