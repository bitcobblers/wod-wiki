import React from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MinimalTimerSurface } from './MinimalTimerSurface';
import type { TimerSurfaceModel } from './useTimerSurfaceModel';
import { TEST_IDS } from '@/lib/testIds';

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

  it('WW-127: spans the mobile up-next caption full width with truncation above the control row', () => {
    renderSurface({ upNext: '15 Thrusters 40 kg' });

    const caption = screen.getByTestId(TEST_IDS.TIMER_UP_NEXT_CAPTION);
    expect(caption.textContent).toContain('15 Thrusters 40 kg');
    expect(caption.className).toContain('w-full');
    expect(caption.className).toContain('truncate');
    expect(caption.className).toContain('min-w-0');
    // Caption sits outside the narrow Next button flex-1 wrapper so it gets the full footer width.
    const nextBtn = screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK);
    expect(caption.parentElement).not.toBe(nextBtn.parentElement);
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

  it('WW-064 & WW-096: timer footer controls carry visible labels, type="button", and >=44px classes', () => {
    renderSurface({ isRunning: true });

    const stopBtn = screen.getByTestId(TEST_IDS.TIMER_STOP_SESSION);
    const playPauseBtn = screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE);
    const nextBtn = screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK);

    expect(stopBtn.getAttribute('type')).toBe('button');
    expect(playPauseBtn.getAttribute('type')).toBe('button');
    expect(nextBtn.getAttribute('type')).toBe('button');

    expect(stopBtn.textContent).toContain('Stop');
    expect(playPauseBtn.textContent).toContain('Pause');
    expect(nextBtn.textContent).toContain('Next');

    expect(stopBtn.getAttribute('aria-label')).toBe('Stop Session');
    expect(playPauseBtn.getAttribute('aria-label')).toBe('Pause');
    expect(nextBtn.getAttribute('aria-label')).toBe('Next Block');

    expect(stopBtn.className).toContain('min-h-12');
    expect(playPauseBtn.className).toContain('min-h-[54px]');
    expect(nextBtn.className).toContain('min-h-[54px]');
  });
});
