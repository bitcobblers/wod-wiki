import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  NextEvent,
  RuntimeFactory,
  createCompiler,
  createParser,
  type ScriptRuntime,
} from '@bitcobblers/wod-wiki-engine';
import { useRuntimeExecution } from '@/hooks/useRuntimeTimer';

describe('useRuntimeExecution completion elapsedTime flush', () => {
  afterEach(() => {
    cleanup();
  });

  it('flushes exact nowProvider elapsedTime synchronously when stack completes before the 100ms interval ticks', () => {
    let fakeMs = 1_700_000_000_000;
    const nowProvider = {
      now: () => new Date(fakeMs),
      nowMs: () => fakeMs,
    };

    const content = '5 Burpees';
    const parsed = createParser().read(content);
    const factory = new RuntimeFactory(createCompiler(), nowProvider);
    const runtime = factory.createRuntime({
      id: 'completion-flush-test',
      content,
      statements: parsed.statements,
      startLine: 0,
      endLine: 0,
      state: 'idle',
      version: 1,
      createdAt: fakeMs,
    }) as ScriptRuntime;

    const { result, unmount } = renderHook(() => useRuntimeExecution(runtime));

    act(() => {
      result.current.start();
    });

    // Advance past WaitingToStart -> 5 Burpees
    act(() => {
      runtime.handle(new NextEvent(undefined, nowProvider));
    });

    // Advance 6,500ms on nowProvider without waiting 100ms wall time, then complete
    fakeMs += 6_500;
    act(() => {
      runtime.handle(new NextEvent(undefined, nowProvider));
    });

    expect(result.current.status).toBe('completed');
    expect(result.current.elapsedTime).toBe(6_500);

    unmount();
    runtime.dispose();
  });
});
