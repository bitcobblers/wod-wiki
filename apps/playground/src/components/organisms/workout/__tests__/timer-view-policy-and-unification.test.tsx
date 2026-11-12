import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine/react';
import { PanelSizeContext, derivePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { TEST_IDS } from '@/lib/testIds';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import { GeneralTimerSurface } from '../GeneralTimerSurface';
import { TimerStackView } from '../TimerStackView';
import { TimerSurface } from '../TimerSurface';
import { deriveTimerViewPolicy } from '../timerViewPolicy';
import type { TimerSurfaceModel } from '../useTimerSurfaceModel';

const restLockedModel: TimerSurfaceModel = {
  mainLabel: 'Rest',
  subLabels: ['Round 2 of 3'],
  displayMs: 22_000,
  sessionElapsedMs: 240_000,
  roundCurrent: 2,
  roundTotal: 3,
  roundLabel: 'Round 2 of 3',
  secondaryTimers: [{ id: 'cap', label: 'AMRAP', displayMs: 960_000 }],
  upNext: 'Run 400 m',
  isRunning: true,
  isPaused: false,
  isNextDisabled: false,
  skipFlash: true,
  skipFlashKey: 1,
  polarity: 'rest',
  isRequiredLockActive: true,
};

describe('TimerViewPolicy and unified Minimal/General/Detail behavior (Seam 4b)', () => {
  afterEach(() => {
    cleanup();
  });

  it('decouples size tier from interaction role across sideways phone, compact phone, and passive TV', () => {
    const sidewaysPhone = deriveTimerViewPolicy({
      sizeMode: 'wide',
      isReceiver: false,
      enableGestures: true,
    });
    expect(sidewaysPhone.interactionRole).toBe('touch-or-desk');
    expect(sidewaysPhone.allowSwipeGestures).toBe(true);
    expect(sidewaysPhone.allowStackDrawer).toBe(true);
    expect(sidewaysPhone.showReceiverIndicators).toBe(false);

    const compactPhone = deriveTimerViewPolicy({
      sizeMode: 'compact',
      isReceiver: false,
      enableGestures: true,
    });
    expect(compactPhone.interactionRole).toBe('touch-or-desk');
    expect(compactPhone.allowSwipeGestures).toBe(true);
    expect(compactPhone.allowStackDrawer).toBe(false);

    const passiveTv = deriveTimerViewPolicy({
      sizeMode: 'wide',
      isReceiver: true,
    });
    expect(passiveTv.interactionRole).toBe('passive-tv');
    expect(passiveTv.allowSwipeGestures).toBe(false);
    expect(passiveTv.allowStackDrawer).toBe(false);
    expect(passiveTv.showReceiverIndicators).toBe(true);
  });

  it('preserves touch swipe gestures on sideways 812x375 GeneralTimerSurface when enabled', () => {
    const onNext = vi.fn();
    const onStop = vi.fn();
    render(
      <GeneralTimerSurface
        model={restLockedModel}
        onStart={() => {}}
        onPause={() => {}}
        onStop={onStop}
        onNext={onNext}
        enableGestures={true}
      />,
    );

    const root = screen.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL);
    // Swipe left -> Next
    fireEvent.touchStart(root, { targetTouches: [{ clientX: 300 }] });
    fireEvent.touchMove(root, { targetTouches: [{ clientX: 180 }] });
    fireEvent.touchEnd(root);
    expect(onNext).toHaveBeenCalledTimes(1);

    // Swipe right -> Stop
    fireEvent.touchStart(root, { targetTouches: [{ clientX: 180 }] });
    fireEvent.touchMove(root, { targetTouches: [{ clientX: 300 }] });
    fireEvent.touchEnd(root);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('exposes slide-over Stack & Splits drawer with static script outline on 768px portrait iPad General tier', () => {
    const harness = new RuntimeTestBuilder()
      .withScript('20:00 AMRAP\n  5 Pullups\n  10 Pushups')
      .build();

    render(
      <ScriptRuntimeProvider runtime={harness.runtime}>
        <PanelSizeContext.Provider value={derivePanelSize(768, 1024)}>
          <TimerSurface
            elapsedMs={15_000}
            hasActiveBlock={true}
            isRunning={true}
            isPaused={false}
            workoutTitle="Cindy"
            workoutFormat="20:00 AMRAP"
            onStart={() => {}}
            onPause={() => {}}
            onStop={() => {}}
            onNext={() => {}}
          />
        </PanelSizeContext.Provider>
      </ScriptRuntimeProvider>,
    );

    const drawerToggle = screen.getByTestId(TEST_IDS.TIMER_STACK_DRAWER_TOGGLE);
    expect(drawerToggle).toBeDefined();
    expect(screen.queryByTestId(TEST_IDS.TIMER_STACK_DRAWER)).toBeNull();

    fireEvent.click(drawerToggle);
    expect(screen.getByTestId(TEST_IDS.TIMER_STACK_DRAWER)).toBeDefined();
    expect(screen.getAllByText(/Pullups/i).length).toBeGreaterThan(0);

    harness.dispose();
  });

  it('unifies Detail TimerStackView with Rest polarity, Locked badge, Round chip, welded Up Next caption, and active skip-flash CSS', () => {
    const { container } = render(
      <PanelSizeContext.Provider value={derivePanelSize(1280, 800)}>
        <TimerStackView
          elapsedMs={8_000}
          hasActiveBlock={true}
          isRunning={true}
          isPaused={false}
          primaryTimer={{
            id: 'timer-rest',
            ownerId: 'rest-1',
            timerMemoryId: '',
            label: 'Rest',
            format: 'down',
            durationMs: 30_000,
            accumulatedMs: 8_000,
            role: 'primary',
          }}
          polarity="rest"
          isRequiredLockActive={true}
          roundLabel="Round 2 of 3"
          upNext="Run 400 m"
          skipFlash={true}
          skipFlashKey={2}
          onStart={() => {}}
          onPause={() => {}}
          onStop={() => {}}
          onNext={() => {}}
        />
      </PanelSizeContext.Provider>,
    );

    expect(screen.getByLabelText('Round 2 of 3')).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_UP_NEXT_CAPTION).textContent).toContain('Run 400 m');
    expect(screen.getByText(/Locked/i)).toBeDefined();
    expect(container.querySelector('style')?.textContent).toContain('animation: skip-flash-fade');
  });
});
