import { afterEach, describe, expect, it } from 'bun:test';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TEST_IDS } from '@/lib/testIds';
import { ClockCommandBoard } from './ClockCommandBoard';
import type { ClockSnapshot } from './clockCommands';

afterEach(() => {
  cleanup();
});

function makeSnapshot(overrides: Partial<ClockSnapshot> = {}): ClockSnapshot {
  return {
    runId: 'run-ww096',
    phase: 'live',
    status: 'running',
    canNext: true,
    canStop: true,
    stopRequested: false,
    reps: [
      { occurrenceId: 'occ-1', label: 'Pullups', actual: null, target: 5 },
      { occurrenceId: 'occ-2', label: 'Pushups', actual: null, target: 10 },
    ],
    selectedOccurrenceId: 'occ-1',
    entry: null,
    error: null,
    saving: false,
    ...overrides,
  };
}

describe('WW-096: ClockCommandBoard >=44px touch targets & keypad accessibility', () => {
  it('enforces min-h-11 and min-w-11 classes on toggles, pills, Values, and all 12 keypad keys with digit labels', () => {
    render(
      <ClockCommandBoard
        snapshot={makeSnapshot()}
        dispatch={() => true}
      />,
    );

    const navBtn = screen.getByRole('button', { name: 'Nav' });
    const keypadBtn = screen.getByRole('button', { name: 'Keypad' });
    const keysCheckBtn = screen.getByTestId(TEST_IDS.CLOCK_KEY_CHECK_BUTTON);
    const valuesBtn = screen.getByTestId(TEST_IDS.CLOCK_VALUES_BUTTON);
    const pill1 = screen.getByTestId(`${TEST_IDS.CLOCK_REP_SELECT}-occ-1`);
    const pill2 = screen.getByTestId(`${TEST_IDS.CLOCK_REP_SELECT}-occ-2`);

    for (const control of [navBtn, keypadBtn, keysCheckBtn, valuesBtn, pill1, pill2]) {
      expect(control.className).toContain('min-h-11');
      expect(control.className).toContain('min-w-11');
    }

    fireEvent.click(keypadBtn);

    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
    for (const d of digits) {
      const btn = screen.getByRole('button', { name: `Digit ${d}` });
      expect(btn.getAttribute('aria-label')).toBe(`Digit ${d}`);
      expect(btn.getAttribute('title')).toBe(`Digit ${d}`);
      expect(btn.className).toContain('min-h-11');
      expect(btn.className).toContain('min-w-11');
    }

    const backBtn = screen.getByRole('button', { name: 'Backspace' });
    const setBtn = screen.getByRole('button', { name: 'Set reps' });
    expect(backBtn.getAttribute('title')).toBe('Backspace');
    expect(setBtn.getAttribute('title')).toBe('Set reps');
    expect(backBtn.className).toContain('min-h-11');
    expect(backBtn.className).toContain('min-w-11');
    expect(setBtn.className).toContain('min-h-11');
    expect(setBtn.className).toContain('min-w-11');
  });
});
