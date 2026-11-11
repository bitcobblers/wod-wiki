/**
 * TimerSurface — tier picker tests.
 *
 * Rule (ADR 0003): compact → Minimal · wide → General ·
 * full → Detail (TimerDisplay passthrough). Container size comes from the
 * real PanelSizeContext and the model hook runs against an idle runtime from
 * the shared RuntimeTestBuilder — no module mocks.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { TEST_IDS } from '@/lib/testIds';
import { PanelSizeContext, derivePanelSize, type PanelSizeInfo } from '@/panels/panel-system/PanelSizeContext';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine/react';
import { RuntimeTestBuilder } from '@/testing/harness/RuntimeTestBuilder';
import type { TimerSurfaceModel } from './useTimerSurfaceModel';
import { TimerSurface } from './TimerSurface';

const harness = new RuntimeTestBuilder().withScript('Helen\n3 Rounds\n400m Run').build();

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

const FULL_SIZE = derivePanelSize(1280, 800);

function renderSurface(size: PanelSizeInfo = FULL_SIZE, props: Partial<ComponentProps<typeof TimerSurface>> = {}) {
  return render(
    <ScriptRuntimeProvider runtime={harness.runtime}>
      <PanelSizeContext.Provider value={size}>
        <TimerSurface
          elapsedMs={38_000}
          hasActiveBlock={true}
          isRunning={true}
          isPaused={false}
          onStart={() => {}}
          onPause={() => {}}
          onStop={() => {}}
          onNext={() => {}}
          {...props}
        />
      </PanelSizeContext.Provider>
    </ScriptRuntimeProvider>,
  );
}

describe('TimerSurface', () => {
  afterEach(() => {
    cleanup();
  });

  it('full container renders Detail as a passthrough of the DetailSurface slot', () => {
    renderSurface(FULL_SIZE, { DetailSurface: () => <div data-testid="timer-display-detail" /> });

    expect(screen.getByTestId('timer-display-detail')).toBeDefined();
    expect(screen.queryByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeNull();
  });

  it('wide container renders General', () => {
    renderSurface(derivePanelSize(700, 800));

    expect(screen.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE)).toBeDefined();
  });

  it('short wide host renders the same full General surface', () => {
    renderSurface(derivePanelSize(700, 400));

    // No strip compression: one General view at any height.
    expect(screen.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeDefined();
  });

  it('compact container renders Minimal with the metric prompt row', () => {
    renderSurface(derivePanelSize(375, 780));

    expect(screen.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeDefined();
    expect(screen.queryByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeNull();
  });

  it('omits the metric prompt row only on Detail', () => {
    // Detail (full) — real TimerDisplay fallback renders TimerStackView.
    renderSurface();
    expect(screen.queryByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeNull();

    // General carries the prompt row even on short hosts.
    renderSurface(derivePanelSize(700, 400));
    expect(screen.getByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeDefined();
  });

  it('showMetricPrompts=false drops the row from Minimal and General', () => {
    renderSurface(derivePanelSize(700, 800), { showMetricPrompts: false });
    expect(screen.queryByTestId(TEST_IDS.TIMER_METRIC_PROMPTS)).toBeNull();
  });

  it('modelOverride plumbs through to the rendered surface', () => {
    renderSurface(derivePanelSize(700, 800), { modelOverride: baseModel });

    expect(screen.getByText('Rest')).toBeDefined();
    expect(screen.getByText('Run 400 m')).toBeDefined();
    expect(screen.getByText('Session 12:47')).toBeDefined();
  });

  it('derives isNextDisabled from host handlers', () => {
    renderSurface(derivePanelSize(700, 800), { canNext: false });

    const next = screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });
});
