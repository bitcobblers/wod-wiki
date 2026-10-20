import React from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MinimalTimerSurface } from './MinimalTimerSurface';
import type { TimerSurfaceModel } from './useTimerSurfaceModel';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';

const baseModel: TimerSurfaceModel = {
  mainLabel: 'Rest',
  subLabels: ['Round 2 of 3'],
  displayMs: 38_000,
  sessionElapsedMs: 767_000,
  roundCurrent: 2,
  roundTotal: 3,
  roundLabel: 'Round 2 of 3',
  secondaryTimers: [{ id: 'rest', label: 'Rest', displayMs: 38_000 }],
  upNext: 'Run 400 m',
  isRunning: true,
  isPaused: false,
  isNextDisabled: false,
  skipFlash: false,
  skipFlashKey: 0,
};

function renderSurface(model: Partial<TimerSurfaceModel> = {}) {
  const handlers = {
    onStart: mock(() => {}),
    onPause: mock(() => {}),
    onStop: mock(() => {}),
    onNext: mock(() => {}),
  };
  const utils = render(
    <MinimalTimerSurface model={{ ...baseModel, ...model }} {...handlers} />,
  );
  return { ...utils, handlers };
}

describe('MinimalTimerSurface', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the status strip with session clock and round dots', () => {
    renderSurface();

    expect(screen.getByTestId('timer-status-strip')).toBeDefined();
    // 767s → 12:47
    expect(screen.getByText('12:47')).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'Round 2 of 3' })).toBeDefined();
  });

  it('renders hero label, sublabel and countdown clock', () => {
    renderSurface();

    expect(screen.getByRole('heading', { name: 'Rest' })).toBeDefined();
    expect(screen.getByText('Round 2 of 3')).toBeDefined();
    expect(screen.getByRole('timer')).toBeDefined();
    expect(screen.getByText('00:38')).toBeDefined();
  });

  it('does not render secondary chips on the minimal surface', () => {
    renderSurface();

    // Chips band is reserved but empty: no secondary timer labels rendered
    expect(screen.queryByLabelText('Rest 0:38')).toBeNull();
  });

  it('welds the up-next line to the Next button', () => {
    renderSurface();

    const caption = screen.getByTestId(TEST_IDS.TIMER_UP_NEXT_CAPTION);
    expect(caption.textContent).toContain('Up next:');
    expect(caption.textContent).toContain('Run 400 m');
  });

  it('dispatches stop / pause / next from the control triad', () => {
    const { handlers } = renderSurface();

    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_STOP_SESSION));
    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE));
    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK));

    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    expect(handlers.onPause).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });

  it('tapping the hero clock pauses while running', () => {
    const { handlers } = renderSurface({ isRunning: true });

    // Both the hero clock and the pause control carry title="Pause" while
    // running — the clock is the first one in document order.
    fireEvent.click(screen.getAllByTitle('Pause')[0]);

    expect(handlers.onPause).toHaveBeenCalledTimes(1);
  });

  it('disables Next while paused', () => {
    const { handlers } = renderSurface({ isPaused: true, isNextDisabled: true });

    fireEvent.click(screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK));

    expect(handlers.onNext).toHaveBeenCalledTimes(0);
  });
});
