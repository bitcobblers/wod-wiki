import { afterEach, describe, expect, it } from 'bun:test';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { MemoryLocation, MetricType, type IRuntimeBlock, type IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TEST_IDS } from '@/lib/testIds';
import { ClockCommandBoard } from './ClockCommandBoard';
import { useLiveClockAuthority } from './useLiveClockAuthority';
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

describe('WW-097: Completed / inactive rep controls expose disabled state and feedback', () => {
  it('sets descriptive titles on +/- and disables rep controls when completed or unselected', () => {
    const { rerender } = render(
      <ClockCommandBoard
        snapshot={makeSnapshot({ status: 'completed' })}
        dispatch={() => false}
      />,
    );

    const minusBtn = screen.getByTestId(TEST_IDS.CLOCK_REP_MINUS) as HTMLButtonElement;
    const plusBtn = screen.getByTestId(TEST_IDS.CLOCK_REP_PLUS) as HTMLButtonElement;
    const valuesBtn = screen.getByTestId(TEST_IDS.CLOCK_VALUES_BUTTON) as HTMLButtonElement;
    const pill1 = screen.getByTestId(`${TEST_IDS.CLOCK_REP_SELECT}-occ-1`) as HTMLButtonElement;
    expect(screen.getByTestId(TEST_IDS.CLOCK_REP_VALUE).textContent).toBe('Complete');
    expect(screen.getByTestId(TEST_IDS.CLOCK_REP_VALUE).textContent).not.toContain('Target');
    expect(minusBtn.getAttribute('title')).toBe('Subtract one rep');
    expect(plusBtn.getAttribute('title')).toBe('Add one rep');
    expect(minusBtn.disabled).toBe(true);
    expect(plusBtn.disabled).toBe(true);
    expect(valuesBtn.disabled).toBe(true);
    expect(pill1.disabled).toBe(true);
    expect(minusBtn.getAttribute('aria-disabled')).toBe('true');
    expect(plusBtn.getAttribute('aria-disabled')).toBe('true');
    expect(valuesBtn.getAttribute('aria-disabled')).toBe('true');
    expect(pill1.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Keypad' }));
    const digit1 = screen.getByRole('button', { name: 'Digit 1' }) as HTMLButtonElement;
    expect(digit1.disabled).toBe(true);
    expect(digit1.getAttribute('aria-disabled')).toBe('true');

    rerender(
      <ClockCommandBoard
        snapshot={makeSnapshot({ status: 'running', selectedOccurrenceId: null })}
        dispatch={() => false}
      />,
    );
    expect((screen.getByTestId(TEST_IDS.CLOCK_REP_PLUS) as HTMLButtonElement).disabled).toBe(true);
  });

  it('useLiveClockAuthority surfaces an explicit error and clears stale selection when target is completed or missing', async () => {
    const resultLocs: InstanceType<typeof MemoryLocation>[] = [];
    const block: IRuntimeBlock = {
      key: { toString: () => 'rung-1' },
      sourceIds: [1],
      label: 'Thrusters 21',
      blockType: 'effort',
      isComplete: false,
      getMemoryByTag: (tag: string) =>
        tag === 'metric:display'
          ? [new MemoryLocation('metric:display', [{ type: MetricType.Rep, value: 21, origin: 'parser', image: '21' }, { type: MetricType.Effort, value: 'Thrusters', origin: 'parser', image: 'Thrusters' }])]
          : tag === 'metric:result'
            ? resultLocs
            : [],
      pushMemory: (loc: InstanceType<typeof MemoryLocation>) => { resultLocs.push(loc); },
    } as unknown as IRuntimeBlock;

    const stackListeners = new Set<() => void>();
    const blocks: IRuntimeBlock[] = [block];
    const runtime = {
      stack: { blocks },
      subscribeToStack: (cb: () => void) => {
        stackListeners.add(cb);
        return () => stackListeners.delete(cb);
      },
    } as unknown as IScriptRuntime;

    let authorityRef!: ReturnType<typeof useLiveClockAuthority>;
    function Harness({ status }: { status: 'running' | 'completed' }) {
      const auth = useLiveClockAuthority({
        runtime,
        executionStatus: status,
        actions: { next: () => {}, start: () => {}, playback: () => {}, stop: () => {} },
      });
      authorityRef = auth;
      return auth.snapshot ? (
        <ClockCommandBoard snapshot={auth.snapshot} dispatch={auth.dispatch} />
      ) : null;
    }

    const { rerender } = render(<Harness status="running" />);
    expect(authorityRef.snapshot?.selectedOccurrenceId).toBe('rung-1');

    // Simulate ladder completion while UI dispatches an adjust against the stale id
    (block as { isComplete: boolean }).isComplete = true;
    await act(async () => {
      for (const cb of stackListeners) cb();
    });
    rerender(<Harness status="completed" />);

    expect(authorityRef.snapshot?.selectedOccurrenceId).toBeNull();
    let handled = false;
    await act(async () => {
      handled = authorityRef.dispatch({ kind: 'reps-adjust', occurrenceId: 'rung-1', delta: 1 });
    });
    expect(handled).toBe(false);
    expect(authorityRef.snapshot?.error).toBeTruthy();
  });

  it('tracks FOR TIME 21 -> 15 -> 9 rungs with working controls and clears stale target on completion', () => {
    const dispatched: Array<{ kind: string; occurrenceId?: string; delta?: number }> = [];
    const dispatch = (cmd: { kind: string; occurrenceId?: string; delta?: number }) => {
      dispatched.push(cmd);
      return true;
    };

    const { rerender } = render(
      <ClockCommandBoard
        snapshot={makeSnapshot({
          reps: [{ occurrenceId: 'rung-21', label: 'Thrusters 21', actual: null, target: 21 }],
          selectedOccurrenceId: 'rung-21',
        })}
        dispatch={dispatch as never}
      />,
    );

    expect(screen.getByTestId(TEST_IDS.CLOCK_REP_VALUE).textContent).toBe('— / Target 21');
    fireEvent.click(screen.getByTestId(TEST_IDS.CLOCK_REP_PLUS));
    expect(dispatched).toContainEqual({ kind: 'reps-adjust', occurrenceId: 'rung-21', delta: 1 });

    rerender(
      <ClockCommandBoard
        snapshot={makeSnapshot({
          reps: [{ occurrenceId: 'rung-15', label: 'Thrusters 15', actual: null, target: 15 }],
          selectedOccurrenceId: 'rung-15',
        })}
        dispatch={dispatch as never}
      />,
    );
    expect(screen.getByTestId(TEST_IDS.CLOCK_REP_VALUE).textContent).toBe('— / Target 15');

    rerender(
      <ClockCommandBoard
        snapshot={makeSnapshot({
          reps: [{ occurrenceId: 'rung-9', label: 'Thrusters 9', actual: 9, target: 9 }],
          selectedOccurrenceId: 'rung-9',
        })}
        dispatch={dispatch as never}
      />,
    );
    expect(screen.getByTestId(TEST_IDS.CLOCK_REP_VALUE).textContent).toBe('9 / Target 9');

    // Completed ladder: even if stale reps linger on snapshot, no stale Target 21/9 appears
    rerender(
      <ClockCommandBoard
        snapshot={makeSnapshot({
          status: 'completed',
          reps: [{ occurrenceId: 'rung-21', label: 'Thrusters 21', actual: null, target: 21 }],
          selectedOccurrenceId: 'rung-21',
        })}
        dispatch={dispatch as never}
      />,
    );
    expect(screen.getByTestId(TEST_IDS.CLOCK_REP_VALUE).textContent).toBe('Complete');
    expect(screen.getByTestId(TEST_IDS.CLOCK_REP_VALUE).textContent).not.toContain('Target');
    expect((screen.getByTestId(TEST_IDS.CLOCK_REP_PLUS) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(TEST_IDS.CLOCK_REP_MINUS) as HTMLButtonElement).disabled).toBe(true);
  });
});
