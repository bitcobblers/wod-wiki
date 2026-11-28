import React from 'react';
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import type { Session } from '@/types/storage';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import {
  clearHaltedRun,
  clearLiveRunCheckpoint,
  getHaltedRun,
  getLiveRunCheckpoint,
  recordHaltedRun,
  saveLiveRunCheckpoint,
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
import { TEST_IDS } from '@/lib/testIds';

const PENDING_HALTED_KEY = 'wodwiki:pending-halted-sessions:v1';

async function startFromReadyGate(): Promise<void> {
  await waitFor(() => {
    expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).toBe('WaitingToStart');
  });
  fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE));
  await waitFor(() => {
    expect(useActiveRunStore.getState().execution.status).toBe('running');
  });
}

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
    clearLiveRunCheckpoint();
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

    await startFromReadyGate();

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

    await startFromReadyGate();

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
    expect(notice.textContent).toContain('20:00 AMRAP');
    expect(notice.textContent).toContain('01:35');

    const link = screen.getByRole('link', { name: /partial results/i });
    expect(link.getAttribute('href')).toBe('/results/sess-partial-42');

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    expect(dismissBtn.getAttribute('type')).toBe('button');
    expect(dismissBtn.className).toContain('min-h-11');
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

    await startFromReadyGate();

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

    await startFromReadyGate();

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

  it('renders an accessible not-found state with main[data-agent-status="ready"] on cold /run/invalid-id', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/run/invalid-id']}>
        <Routes>
          <Route path="/run/:runtimeId" element={<WallClockPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const main = container.querySelector('main[data-agent-status]');
    expect(main).not.toBeNull();
    expect(main?.getAttribute('data-agent-status')).toBe('ready');
    expect(screen.getByRole('heading', { name: 'Workout session not found' })).toBeDefined();
    expect(screen.getByTestId('run-notfound-go-home')).toBeDefined();
  });

  it('autoStart opens at the WaitingToStart gate until explicit Start pops WaitingToStart and runs the live block', async () => {
    render(
      <RuntimeTimerPanel
        block={makeBlock('10:00 AMRAP\n  5 Pullups\n  10 Pushups')}
        resultId="sess-autostart-1"
        noteId="note-autostart-1"
        autoStart={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).toBe('WaitingToStart');
    });
    expect(useActiveRunStore.getState().execution.status).toBe('idle');

    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE));

    await waitFor(() => {
      expect(useActiveRunStore.getState().execution.status).toBe('running');
    });

    const rt = useActiveRunStore.getState().runtime;
    expect(rt?.stack.current?.blockType).not.toBe('WaitingToStart');
  });

  it('WW-085: pressing "/" at the WaitingToStart gate pops WaitingToStart and renders no inline <style> tags', async () => {
    const { container } = render(
      <RuntimeTimerPanel
        block={makeBlock('10:00 AMRAP\n  5 Pullups\n  10 Pushups')}
        resultId="sess-ww085-slash"
        noteId="note-ww085-slash"
        autoStart={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).toBe('WaitingToStart');
    });
    expect(container.querySelectorAll('style').length).toBe(0);

    fireEvent.keyDown(window, { key: '/' });

    await waitFor(() => {
      expect(useActiveRunStore.getState().execution.status).toBe('running');
    });
    expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).not.toBe('WaitingToStart');
  });

  it('WW-052: clicking Stop at the WaitingToStart gate closes without calling onComplete', async () => {
    const onClose = mock(() => {});
    const onComplete = mock(() => {});
    render(
      <RuntimeTimerPanel
        block={makeBlock('10:00 AMRAP\n  5 Pullups')}
        resultId="sess-ww052-gate"
        noteId="note-ww052-gate"
        autoStart={true}
        onClose={onClose}
        onComplete={onComplete}
      />,
    );

    await waitFor(() => {
      expect(useActiveRunStore.getState().runtime?.stack.current?.blockType).toBe('WaitingToStart');
    });

    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_STOP_SESSION));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('WW-067: toggling Keypad in ClockCommandBoard renders the numeric keypad group', async () => {
    render(
      <RuntimeTimerPanel
        block={makeBlock('10:00 AMRAP\n  5 Pullups')}
        resultId="sess-ww067-keypad"
        noteId="note-ww067-keypad"
        autoStart={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.CLOCK_KEY_MODE_TOGGLE)).toBeDefined();
    });

    const keypadBtn = screen.getByRole('button', { name: 'Keypad' });
    fireEvent.click(keypadBtn);
    expect(keypadBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('group', { name: 'Numeric keypad' })).toBeDefined();
  });

  it('WW-120: HaltedRunNotice waits until staged unload persistence succeeds before showing /results/:id link', async () => {
    const partial: Sessions = { startTime: 1_000, endTime: 16_000, duration: 15_000, completed: false };
    recordHaltedRun({
      sessionId: 'sess-ww120-ok',
      noteId: 'note-ww120',
      workoutTitle: '20:00 AMRAP',
      timestamp: Date.now(),
      elapsedMs: 15_000,
    });
    stagePendingUnloadResult({
      resultId: 'sess-ww120-ok',
      noteId: 'note-ww120',
      blockId: 'block-1',
      data: partial,
      createdAt: 16_000,
    });

    render(<HaltedRunNotice noteId="note-ww120" />);
    // Hidden while pending — must not claim saved before persistence succeeds
    expect(screen.queryByTestId('halted-run-notice')).toBeNull();

    const recorder = createResultRecorder({
      finishSession: async (id) => ({ id } as Session),
    });
    await act(async () => {
      await flushPendingUnloadResults(recorder);
    });

    const notice = screen.getByTestId('halted-run-notice');
    expect(notice.textContent).toContain('Previous workout run was saved as partial results on reload');
    expect(screen.getByRole('link', { name: /partial results/i }).getAttribute('href')).toBe('/results/sess-ww120-ok');
  });

  it('WW-120: HaltedRunNotice surfaces an error/recovery notice without a broken /results/:id link when persistence fails', async () => {
    const partial: Sessions = { startTime: 1_000, endTime: 16_000, duration: 15_000, completed: false };
    recordHaltedRun({
      sessionId: 'sess-ww120-fail',
      noteId: 'note-ww120-fail',
      workoutTitle: '20:00 AMRAP',
      timestamp: Date.now(),
      elapsedMs: 15_000,
    });
    stagePendingUnloadResult({
      resultId: 'sess-ww120-fail',
      noteId: 'note-ww120-fail',
      blockId: 'block-1',
      data: partial,
      createdAt: 16_000,
    });

    render(<HaltedRunNotice noteId="note-ww120-fail" />);

    const failingRecorder = createResultRecorder({
      finishSession: async () => {
        throw new Error('IndexedDB write failed');
      },
    });
    await act(async () => {
      await flushPendingUnloadResults(failingRecorder);
    });

    const notice = screen.getByTestId('halted-run-notice');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain('Previous workout run could not be saved on reload');
    expect(notice.textContent).toContain('IndexedDB write failed');
    expect(screen.queryByRole('link', { name: /partial results/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeDefined();
    // Staged entry is retained until retry or dismiss
    expect(localStorage.getItem(PENDING_HALTED_KEY)).not.toBeNull();

    // Dismissing clears both halted-run marker and staged entry
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('halted-run-notice')).toBeNull();
    expect(getHaltedRun()).toBeNull();
    expect(localStorage.getItem(PENDING_HALTED_KEY)).toBeNull();
  });

  it('WW-142: writes a live checkpoint to localStorage while running, clears on stop, and offers Resume / Save partial / Discard on reload', async () => {
    useActiveRunStore.getState().setActiveSessionMeta('sess-ww142-live', 'note-ww142');
    const { rerender } = render(
      <RuntimeTimerPanel
        block={makeBlock('20:00 AMRAP\n  5 Pullups\n  10 Pushups')}
        resultId="sess-ww142-live"
        noteId="note-ww142"
        autoStart={true}
        externalStop={false}
        onClose={() => {}}
      />,
    );

    await startFromReadyGate();

    const cp = getLiveRunCheckpoint('note-ww142');
    expect(cp).not.toBeNull();
    expect(cp?.sessionId).toBe('sess-ww142-live');
    expect(cp?.blockContent).toContain('20:00 AMRAP');
    expect(localStorage.getItem('wodwiki:active-run-checkpoint:v1')).toContain('sess-ww142-live');

    // Explicit stop clears the live checkpoint cleanly
    rerender(
      <RuntimeTimerPanel
        block={makeBlock('20:00 AMRAP\n  5 Pullups\n  10 Pushups')}
        resultId="sess-ww142-live"
        noteId="note-ww142"
        autoStart={true}
        externalStop={true}
        onClose={() => {}}
      />,
    );
    expect(getLiveRunCheckpoint('note-ww142')).toBeNull();
    cleanup();

    // Simulate reload with an interrupted checkpoint (no active runtime, no haltedRun marker)
    useActiveRunStore.getState().setRuntime(null);
    saveLiveRunCheckpoint({
      sessionId: 'sess-ww142-reloaded',
      noteId: 'note-ww142',
      blockId: 'block-amrap-1',
      blockContent: '20:00 AMRAP\n  5 Pullups',
      workoutTitle: '20:00 AMRAP',
      startedAt: Date.now() - 45_000,
      lastCheckpointAt: Date.now(),
      elapsedMs: 45_000,
      status: 'running',
      stepCount: 2,
    });

    render(
      <MemoryRouter initialEntries={['/note/note-ww142']}>
        <HaltedRunNotice noteId="note-ww142" />
      </MemoryRouter>,
    );

    const notice = screen.getByTestId('halted-run-notice');
    expect(notice.textContent).toContain('Interrupted workout session detected');
    expect(screen.getByTestId(TEST_IDS.LIVE_RUN_RESUME)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.LIVE_RUN_SAVE_PARTIAL)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.LIVE_RUN_DISCARD)).toBeDefined();

    fireEvent.click(screen.getByTestId(TEST_IDS.LIVE_RUN_DISCARD));
    expect(getLiveRunCheckpoint('note-ww142')).toBeNull();
    expect(screen.queryByTestId('halted-run-notice')).toBeNull();
  });

  it('resumes from a saved partial-reload checkpoint using a fresh continuation runtimeId instead of reusing the persisted sessionId', async () => {
    const { pendingRuntimes } = await import('../../../../app/runtimeStore');
    pendingRuntimes.clear();

    const persistedSessionId = '01a21b00-6ee9-756d-bd7d-fabca4e7c40d';
    recordHaltedRun({
      sessionId: persistedSessionId,
      noteId: 'note-resume-1',
      workoutTitle: 'QA Runtime Workout 2099',
      timestamp: Date.now(),
      elapsedMs: 37_000,
    });
    saveLiveRunCheckpoint({
      sessionId: persistedSessionId,
      noteId: 'note-resume-1',
      blockId: 'block-1',
      blockContent: '10:00\n  10 Burpees',
      workoutTitle: 'QA Runtime Workout 2099',
      startedAt: Date.now() - 37_000,
      lastCheckpointAt: Date.now(),
      elapsedMs: 37_000,
      status: 'running',
      stepCount: 2,
    });

    let navigatedTo = '';
    render(
      <MemoryRouter initialEntries={['/note/note-resume-1']}>
        <Routes>
          <Route path="/note/:noteId" element={<HaltedRunNotice noteId="note-resume-1" />} />
          <Route
            path="/run/:runtimeId"
            element={
              <div
                ref={(el) => {
                  if (el) navigatedTo = el.dataset.path ?? '';
                }}
                data-testid="resumed-run-route"
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const resumeBtn = screen.getByTestId(TEST_IDS.LIVE_RUN_RESUME);
    fireEvent.click(resumeBtn);

    await waitFor(() => expect(screen.getByTestId('resumed-run-route')).toBeDefined());
    // Must NOT reuse the already-persisted partial sessionId (which causes "Session already exists").
    expect(pendingRuntimes.has(persistedSessionId)).toBe(false);
    expect(pendingRuntimes.size).toBe(1);
    const [[allocatedId, entry]] = Array.from(pendingRuntimes.entries());
    expect(allocatedId).not.toBe(persistedSessionId);
    expect(entry.noteId).toBe('note-resume-1');
    expect(entry.resumeElapsedMs).toBe(37_000);
    expect(entry.resumeStatus).toBe('running');
    expect(navigatedTo).toBe('');
    pendingRuntimes.clear();
  });

  it('WW-142: restores elapsed time and active running state when mounting RuntimeTimerPanel with initialElapsedMs', async () => {
    const block = makeBlock('10:00\n  10 Burpees');
    const onComplete = mock(() => undefined);

    render(
      <RuntimeTimerPanel
        block={block}
        resultId="resumed-session-1"
        noteId="note-resume-2"
        autoStart
        initialElapsedMs={51_342}
        initialStartedAt={Date.now() - 51_342}
        initialResumeStatus="running"
        onClose={() => undefined}
        onComplete={onComplete}
      />,
    );

    await waitFor(() => {
      const exec = useActiveRunStore.getState().execution;
      expect(exec.status).toBe('running');
      expect(exec.elapsedTime).toBeGreaterThanOrEqual(51_342);
    });
  });
});
