import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  markFeedFirstPaint,
  markFeedSyncProgress,
  markFeedSyncSettled,
  markFeedSyncStarted,
  resetFeedReadinessForTest,
} from '@/services/feed/feedReadiness';
import { MainLandmark } from '@/templates/SidebarLayout';
import { AgentStateScript } from './AgentStateScript';

function readAgentViewState(): Record<string, unknown> {
  const el = document.getElementById('agent-view-state');
  if (!el) throw new Error('Missing #agent-view-state script');
  return JSON.parse(el.textContent || '{}') as Record<string, unknown>;
}

describe('AgentStateScript and MainLandmark boot import readiness (WW-019)', () => {
  beforeEach(() => {
    act(() => resetFeedReadinessForTest());
  });

  afterEach(() => {
    act(() => resetFeedReadinessForTest());
  });

  it('holds data-agent-status="loading" and importPending=true while background boot import runs after first paint', () => {
    render(
      <MemoryRouter initialEntries={['/journal']}>
        <MainLandmark>
          <div>Journal Content</div>
        </MainLandmark>
        <AgentStateScript />
      </MemoryRouter>,
    );

    const main = screen.getByRole('main');
    expect(main.getAttribute('data-agent-status')).toBe('ready');
    expect(readAgentViewState()).toMatchObject({
      status: 'ready',
      feedReadiness: 'ready',
      importPending: false,
    });

    act(() => {
      markFeedSyncStarted();
    });
    expect(main.getAttribute('data-agent-status')).toBe('loading');
    expect(main.getAttribute('aria-busy')).toBe('true');

    // Canvas chunk commits (first paint): feedReadiness flips to 'ready',
    // yet boot corpus import is still actively running.
    act(() => {
      markFeedFirstPaint();
      markFeedSyncProgress({
        sourceId: 'core',
        sourceLabel: 'Core library',
        sourceIndex: 1,
        totalSources: 2,
        chunkId: 'efforts',
        completedChunks: 1,
        totalChunks: 4,
        phase: 'applying',
        totalNotes: 0,
        totalEfforts: 0,
        totalEquipment: 0,
        totalBlocks: 0,
        skippedUserOwned: 0,
        deleted: 0,
        addedNotes: 0,
        updatedNotes: 0,
      });
    });

    expect(main.getAttribute('data-agent-status')).toBe('loading');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(readAgentViewState()).toMatchObject({
      status: 'loading',
      feedReadiness: 'ready',
      importPending: true,
    });

    const progressBanner = screen.getByTestId('boot-import-progress');
    expect(progressBanner.textContent).toContain('Importing efforts…');

    // Once all boot feeds finish importing, status flips to 'ready' and banner clears.
    act(() => {
      markFeedSyncSettled('imported');
    });

    expect(main.getAttribute('data-agent-status')).toBe('ready');
    expect(main.getAttribute('aria-busy')).toBe('false');
    expect(screen.queryByTestId('boot-import-progress')).toBeNull();
    expect(readAgentViewState()).toMatchObject({
      status: 'ready',
      feedReadiness: 'ready',
      importPending: false,
    });
  });

  it('suppresses boot-import-progress pill on the Home route (/) while still holding agent status loading', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MainLandmark>
          <div>Home Hero</div>
        </MainLandmark>
        <AgentStateScript />
      </MemoryRouter>,
    );

    act(() => {
      markFeedSyncStarted();
      markFeedFirstPaint();
    });

    const main = screen.getByRole('main');
    expect(main.getAttribute('data-agent-status')).toBe('loading');
    expect(readAgentViewState()).toMatchObject({
      status: 'loading',
      importPending: true,
    });
    expect(screen.queryByTestId('boot-import-progress')).toBeNull();
  });
});
