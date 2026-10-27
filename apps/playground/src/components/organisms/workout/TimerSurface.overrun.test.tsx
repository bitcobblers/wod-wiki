/**
 * Finding 7 — UI half of the rest-overrun contract.
 *
 * When a countdown rest reaches 00:00 (overrun) the surface must keep showing
 * the live session clock clamped at 00:00, keep Next usable as the escape
 * hatch, and NOT show the "Timer can't be skipped!" flash — that flash is
 * reserved for a runtime `timer:skip-attempt` on an unexpired required timer.
 * Model-level seam: the runtime drives skipFlash via `timer:skip-attempt`
 * (useTimerSurfaceModel); these tests pin what the surfaces render at zero.
 */
import React from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GeneralTimerSurface } from './GeneralTimerSurface';
import { MinimalTimerSurface } from './MinimalTimerSurface';
import type { TimerSurfaceModel } from './useTimerSurfaceModel';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';

const overrunModel: TimerSurfaceModel = {
  mainLabel: 'Rest',
  subLabels: ['Round 1 of 2'],
  displayMs: 0, // countdown hit zero; runtime still on rest until expiry lands
  sessionElapsedMs: 767_000,
  roundCurrent: 1,
  roundTotal: 2,
  roundLabel: 'Round 1 of 2',
  secondaryTimers: [],
  upNext: '10 Pullups',
  isRunning: true,
  isPaused: false,
  isNextDisabled: false,
  skipFlash: false,
  skipFlashKey: 0,
};

type Surface = React.FC<React.ComponentProps<typeof MinimalTimerSurface>>;

const surfaces: Array<[string, Surface]> = [
  ['MinimalTimerSurface', MinimalTimerSurface],
  ['GeneralTimerSurface', GeneralTimerSurface],
];

function renderOverrun(Surface: Surface) {
  const handlers = {
    onStart: mock(() => {}),
    onPause: mock(() => {}),
    onStop: mock(() => {}),
    onNext: mock(() => {}),
  };
  const utils = render(<Surface model={overrunModel} {...handlers} />);
  return { ...utils, handlers };
}

describe('rest overrun at zero (Finding 7)', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(surfaces)('%s shows the clock clamped at 00:00 while the session is still live', (_name, Surface) => {
    renderOverrun(Surface);
    expect(screen.getByText('00:00')).toBeDefined();
    expect(screen.getByText('Rest')).toBeDefined();
  });

  it.each(surfaces)('%s keeps Next enabled and dispatching at zero (working escape hatch)', (_name, Surface) => {
    const { handlers } = renderOverrun(Surface);
    const next = screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });

  it.each(surfaces)('%s does not flash "Timer can\'t be skipped!" at zero overrun', (_name, Surface) => {
    renderOverrun(Surface);
    expect(screen.queryByText("Timer can't be skipped!")).toBeNull();
  });
});
