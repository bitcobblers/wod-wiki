import React from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import type { ReceiverTimerPanel } from '../wallclock-panel-chromecast';
import type { ReceiverStackPanel } from '../track-panel-chromecast';
import type { ClockSnapshot } from '@/clock/clockCommands';

// Dynamic imports below are intentional: bun's mock.module() must register
// before the module under test is first loaded — static imports would hoist
// above the mock registration (module-loading boundary test).

mock.module('@/panels/visual-state-panel', () => ({
  VisualStatePanel: () => <div data-testid="visual-state-panel" />,
}));

// Board internals are CollectionFlow/BrowserCommands surface; this test pins
// the panel's contract: snapshot-driven availability + command dispatch only.
mock.module('@/clock/ClockCommandBoard', () => ({
  ClockCommandBoard: ({ snapshot }: { snapshot: { runId: string } }) => (
    <div data-testid="clock-command-board" data-run={snapshot.runId} />
  ),
}));

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

  it('ReceiverStackPanel delegates to shared VisualStatePanel', async () => {
    const { ReceiverStackPanel: StackPanel } = await import('../track-panel-chromecast') as { ReceiverStackPanel: typeof ReceiverStackPanel };

    render(<StackPanel />);

    expect(screen.getByTestId('visual-state-panel')).toBeDefined();
  });

  it('ReceiverTimerPanel renders the General surface and dispatches commands from the snapshot', async () => {
    const { ReceiverTimerPanel: TimerPanel } = await import('../wallclock-panel-chromecast') as { ReceiverTimerPanel: typeof ReceiverTimerPanel };
    const sendCommand = mock(() => {});
    const harness = new RuntimeTestBuilder().withScript('Helen\n3 Rounds\n400m Run').build();

    render(
      <ScriptRuntimeProvider runtime={harness.runtime}>
        <TimerPanel
          snapshot={liveSnapshot()}
          sendCommand={sendCommand}
          workoutTitle="Helen"
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

  it('ReceiverTimerPanel disables Next while the authority reports it unavailable', async () => {
    const { ReceiverTimerPanel: TimerPanel } = await import('../wallclock-panel-chromecast') as { ReceiverTimerPanel: typeof ReceiverTimerPanel };
    const sendCommand = mock(() => {});
    const harness = new RuntimeTestBuilder().withScript('Helen\n3 Rounds\n400m Run').build();

    render(
      <ScriptRuntimeProvider runtime={harness.runtime}>
        <TimerPanel
          snapshot={liveSnapshot({ status: 'paused', canNext: false })}
          sendCommand={sendCommand}
          workoutTitle="Paused"
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
