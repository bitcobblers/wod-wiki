import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  RuntimeFactory,
  createCompiler,
  createParser,
  type ScriptRuntime,
} from '@bitcobblers/wod-wiki-engine';
import { useRuntimeExecution } from '@/hooks/useRuntimeTimer';

describe('WW-051: useRuntimeExecution synchronous elapsed & pause exclusion', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('excludes paused duration from getElapsedTime() and reports final elapsed synchronously on stop()', () => {
    vi.useFakeTimers();
    let fakeMs = 1_700_000_000_000;
    const nowProvider = {
      now: () => new Date(fakeMs),
      nowMs: () => fakeMs,
    };

    const content = 'Timer: 1:00\n10 Burpees';
    const parsed = createParser().read(content);
    const factory = new RuntimeFactory(createCompiler(), nowProvider);
    const runtime = factory.createRuntime({
      id: 'ww051-pause-stop',
      content,
      statements: parsed.statements,
      startLine: 0,
      endLine: 1,
      state: 'idle',
      version: 1,
      createdAt: fakeMs,
    }) as ScriptRuntime;

    const resumeTimestamps: number[] = [];
    const origHandle = runtime.handle.bind(runtime);
    runtime.handle = (event) => {
      if (event.name === 'timer:resume') {
        resumeTimestamps.push(event.timestamp.getTime());
      }
      return origHandle(event);
    };

    const { result, unmount } = renderHook(() => useRuntimeExecution(runtime));

    act(() => {
      result.current.start();
    });
    fakeMs += 3_000;
    act(() => {
      result.current.pause();
    });
    expect(result.current.getElapsedTime()).toBe(3_000);

    // Athlete stays paused for 5,000 ms
    fakeMs += 5_000;
    act(() => {
      result.current.start();
    });
    expect(resumeTimestamps[0]).toBe(fakeMs);

    // Run another 2,000 ms, then pause and immediately stop inside same synchronous call
    fakeMs += 2_000;
    act(() => {
      result.current.pause();
    });
    fakeMs += 4_000; // idle while paused — must NOT be counted
    act(() => {
      result.current.stop();
      expect(result.current.getElapsedTime()).toBe(5_000);
    });
    expect(result.current.elapsedTime).toBe(5_000);

    unmount();
    runtime.dispose();
  });
});
