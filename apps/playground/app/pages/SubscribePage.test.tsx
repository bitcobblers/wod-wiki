/**
 * SubscribePage — WW-013 + FED-01:
 * `/subscribe` renders an accessible Subscribe Intake page (`main[data-agent-status]`)
 * instead of silently bouncing away:
 *  - bare `/subscribe`: URL probe form + quick-subscribe community feed cards
 *  - `/subscribe?source=<registered-url|id>`: curated consent card (`registered-feed-intake-card`)
 *  - `/subscribe?source=<unknown-url>`: `FeedIntakeBanner` (`unknown-feed-intake-banner`)
 *    preserving FED-01 consent + auto-sync + Decline -> `/notebooks`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SubscribePage } from './SubscribePage';
import { resetFeedSubscriptionsForTest } from '@/services/feed/feedSubscriptions';
import * as feedSyncModule from '@/services/feed/feedSync';

let currentLocation = { pathname: '', search: '' };

function LocationProbe() {
  const loc = useLocation();
  currentLocation = { pathname: loc.pathname, search: loc.search };
  return null;
}

function renderSubscribe(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <SubscribePage />
    </MemoryRouter>,
  );
}

describe('SubscribePage (WW-013)', () => {
  beforeEach(() => {
    localStorage.removeItem('wodwiki.seedSubscriptions');
    localStorage.removeItem('wodwiki.seedAutoSync');
    localStorage.removeItem('wodwiki.seedSources');
    resetFeedSubscriptionsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    resetFeedSubscriptionsForTest();
  });

  it('keeps bare /subscribe mounted with heading, URL input, and catalog feed options', () => {
    renderSubscribe('/subscribe');

    expect(currentLocation.pathname).toBe('/subscribe');
    const main = document.querySelector('main');
    expect(main).not.toBeNull();
    expect(main!.getAttribute('data-agent-status')).toBe('ready');
    expect(screen.getByTestId('feed-subscription-intake')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Subscribe to a Feed/i })).toBeTruthy();
    expect(screen.getByPlaceholderText(/https:\/\/example\.com\/seed\//i)).toBeTruthy();
    expect(screen.getByText('HYROX')).toBeTruthy();
  });

  it('renders curated consent card for a registered ?source= URL and subscribes on consent', async () => {
    const syncSpy = vi.spyOn(feedSyncModule, 'syncFeedSource').mockResolvedValue('imported');

    renderSubscribe('/subscribe?source=https%3A%2F%2Fbitcobblers.github.io%2Fwod-wiki-sport-hyrox%2F');

    expect(currentLocation.pathname).toBe('/subscribe');
    const card = screen.getByTestId('registered-feed-intake-card');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('HYROX');
    expect(card.textContent).toContain('HYROX race preparation and simulation workouts.');

    const autoSync = screen.getByRole('checkbox', { name: /Auto-sync updates/i }) as HTMLInputElement;
    expect(autoSync.checked).toBe(false);
    fireEvent.click(autoSync);
    expect(autoSync.checked).toBe(true);

    fireEvent.click(screen.getByTestId('registered-feed-subscribe-btn'));
    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalledWith('sport-hyrox', expect.objectContaining({ force: true }));
    });
    await waitFor(() => {
      expect(currentLocation.pathname).toBe('/notebooks');
      expect(decodeURIComponent(currentLocation.search)).toContain(':notebook{feed:sport-hyrox}');
    });
  });

  it('mounts FeedIntakeBanner directly on /subscribe?source=<unknown-url> without redirecting prematurely', () => {
    renderSubscribe('/subscribe?source=not-a-valid-https-url');

    expect(currentLocation.pathname).toBe('/subscribe');
    expect(screen.getByTestId('unknown-feed-intake-banner')).toBeTruthy();
  });
});
