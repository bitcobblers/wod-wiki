/**
 * TimerSurface — tier picker tests.
 *
 * Rule (ADR 0003): compact → Minimal · wide → General ·
 * full → Detail (TimerDisplay passthrough). Container size comes from
 * usePanelSize, so these tests mock the panel-size context and the model hook
 * (TimerSurface must render without a live runtime, same as the surface tests).
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';
import type { PanelSizeInfo } from '@/panels/panel-system/PanelSizeContext';
import type { TimerSurfaceHandlers, TimerSurfaceModel } from './useTimerSurfaceModel';

const baseModel: TimerSurfaceModel = {
  mainLabel: 'Rest',
  subLabels: ['Round 2 of 3'],
  displayMs: 38_000,
  sessionElapsedMs: 767_000,
  roundCurrent: 2,
  roundTotal: 3,
  roundLabel: 'Round 2 of 3',
  secondaryTimers: [{ id: 'cap', label: 'Cap', displayMs: 600_000 }],
  upNext: 'Run 400 m',
  isRunning: true,
  isPaused: false,
  isNextDisabled: false,
  skipFlash: false,
  skipFlashKey: 0,
};

const FULL_SIZE: PanelSizeInfo = {
  width: 1280,
  height: 800,
  isCompact: false,
  isWide: true,
  isFull: true,
  isShort: false,
  mode: 'full',
};

const panelSize = mock((): PanelSizeInfo => FULL_SIZE);

mock.module('@/panels/panel-system/PanelSizeContext', () => ({
  usePanelSize: panelSize,
}));

const modelSpy = mock((_handlers: TimerSurfaceHandlers) => baseModel);
mock.module('./useTimerSurfaceModel', () => ({
  useTimerSurfaceModel: modelSpy,
}));

const timerDisplaySpy = mock(() => <div data-testid="timer-display-detail" />);
mock.module('@/panels/wallclock-panel', () => ({
  TimerDisplay: timerDisplaySpy,
}));

// MetricTrackerCard pulls the engine's useLiveAnalytics → useScriptRuntime;
// the picker only owns the slot, not the row's internals.
mock.module('@/components/organisms/track/MetricTrackerCard', () => ({
  MetricTrackerCard: () => null,
}));

const { TimerSurface } = await import('./TimerSurface');

function renderSurface() {
  return render(
    <TimerSurface
      elapsedMs={38_000}
      hasActiveBlock={true}
      isRunning={true}
      isPaused={false}
      onStart={() => {}}
      onPause={() => {}}
      onStop={() => {}}
      onNext={() => {}}
    />,
  );
}

describe('TimerSurface', () => {
  afterEach(() => {
    cleanup();
    panelSize.mockImplementation((): PanelSizeInfo => FULL_SIZE);
  });

  it('full container renders Detail as a TimerDisplay passthrough', () => {
    renderSurface();

    expect(screen.getByTestId('timer-display-detail')).toBeDefined();
    expect(screen.queryByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeNull();
  });

  it('wide container renders General', () => {
    panelSize.mockImplementation((): PanelSizeInfo => ({
      ...FULL_SIZE,
      width: 700,
      isFull: false,
      mode: 'wide',
    }));
    renderSurface();

    expect(screen.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeDefined();
    expect(screen.queryByTestId('timer-display-detail')).toBeNull();
  });

  it('short wide host renders the same full General surface', () => {
    panelSize.mockImplementation((): PanelSizeInfo => ({
      ...FULL_SIZE,
      width: 700,
      height: 400,
      isFull: false,
      isShort: true,
      mode: 'wide',
    }));
    renderSurface();

    // No strip compression: one General view at any height.
    expect(screen.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeDefined();
  });

  it('compact container renders Minimal with the metric prompt row', () => {
    panelSize.mockImplementation((): PanelSizeInfo => ({
      ...FULL_SIZE,
      width: 375,
      height: 780,
      isCompact: true,
      isWide: false,
      isFull: false,
      isShort: false,
      mode: 'compact',
    }));
    renderSurface();

    expect(screen.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeDefined();
    expect(screen.queryByTestId('timer-display-detail')).toBeNull();
  });

  it('omits the metric prompt row only on Detail', () => {
    // Detail (full) — default mock state.
    renderSurface();
    expect(screen.queryByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeNull();

    // General carries the prompt row even on short hosts.
    panelSize.mockImplementation((): PanelSizeInfo => ({
      ...FULL_SIZE,
      width: 700,
      height: 400,
      isFull: false,
      isShort: true,
      mode: 'wide',
    }));
    renderSurface();
    expect(screen.getByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeDefined();
  });

  it('derives the surface model from the host handlers', () => {
    panelSize.mockImplementation((): PanelSizeInfo => ({
      ...FULL_SIZE,
      width: 700,
      isFull: false,
      mode: 'wide',
    }));
    renderSurface();

    expect(modelSpy).toHaveBeenCalled();
    const handlers = modelSpy.mock.calls[0]?.[0];
    expect(handlers).toBeDefined();
    expect(handlers?.isPaused).toBe(false);
    expect(typeof handlers?.onStart).toBe('function');
    expect(typeof handlers?.onNext).toBe('function');
  });
});