import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import type { Session } from '@/types/storage';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
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
import {
  createResultRecorder,
  flushPendingUnloadResults,
  stagePendingUnloadResult,
} from '@/hooks/useWorkbenchServices';
import { WallClockPage } from '../../../../app/pages/WallClockPage';

const PENDING_HALTED_KEY = 'wodwiki:pending-halted-sessions:v1';

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
    localStorage.removeItem(PENDING_HALTED_KEY);
    clearHaltedRun();
    useActiveRunStore.getState().setRuntime(null);
    useActiveRunStore.getState().setActiveSessionMeta(null, null);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    localStorage.removeItem(PENDING_HALTED_KEY);
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

  it('surfaces HaltedRunNotice inside NoteEditor for matching note routes without duplicating', () => {
    recordHaltedRun({
      sessionId: 'sess-note-route-7',
      noteId: 'note-direct-7',
      workoutTitle: 'Fran',
      timestamp: Date.now(),
      elapsedMs: 65_000,
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/note/note-other']}>
        <NoteEditor
          noteId="note-other"
          value="# Other\n\n```time\n5:00\n```"
          onChange={() => {}}
          enablePreview={false}
          enableLinting={false}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('halted-run-notice')).toBeNull();

    rerender(
      <MemoryRouter initialEntries={['/note/note-direct-7']}>
        <NoteEditor
          noteId="note-direct-7"
          value="# Fran\n\n```time\n21-15-9\n  Thrusters\n  Pullups\n```"
          onChange={() => {}}
          enablePreview={false}
          enableLinting={false}
        />
      </MemoryRouter>,
    );
    const notices = screen.getAllByTestId('halted-run-notice');
    expect(notices).toHaveLength(1);
    const link = screen.getByRole('link', { name: /partial results/i });
    expect(link.getAttribute('href')).toBe('/results/sess-note-route-7');
  });

  it('surfaces HaltedRunNotice alongside fallback text when reloading /run/:runtimeId cold', () => {
    recordHaltedRun({
      sessionId: 'sess-wallclock-9',
      runtimeId: 'sess-wallclock-9',
      noteId: 'note-wc-9',
      timestamp: Date.now(),
      elapsedMs: 120_000,
    });

    render(
      <MemoryRouter initialEntries={['/run/sess-wallclock-9']}>
        <Routes>
          <Route path="/run/:runtimeId" element={<WallClockPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('halted-run-notice')).toBeDefined();
    expect(
      screen.getByRole('link', { name: /partial results/i }).getAttribute('href'),
    ).toBe('/results/sess-wallclock-9');
    expect(
      screen.getByText('Runtime not found. Please start the workout from the editor.'),
    ).toBeDefined();
  });

  it('clears a stale haltedRun marker as soon as a new workout run transitions to live', async () => {
    recordHaltedRun({
      sessionId: 'sess-stale-old',
      noteId: 'note-fresh-run',
      timestamp: Date.now() - 10_000,
      elapsedMs: 45_000,
    });
    expect(getHaltedRun('note-fresh-run')?.sessionId).toBe('sess-stale-old');

    const { rerender } = render(
      <RuntimeTimerPanel
        block={makeBlock('20:00 AMRAP\n  5 Pullups')}
        resultId="sess-fresh-2"
        noteId="note-fresh-run"
        autoStart={true}
        externalStop={false}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().execution.status).toBe('running');
    });

    // Stale marker cleared immediately on live start
    expect(getHaltedRun()).toBeNull();
    expect(useActiveRunStore.getState().haltedRun).toBeNull();

    // Stopping explicitly leaves haltedRun empty (never resurfaces stale marker)
    rerender(
      <RuntimeTimerPanel
        block={makeBlock('20:00 AMRAP\n  5 Pullups')}
        resultId="sess-fresh-2"
        noteId="note-fresh-run"
        autoStart={true}
        externalStop={true}
        onClose={() => {}}
      />,
    );
    expect(getHaltedRun()).toBeNull();
  });

  it('stages the partial session synchronously on beforeunload and flushPendingUnloadResults commits it', async () => {
    localStorage.removeItem(PENDING_HALTED_KEY);
    useActiveRunStore.getState().setActiveSessionMeta('sess-stage-1', 'note-stage-1');

    render(
      <RuntimeTimerPanel
        block={makeBlock('20:00 AMRAP\n  5 Pullups\n  10 Pushups')}
        resultId="sess-stage-1"
        noteId="note-stage-1"
        autoStart={true}
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().execution.status).toBe('running');
    });

    act(() => {
      window.dispatchEvent(new window.Event('beforeunload'));
    });

    // Synchronous staging: the partial result is in localStorage on the same
    // tick the event fires — no await in between.
    const stagedRaw = localStorage.getItem(PENDING_HALTED_KEY);
    expect(stagedRaw).not.toBeNull();
    const staged = JSON.parse(stagedRaw!) as Record<string, { resultId: string; data: Sessions }>;
    expect(staged['sess-stage-1']?.resultId).toBe('sess-stage-1');
    expect(staged['sess-stage-1']?.data.completed).toBe(false);

    // After the reload: flushing commits the partial session into storage.
    const finished: Array<{ id: string; completed: boolean }> = [];
    const recorder = createResultRecorder({
      finishSession: async (id, data) => {
        finished.push({ id, completed: data.completed });
        return { id } as Session;
      },
    });
    await flushPendingUnloadResults(recorder);
    expect(finished).toEqual([{ id: 'sess-stage-1', completed: false }]);
    expect(localStorage.getItem(PENDING_HALTED_KEY)).toBeNull();
  });

  it('clears the staged unload entry when a matching record() write succeeds', async () => {
    localStorage.removeItem(PENDING_HALTED_KEY);
    const partial: Sessions = { startTime: 1, endTime: 61_000, duration: 60_000, completed: false };
    stagePendingUnloadResult({ resultId: 'sess-manual-1', noteId: 'note-1', blockId: 'b1', data: partial, createdAt: 61_000 });

    const writerFinishes: string[] = [];
    const recorder = createResultRecorder({
      finishSession: async (id) => {
        writerFinishes.push(id);
        return { id } as Session;
      },
    });
    await recorder.record({ resultId: 'sess-manual-1', noteId: 'note-1', blockId: 'b1', data: partial, createdAt: 61_000 });
    expect(writerFinishes).toEqual(['sess-manual-1']);
    expect(localStorage.getItem(PENDING_HALTED_KEY)).toBeNull();
  });
});
