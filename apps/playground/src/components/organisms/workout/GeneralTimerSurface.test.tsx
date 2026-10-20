import React from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GeneralTimerSurface } from './GeneralTimerSurface';
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
  secondaryTimers: [{ id: 'cap', label: 'Cap', displayMs: 600_000 }],
  upNext: 'Run 400 m',
  isRunning: true,
  isPaused: false,
  isNextDisabled: false,
  skipFlash: false,
  skipFlashKey: 0,
};

function renderSurface(model: Partial<TimerSurfaceModel> = {}, workoutTitle?: string) {
  const handlers = {
    onStart: mock(() => {}),
    onPause: mock(() => {}),
    onStop: mock(() => {}),
    onNext: mock(() => {}),
  };
  const utils = render(
    <GeneralTimerSurface model={{ ...baseModel, ...model }} workoutTitle={workoutTitle} {...handlers} />,
  );
  return { ...utils, handlers };
}

describe('GeneralTimerSurface', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders top bar with session clock, workout title and receiver indicators', () => {
    renderSurface({}, 'Helen');

    expect(screen.getByText('Helen')).toBeDefined();
    expect(screen.getByText(/Session 12:47/)).toBeDefined();
  });

  it('hides the title when the host does not know it', () => {
    renderSurface();

    expect(screen.queryByText('Helen')).toBeNull();
  });

  it('renders hero clock and secondary chips including round position', () => {
    renderSurface();

    expect(screen.getByText('00:38')).toBeDefined();
    expect(screen.getByLabelText('Cap 10:00')).toBeDefined();
    expect(screen.getByLabelText('Round 2 of 3')).toBeDefined();
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

  it('shows the skip-flash status when a required timer blocks Next', () => {
    renderSurface({ skipFlash: true, skipFlashKey: 1 });

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText("Timer can't be skipped!")).toBeDefined();
  });
});
