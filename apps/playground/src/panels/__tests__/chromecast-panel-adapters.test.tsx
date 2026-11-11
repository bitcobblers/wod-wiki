import React from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine/react';
import { TEST_IDS } from '@/lib/testIds';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import { ReceiverTimerPanel } from '../wallclock-panel-chromecast';
import { ReceiverStackPanel } from '../track-panel-chromecast';
import type { ClockSnapshot } from '@/clock/clockCommands';

// Slot stand-ins pin each adapter's contract (delegation + command dispatch)
// without mounting the board/panel internals (CollectionFlow/BrowserCommands).
const VisualStateSlot = () => <div data-testid="visual-state-panel" />;
const CommandBoardSlot = ({ snapshot }: { snapshot: { runId: string } }) => (
  <div data-testid="clock-command-board" data-run={snapshot.runId} />
);

const liveSnapshot = (overrides: Partial<ClockSnapshot> = {}): ClockSnapshot => ({
  runId: 'run-panel-test',
  phase: 'live',
  status: 'idle',
  canNext: true,
  canStop: true,
  stopRequested: false,
  reps: [],
  selectedOccurrenceId: null,
  entry: null,
  error: null,
  saving: false,
  ...overrides,
});

describe('chromecast panel adapters', () => {
  afterEach(() => {
    cleanup();
  });

  it('ReceiverStackPanel delegates to the shared VisualStatePanel slot', () => {
    render(<ReceiverStackPanel VisualStateSlot={VisualStateSlot} />);

    expect(screen.getByTestId('visual-state-panel')).toBeDefined();
  });

  it('ReceiverTimerPanel renders the General surface and dispatches commands from the snapshot', () => {
    const sendCommand = mock(() => {});
    const harness = new RuntimeTestBuilder().withScript('Helen\n3 Rounds\n400m Run').build();

    render(
      <ScriptRuntimeProvider runtime={harness.runtime}>
        <ReceiverTimerPanel
          snapshot={liveSnapshot()}
          sendCommand={sendCommand}
          workoutTitle="Helen"
          CommandBoardSlot={CommandBoardSlot}
        />
      </ScriptRuntimeProvider>,
    );

    // General (Tier 2) surface chrome: title, session label, control triad,
    // plus the shared command board mounted with the transported snapshot.
    expect(screen.getByText('Helen')).toBeDefined();
    expect(screen.getByText(/Session/)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_STOP_SESSION)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK)).toBeDefined();
    expect(screen.getByTestId('clock-command-board')).toBeDefined();

    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_STOP_SESSION));
    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE));
    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK));

    // Idle workout: the pause control shows Play, so its click dispatches
    // playback (resume/start) rather than a dedicated pause.
    const commands = sendCommand.mock.calls.map((call: unknown[]) => call[0]);
    expect(commands).toEqual([
      { kind: 'stop-request' },
      { kind: 'playback' },
      { kind: 'next' },
    ]);

    harness.dispose();
  });

  it('ReceiverTimerPanel disables Next while the authority reports it unavailable', () => {
    const sendCommand = mock(() => {});
    const harness = new RuntimeTestBuilder().withScript('Helen\n3 Rounds\n400m Run').build();

    render(
      <ScriptRuntimeProvider runtime={harness.runtime}>
        <ReceiverTimerPanel
          snapshot={liveSnapshot({ status: 'paused', canNext: false })}
          sendCommand={sendCommand}
          workoutTitle="Paused"
          CommandBoardSlot={CommandBoardSlot}
        />
      </ScriptRuntimeProvider>,
    );

    const next = screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(next);
    expect(sendCommand).not.toHaveBeenCalled();

    harness.dispose();
  });
});
