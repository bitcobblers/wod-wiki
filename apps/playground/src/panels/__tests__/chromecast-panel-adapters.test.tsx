import React from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import type { ReceiverTimerPanel } from '../wallclock-panel-chromecast';
import type { ReceiverStackPanel } from '../track-panel-chromecast';

// Dynamic imports below are intentional: bun's mock.module() must register
// before the module under test is first loaded — static imports would hoist
// above the mock registration (module-loading boundary test).

mock.module('@/panels/visual-state-panel', () => ({
  VisualStatePanel: () => <div data-testid="visual-state-panel" />,
}));

describe('chromecast panel adapters', () => {
  afterEach(() => {
    cleanup();
  });

  it('ReceiverStackPanel delegates to shared VisualStatePanel', async () => {
    const { ReceiverStackPanel: StackPanel } = await import('../track-panel-chromecast') as { ReceiverStackPanel: typeof ReceiverStackPanel };

    render(<StackPanel />);

    expect(screen.getByTestId('visual-state-panel')).toBeDefined();
  });

  it('ReceiverTimerPanel renders the General surface and forwards events via provider', async () => {
    const { ReceiverTimerPanel: TimerPanel } = await import('../wallclock-panel-chromecast') as { ReceiverTimerPanel: typeof ReceiverTimerPanel };
    const dispatch = mock(() => {});
    const harness = new RuntimeTestBuilder().withScript('Helen\n3 Rounds\n400m Run').build();

    render(
      <ScriptRuntimeProvider runtime={harness.runtime}>
        <TimerPanel
          eventProvider={{
            dispatch,
            onEvent: () => () => {},
            dispose: () => {},
          }}
          workoutTitle="Helen"
        />
      </ScriptRuntimeProvider>,
    );

    // General (Tier 2) surface chrome: title, session label, control triad
    expect(screen.getByText('Helen')).toBeDefined();
    expect(screen.getByText(/Session/)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_STOP_SESSION)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK)).toBeDefined();

    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_STOP_SESSION));
    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE));
    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK));

    // Idle workout: the pause control shows Play, so its click dispatches
    // 'start' (resume) rather than 'pause'.
    const dispatchedNames = dispatch.mock.calls.map((call: unknown[]) => (call[0] as { name?: string } | undefined)?.name);
    expect(dispatchedNames).toEqual(['stop', 'start', 'next']);

    harness.dispose();
  });
});
