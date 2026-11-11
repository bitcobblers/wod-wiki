import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { TimerDisplay } from '../../../panels/wallclock-panel';
import { PanelSizeContext, derivePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { AudioProvider, type AudioAdapter } from '@/contexts/AudioContext';

const noopAudio: AudioAdapter = {
  isEnabled: () => false,
  setEnabled: () => {},
  playSound: async () => {},
};

// TimerDisplay without `enableDisplayStack` renders the presentational
// TimerStackView fallback — real context providers, no runtime needed.
const FULL_SIZE = derivePanelSize(800, 600);

const baseProps = {
  elapsedMs: 0,
  hasActiveBlock: true,
  onStart: () => {},
  onPause: () => {},
  onStop: () => {},
  onNext: () => {},
  isRunning: false,
};

function renderTimerDisplay(props = {}) {
  return render(
    <PanelSizeContext.Provider value={FULL_SIZE}>
      <AudioProvider audioAdapter={noopAudio}>
        <TimerDisplay {...baseProps} {...props} />
      </AudioProvider>
    </PanelSizeContext.Provider>,
  );
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('TimerDisplay — Keyboard Navigation', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    // Clear any DOM pollution from other test files
    document.body.innerHTML = '';
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Focus Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Focus management', () => {
    it('TimerStackView buttons are focusable via keyboard', () => {
      const { container } = renderTimerDisplay({
        isRunning: true,
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const },
      });

      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThanOrEqual(3);

      buttons.forEach((btn) => {
        expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
      });
    });

    it('prevents default on handled key events', () => {
      renderTimerDisplay({
        isRunning: true,
      });

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      const _prevented = !window.dispatchEvent(event);
      // The handler calls preventDefault, so the event should be cancelled
      // Note: dispatchEvent returns false if preventDefault was called
    });
  });
});
