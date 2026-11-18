/**
 * WW-073 — Feed overflow menu ignores Escape once focus has left <details>.
 *
 * Expected behavior: pressing Escape dismisses an open feed overflow menu
 * even when focus is outside the <details> element.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SyncSection } from '@app/pages/SyncSection';
import { resetFeedSubscriptionsForTest } from '@/services/feed/feedSubscriptions';

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

describe('WW-073 — Feed overflow menu Escape dismissal', () => {
  it('closes the overflow menu on Escape even when focus is outside <details>', async () => {
    render(
      <MemoryRouter>
        <SyncSection />
      </MemoryRouter>,
    );

    const subscribedOnly = screen.getByRole('checkbox', { name: 'Subscribed only' }) as HTMLInputElement;
    if (subscribedOnly.checked) {
      fireEvent.click(subscribedOnly);
    }

    const more = (await screen.findByTestId('feed-more-manage-library')) as HTMLDetailsElement;
    const summary = more.querySelector('summary')!;
    fireEvent.click(summary);
    more.open = true;
    expect(more.hasAttribute('open')).toBe(true);

    // Move focus outside the <details> element (simulating clicking the panel/page).
    const externalButton = document.createElement('button');
    document.body.appendChild(externalButton);
    externalButton.focus();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(more.hasAttribute('open')).toBe(false);

    externalButton.remove();
  });
});
