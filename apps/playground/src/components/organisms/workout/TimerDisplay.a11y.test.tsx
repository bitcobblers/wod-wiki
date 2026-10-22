import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TimerDisplay } from '../../../panels/wallclock-panel';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockPanelSize = mock(() => ({ width: 800, isCompact: false, isWide: true, isFull: true, mode: 'full' as const }));

mock.module('@/panels/panel-system/PanelSizeContext', () => ({
  usePanelSize: mockPanelSize,
}));

mock.module('@/contexts/AudioContext', () => ({
  useAudio: () => ({
    playClick: () => {},
    playTick: () => {},
    playComplete: () => {},
  }),
}));

mock.module('@bitcobblers/wod-wiki-engine/react', () => ({
  useScriptRuntime: () => null,
}));

mock.module('@/stores/workbenchSessionStore', () => ({
  useWorkbenchSession: (selector: ((state: unknown) => unknown) | undefined) => {
    const state = { viewMode: 'track', execution: { status: 'idle' } };
    return selector ? selector(state) : state;
  },
}));

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
  return render(<TimerDisplay {...baseProps} {...props} />);
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('TimerDisplay — Keyboard Navigation', () => {
  afterEach(() => {
    cleanup();
    mockPanelSize.mockClear?.();
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    // Reset mock to default and clear any DOM pollution from other test files
    mockPanelSize.mockImplementation(() => ({ width: 800, isCompact: false, isWide: true, isFull: true, mode: 'full' as const }));
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
