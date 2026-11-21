/**
 * SubscribePage — WW-013 + FED-01 + Index-First Subscription Intake:
 *  - bare `/subscribe`: single URL inspect form + quick-subscribe community feed cards
 *  - `/subscribe?source=<registered-url|id>`: unified inspect-before-subscribe card
 *    (`registered-feed-intake-card`) with notebook checklist, index vs offline sizes,
 *    optional Download for offline toggle, Auto-sync, and index-first `subscribeFeed`
 *  - `/subscribe?source=<unknown-url>`: `FeedIntakeBanner` (`unknown-feed-intake-banner`)
 *    probing manifest.json before persisting any custom feed source
 *  - `/subscribe?feed=invalid`: shows error notice without duplicate stacked URL forms
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SubscribePage } from './SubscribePage';
import { resetFeedSubscriptionsForTest } from '@/services/feed/feedSubscriptions';
import { customFeedSources } from '@/services/feed/feedSources';
import * as feedSyncModule from '@/services/feed/feedSync';
import * as feedCatalogModule from '@/services/feed/feedCatalog';
import type { ProbedFeedManifest } from '@/services/feed/feedCatalog';
import type { SeedManifest } from '@bitcobblers/wod-wiki-engine';

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

function makeProbedManifest(overrides: Partial<ProbedFeedManifest> = {}): ProbedFeedManifest {
  const notebooks = overrides.notebooks ?? [
    {
      notebookId: 'notebook.hyrox',
      label: 'HYROX Workouts',
      indexPath: 'indexes/notebooks/notebook.hyrox.json',
      version: 2,
      commit: 'abc',
      builtAt: '2026-11-20T00:00:00.000Z',
      sha256: '1'.repeat(64),
      bytes: 1024,
      indexBytes: 1024,
      chunkBytes: 16384,
      count: 14,
    },
    {
      notebookId: 'notebook.hyrox-sims',
      label: 'HYROX Simulations',
      indexPath: 'indexes/notebooks/notebook.hyrox-sims.json',
      version: 2,
      commit: 'abc',
      builtAt: '2026-11-20T00:00:00.000Z',
      sha256: '2'.repeat(64),
      bytes: 2048,
      indexBytes: 2048,
      chunkBytes: 32768,
      count: 8,
    },
  ];
  const manifest: SeedManifest = {
    name: overrides.name ?? 'HYROX',
    description: overrides.description ?? 'HYROX race preparation and simulation workouts.',
    schema: 10,
    version: 2,
    builtAt: '2026-11-20T00:00:00.000Z',
    indexBytes: 3072,
    chunkBytes: 49152,
    chunks: notebooks.map((nb) => ({
      id: nb.notebookId,
      path: `chunks/${nb.notebookId}.json`,
      sha256: nb.sha256,
      bytes: nb.chunkBytes ?? 1024,
      count: nb.count,
    })),
    notebooks,
  };
  return {
    url: 'https://bitcobblers.github.io/wod-wiki-sport-hyrox/',
    manifest,
    name: manifest.name!,
    description: manifest.description,
    version: manifest.version,
    schema: manifest.schema,
    builtAt: manifest.builtAt,
    notebooks,
    notebookCount: notebooks.length,
    itemCount: notebooks.reduce((s, n) => s + n.count, 0),
    indexBytes: 3072,
    chunkBytes: 49152,
    hasOfflineChunks: true,
    ...overrides,
  };
}

describe('SubscribePage (WW-013)', () => {
  beforeEach(() => {
    localStorage.removeItem('wodwiki.seedSubscriptions');
    localStorage.removeItem('wodwiki.seedAutoSync');
    localStorage.removeItem('wodwiki.seedSources');
    resetFeedSubscriptionsForTest();
    vi.spyOn(feedCatalogModule, 'readFeedCatalogManifest').mockResolvedValue(undefined);
    vi.spyOn(feedCatalogModule, 'saveFeedCatalogManifest').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    resetFeedSubscriptionsForTest();
  });

  it('keeps bare /subscribe mounted with single URL input, heading, and catalog feed options', () => {
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

  it('probes registered ?source= URL, shows notebooks & sizes without schema jargon, and subscribes index-only by default', async () => {
    vi.spyOn(feedCatalogModule, 'probeFeedManifest').mockResolvedValue(makeProbedManifest());
    const subscribeSpy = vi.spyOn(feedSyncModule, 'subscribeFeed').mockResolvedValue('imported');

    renderSubscribe('/subscribe?source=https%3A%2F%2Fbitcobblers.github.io%2Fwod-wiki-sport-hyrox%2F');

    expect(currentLocation.pathname).toBe('/subscribe');
    const card = await screen.findByTestId('registered-feed-intake-card');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('HYROX');
    expect(card.textContent).toContain('HYROX race preparation and simulation workouts.');

    await waitFor(() => {
      expect(card.textContent).toContain('HYROX Workouts');
      expect(card.textContent).toContain('14 items');
      expect(card.textContent).toContain('3.0 KB index');
      expect(card.textContent).toContain('48.0 KB optional offline bundle');
    });

    expect(card.textContent).not.toMatch(/schema\s+9|core seed|Import Once|Browse in Library/i);

    const offlineToggle = screen.getByRole('checkbox', { name: /Download for offline/i }) as HTMLInputElement;
    expect(offlineToggle.checked).toBe(false);

    const autoSync = screen.getByRole('checkbox', { name: /Auto-sync updates/i }) as HTMLInputElement;
    expect(autoSync.checked).toBe(false);
    fireEvent.click(autoSync);
    expect(autoSync.checked).toBe(true);

    fireEvent.click(screen.getByTestId('registered-feed-subscribe-btn'));
    await waitFor(() => {
      expect(subscribeSpy).toHaveBeenCalledWith(
        'sport-hyrox',
        expect.objectContaining({
          offlinePolicy: 'index-only',
          autoSync: true,
        }),
      );
    });
    await waitFor(() => {
      expect(currentLocation.pathname).toBe('/notebooks');
      expect(decodeURIComponent(currentLocation.search)).toContain(':notebook{feed:sport-hyrox}');
    });
  });

  it('probes custom ?source= URL before registering and passes offline-full + partial notebooks when selected', async () => {
    const customUrl = 'https://coach.example.org/workouts/';
    vi.spyOn(feedCatalogModule, 'probeFeedManifest').mockResolvedValue(
      makeProbedManifest({
        url: customUrl,
        name: 'Coach Custom Feed',
        description: 'Custom strength blocks',
      }),
    );
    const subscribeSpy = vi.spyOn(feedSyncModule, 'subscribeFeed').mockResolvedValue('imported');

    renderSubscribe(`/subscribe?source=${encodeURIComponent(customUrl)}`);

    const banner = await screen.findByTestId('unknown-feed-intake-banner');
    await waitFor(() => {
      expect(banner.textContent).toContain('Add "Coach Custom Feed" to your Library?');
      expect(banner.textContent).toContain('coach.example.org');
      expect(banner.textContent).toContain('HYROX Simulations');
    });

    // Not persisted before clicking Subscribe!
    expect(customFeedSources()).toHaveLength(0);
    expect(banner.textContent).not.toContain('Feed Deep Link');
    expect(banner.textContent).not.toContain('Import Once');
    expect(banner.textContent).not.toContain('Browse in Library (Register Only)');

    // Uncheck second notebook and opt into Download for offline
    fireEvent.click(screen.getByRole('checkbox', { name: /HYROX Simulations/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Download for offline/i }));

    fireEvent.click(screen.getByTestId('feed-intake-subscribe'));

    await waitFor(() => {
      expect(subscribeSpy).toHaveBeenCalledWith(
        'coach-custom-feed',
        expect.objectContaining({
          offlinePolicy: 'offline-full',
          notebookIds: ['notebook.hyrox'],
        }),
      );
    });
    expect(customFeedSources().map((s) => s.url)).toContain(customUrl);
  });

  it('mounts FeedIntakeBanner directly on invalid ?feed= without stacking duplicate URL forms', () => {
    renderSubscribe('/subscribe?feed=not-a-valid-https-url');

    expect(currentLocation.pathname).toBe('/subscribe');
    expect(screen.getByTestId('unknown-feed-intake-banner')).toBeTruthy();
    // Only the single top URL form exists; no duplicate form inside the invalid banner.
    expect(screen.getAllByRole('textbox').length).toBe(1);
  });
});
