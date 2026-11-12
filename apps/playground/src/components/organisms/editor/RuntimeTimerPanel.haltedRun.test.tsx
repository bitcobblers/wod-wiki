import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import {
  clearHaltedRun,
  getHaltedRun,
  recordHaltedRun,
  useActiveRunStore,
} from '@/stores/activeRunStore';
import {
  HaltedRunNotice,
  RuntimeTimerPanel,
} from '@/components/organisms/editor/RuntimeTimerPanel';

function makeBlock(content: string): ScriptBlock {
  return {
    id: 'block-amrap-1',
    dialect: 'time',
    startLine: 0,
    endLine: content.split('\n').length - 1,
    content,
    statements: createParser().read(content).statements,
    state: 'idle',
    version: 1,
    createdAt: Date.now(),
    widgetIds: {},
  };
}

describe('WW-012: halted-run reload persistence and dismissible notice', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearHaltedRun();
    useActiveRunStore.getState().setRuntime(null);
    useActiveRunStore.getState().setActiveSessionMeta(null, null);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    clearHaltedRun();
  });

  it('persists, filters by noteId, and clears HaltedRunMarker via sessionStorage', () => {
    expect(getHaltedRun()).toBeNull();

    recordHaltedRun({
      sessionId: 'sess-101',
      runtimeId: 'sess-101',
      noteId: 'note-alpha',
      workoutTitle: 'Cindy',
      timestamp: 1_700_000_000_000,
      elapsedMs: 152_000,
    });

    expect(getHaltedRun()?.sessionId).toBe('sess-101');
    expect(getHaltedRun('note-alpha')?.sessionId).toBe('sess-101');
    expect(getHaltedRun('note-other')).toBeNull();

    clearHaltedRun('sess-101');
    expect(getHaltedRun()).toBeNull();
  });

  it('records a halted-run marker and finalizes partial results when beforeunload fires mid-run', async () => {
    const completedCalls: Array<{ blockId: string; results: Sessions }> = [];
    useActiveRunStore.getState().setActiveSessionMeta('sess-reload-1', 'note-reload-1');

    render(
      <RuntimeTimerPanel
        block={makeBlock('20:00 AMRAP\n  5 Pullups\n  10 Pushups')}
        resultId="sess-reload-1"
        noteId="note-reload-1"
        autoStart={true}
        onClose={() => {}}
        onComplete={(blockId, results) => {
          completedCalls.push({ blockId, results });
        }}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().execution.status).toBe('running');
    });

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0]?.results.completed).toBe(false);

    const marker = getHaltedRun('note-reload-1');
    expect(marker).not.toBeNull();
    expect(marker?.sessionId).toBe('sess-reload-1');
    expect(marker?.noteId).toBe('note-reload-1');
  });

  it('does NOT record a halted-run marker when stopped explicitly before unload', async () => {
    useActiveRunStore.getState().setActiveSessionMeta('sess-stop-1', 'note-stop-1');

    const { rerender } = render(
      <RuntimeTimerPanel
        block={makeBlock('20:00 AMRAP\n  5 Pullups')}
        resultId="sess-stop-1"
        noteId="note-stop-1"
        autoStart={true}
        externalStop={false}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().execution.status).toBe('running');
    });

    rerender(
      <RuntimeTimerPanel
        block={makeBlock('20:00 AMRAP\n  5 Pullups')}
        resultId="sess-stop-1"
        noteId="note-stop-1"
        autoStart={true}
        externalStop={true}
        onClose={() => {}}
      />,
    );

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(getHaltedRun()).toBeNull();
  });

  it('renders a dismissible partial-results notice with /results/:sessionId link and clears on Dismiss', () => {
    recordHaltedRun({
      sessionId: 'sess-partial-42',
      noteId: 'note-42',
      workoutTitle: '20:00 AMRAP',
      timestamp: Date.now(),
      elapsedMs: 95_000,
    });

    const { rerender } = render(<HaltedRunNotice noteId="other-note" />);
    expect(screen.queryByTestId('halted-run-notice')).toBeNull();

    rerender(<HaltedRunNotice noteId="note-42" />);
    const notice = screen.getByTestId('halted-run-notice');
    expect(notice.textContent).toContain('Previous workout run was saved as partial results on reload');

    const link = screen.getByRole('link', { name: /partial results/i });
    expect(link.getAttribute('href')).toBe('/results/sess-partial-42');

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    expect(dismissBtn.getAttribute('type')).toBe('button');
    fireEvent.click(dismissBtn);

    expect(screen.queryByTestId('halted-run-notice')).toBeNull();
    expect(getHaltedRun()).toBeNull();
  });
});
