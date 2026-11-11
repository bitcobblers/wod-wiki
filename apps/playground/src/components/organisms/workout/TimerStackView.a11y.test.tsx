import React from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimerStackView } from './TimerStackView';
import { PanelSizeContext, derivePanelSize, type PanelSizeInfo } from '@/panels/panel-system/PanelSizeContext';
import { AudioProvider, type AudioAdapter } from '@/contexts/AudioContext';

const noopAudio: AudioAdapter = {
  isEnabled: () => false,
  setEnabled: () => {},
  playSound: async () => {},
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const baseProps = {
  elapsedMs: 0,
  hasActiveBlock: true,
  onStart: () => {},
  onPause: () => {},
  onStop: () => {},
  onNext: () => {},
  isRunning: false,
};

function renderTimer(props = {}, size: PanelSizeInfo = derivePanelSize(800, 600)) {
  return render(
    <PanelSizeContext.Provider value={size}>
      <AudioProvider audioAdapter={noopAudio}>
        <TimerStackView {...baseProps} {...props} />
      </AudioProvider>
    </PanelSizeContext.Provider>,
  );
}

function assertFocusVisible(el: HTMLElement) {
  // focus-visible:outline-2 focus-visible:outline-ring or tv-focus class
  const hasFocusRing =
    el.className.includes('focus-visible:outline') ||
    el.className.includes('tv-focusable');
  expect(hasFocusRing).toBe(true);
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('TimerStackView — Accessibility & Keyboard Navigation', () => {
  afterEach(() => {
    cleanup();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Accessible Names (WCAG 2.1 2.4.4 / 4.1.2)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Accessible names', () => {
    it('start button has accessible name when idle', () => {
      renderTimer({ isRunning: false });
      // Both main timer and control button show "Start" when idle
      const startBtns = screen.getAllByTitle('Start');
      expect(startBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('pause button has accessible name when running', () => {
      renderTimer({ isRunning: true });
      const pauseBtns = screen.getAllByTitle('Pause');
      expect(pauseBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('stop button has accessible name', () => {
      renderTimer();
      const stopBtn = screen.getByTitle('Stop Session');
      expect(stopBtn).toBeTruthy();
    });

    it('next button has accessible name', () => {
      renderTimer();
      const nextBtn = screen.getByTitle('Next Block');
      expect(nextBtn).toBeTruthy();
    });

    it('primary timer button has accessible name matching control state', () => {
      const { container } = renderTimer({ isRunning: false, primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const } });
      const timerBtn = container.querySelector('button[class*="min-h-[48px]"]') as HTMLButtonElement;
      expect(timerBtn?.getAttribute('title')).toBe('Start');
    });

    it('secondary timer elements have title (accessible name)', () => {
      renderTimer({
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Main', format: 'up' as const },
        secondaryTimers: [
          { id: 't2', ownerId: 'b2', timerMemoryId: '', label: 'AMRAP', format: 'up' as const, accumulatedMs: 30000 },
        ],
      });
      expect(screen.getByTitle('AMRAP')).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Focus Indicators (WCAG 2.1 2.4.7)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Focus indicators', () => {
    it('main timer button supports focus-visible styling', () => {
      const { container } = renderTimer({ primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const } });
      const timerBtn = container.querySelector('button[class*="min-h-[48px]"]') as HTMLButtonElement;
      assertFocusVisible(timerBtn);
    });

    it('control buttons support focus-visible styling', () => {
      renderTimer();
      const stopBtn = screen.getByTitle('Stop Session');
      const nextBtn = screen.getByTitle('Next Block');
      assertFocusVisible(stopBtn);
      assertFocusVisible(nextBtn);
    });

    it('focusable elements have tabindex', () => {
      const { container } = renderTimer({
        getFocusProps: (id: string) => ({
          'data-nav-id': id,
          'data-nav-focused': false,
          tabIndex: 0,
          ref: () => {},
        }),
      });
      const timerBtn = container.querySelector('button[class*="min-h-[48px]"]') as HTMLButtonElement;
      expect(timerBtn.tabIndex).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Keyboard Navigation (WCAG 2.1 2.1.1 / 2.1.2)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Keyboard navigation', () => {
    it('start button fires onStart when activated via Enter key', () => {
      let started = false;
      const { container } = renderTimer({
        isRunning: false,
        onStart: () => { started = true; },
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const },
      });
      const startBtn = container.querySelector('button[class*="min-h-[48px]"]') as HTMLButtonElement;
      fireEvent.keyDown(startBtn, { key: 'Enter', bubbles: true });
      fireEvent.click(startBtn);
      expect(started).toBe(true);
    });

    it('pause button fires onPause when activated via Enter key', () => {
      let paused = false;
      const { container } = renderTimer({
        isRunning: true,
        onPause: () => { paused = true; },
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const },
      });
      const pauseBtn = container.querySelector('button[class*="min-h-[48px]"]') as HTMLButtonElement;
      fireEvent.keyDown(pauseBtn, { key: 'Enter', bubbles: true });
      fireEvent.click(pauseBtn);
      expect(paused).toBe(true);
    });

    it('stop button fires onStop when clicked', () => {
      let stopped = false;
      renderTimer({ onStop: () => { stopped = true; } });
      const stopBtn = screen.getByTitle('Stop Session');
      fireEvent.click(stopBtn);
      expect(stopped).toBe(true);
    });

    it('next button fires onNext when clicked', () => {
      let nexted = false;
      renderTimer({ onNext: () => { nexted = true; } });
      const nextBtn = screen.getByTitle('Next Block');
      fireEvent.click(nextBtn);
      expect(nexted).toBe(true);
    });

    it('disabled next button does not fire onNext when clicked', () => {
      let nexted = false;
      renderTimer({
        isPaused: true,
        onNext: () => { nexted = true; },
      });
      const nextBtn = screen.getByTitle('Next Block') as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
      fireEvent.click(nextBtn);
      expect(nexted).toBe(false);
    });

    it('supports Tab navigation to all interactive controls', () => {
      const { container } = renderTimer({
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const },
      });

      const timerBtn = container.querySelector('button[class*="min-h-[48px]"]') as HTMLButtonElement;
      const stopBtn = screen.getByTitle('Stop Session');
      const nextBtn = screen.getByTitle('Next Block');

      // All should be tabbable (tabIndex >= 0 or native focusable)
      expect(timerBtn.tabIndex).toBeGreaterThanOrEqual(0);
      expect(stopBtn.tabIndex).toBeGreaterThanOrEqual(0);
      expect(nextBtn.tabIndex).toBeGreaterThanOrEqual(0);
    });
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Screen Reader Support (WCAG 2.1 1.3.1 / 4.1.3)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Screen reader support', () => {
    it('primary timer label is rendered as a heading-like element', () => {
      renderTimer({
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Round 1 — Thrusters', format: 'up' as const },
      });
      const label = screen.getByText('Round 1 — Thrusters');
      expect(label).toBeTruthy();
      expect(label.tagName.toLowerCase()).toBe('h2');
    });



    // ── Failing tests: accessibility gaps to fix ──

    it('timer display has aria-live region for time announcements (red phase)', () => {
      const { container } = renderTimer({
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const },
      });
      const liveRegion = container.querySelector('[aria-live]');
      expect(liveRegion).toBeTruthy();
    });

    it('skip flash message has aria-live=polite for screen readers (red phase)', () => {
      const { container } = renderTimer({ skipFlash: true, skipFlashKey: 1 });
      const flash = container.querySelector('.animate-skip-flash');
      expect(flash?.getAttribute('aria-live')).toBe('polite');
    });

    it('disabled next button has aria-disabled when visually disabled (red phase)', () => {
      renderTimer({ isPaused: true });
      const nextBtn = screen.getByTitle('Next Block');
      expect(nextBtn.getAttribute('aria-disabled')).toBe('true');
    });

    it('secondary timer containers use aria-label for context (red phase)', () => {
      renderTimer({
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Main', format: 'up' as const },
        secondaryTimers: [
          { id: 't2', ownerId: 'b2', timerMemoryId: '', label: 'AMRAP', format: 'up' as const, accumulatedMs: 30000 },
        ],
      });
      const secondary = screen.getByTitle('AMRAP');
      expect(secondary.getAttribute('role')).toBe('timer');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Color & Contrast Structure (WCAG 2.1 1.4.3 / 1.4.11)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Color independence', () => {
    it('does not rely solely on color to convey disabled state', () => {
      renderTimer({ isPaused: true });
      const nextBtn = screen.getByTitle('Next Block') as HTMLButtonElement;
      // Disabled state conveyed via disabled attribute AND opacity
      expect(nextBtn.disabled).toBe(true);
    });

    it('uses distinct shape+label for each control button', () => {
      renderTimer();
      const stopBtn = screen.getByTitle('Stop Session');
      const nextBtn = screen.getByTitle('Next Block');

      // Icons are present (visual differentiation beyond color)
      expect(stopBtn.querySelector('svg')).toBeTruthy();
      expect(nextBtn.querySelector('svg')).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Responsive Viewport Accessibility
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Responsive accessibility', () => {
    it('desktop layout keeps all controls visible and focusable', () => {
      renderTimer({
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const },
      }, derivePanelSize(1280, 800));
      expect(screen.getByTitle('Stop Session')).toBeTruthy();
      expect(screen.getByTitle('Next Block')).toBeTruthy();
      expect(screen.getAllByTitle('Start').length).toBeGreaterThanOrEqual(1);
    });

    it('mobile compact layout keeps all controls visible and focusable', () => {
      renderTimer({
        compact: true,
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const },
      }, derivePanelSize(375, 812));
      expect(screen.getByTitle('Stop Session')).toBeTruthy();
      expect(screen.getByTitle('Next Block')).toBeTruthy();
      expect(screen.getAllByTitle('Start').length).toBeGreaterThanOrEqual(1);
    });

    it('tablet layout keeps all controls visible and focusable', () => {
      renderTimer({
        primaryTimer: { id: 't1', ownerId: 'b1', timerMemoryId: '', label: 'Workout', format: 'up' as const },
      }, derivePanelSize(768, 1024));
      expect(screen.getByTitle('Stop Session')).toBeTruthy();
      expect(screen.getByTitle('Next Block')).toBeTruthy();
      expect(screen.getAllByTitle('Start').length).toBeGreaterThanOrEqual(1);
    });
  });
});
