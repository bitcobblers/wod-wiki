/**
 * WW-086 — Subscribe on /feeds shows no pending/disabled state during sync.
 *
 * Expected behavior: while a Subscribe-triggered feed sync is in flight, the
 * Subscribe button is disabled and shows a busy label (e.g. Subscribing…).
 */
import '@testing-library/jest-dom';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SyncSection } from '@app/pages/SyncSection';
import { resetFeedSubscriptionsForTest } from '@/services/feed/feedSubscriptions';
import * as feedSyncModule from '@/services/feed/feedSync';

const MANAGE_SOURCE = {
  id: 'manage-library',
  label: 'Manage Library',
  url: 'https://manage.example.org/library/',
  repositoryUrl: 'https://github.com/example/manage-library',
};

beforeEach(() => {
  localStorage.setItem('wodwiki.seedSources', JSON.stringify([MANAGE_SOURCE]));
  resetFeedSubscriptionsForTest();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ schema: 9, version: 1, name: 'Manage Library', chunks: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('wodwiki.seedSources');
  resetFeedSubscriptionsForTest();
});

describe('WW-086 — Subscribe pending state during feed sync', () => {
  it('disables the Subscribe button and shows a busy label while sync is in flight', async () => {
    let resolveSync!: () => void;
    vi.spyOn(feedSyncModule, 'syncFeedSource').mockImplementation(
      () =>
        new Promise<'imported'>((resolve) => {
          resolveSync = () => resolve('imported');
        }),
    );

    render(
      <MemoryRouter>
        <SyncSection />
      </MemoryRouter>,
    );

    const subscribedOnly = screen.getByRole('checkbox', { name: 'Subscribed only' }) as HTMLInputElement;
    if (subscribedOnly.checked) {
      fireEvent.click(subscribedOnly);
    }

    const subscribeBtn = (await screen.findByTestId('feed-subscribe-manage-library')) as HTMLButtonElement;
    expect(subscribeBtn.disabled).toBe(false);

    fireEvent.click(subscribeBtn);

    await waitFor(() => {
      expect(subscribeBtn.disabled).toBe(true);
      expect(subscribeBtn.textContent ?? '').toMatch(/subscribing|syncing|importing/i);
    });

    resolveSync();
  });
});
