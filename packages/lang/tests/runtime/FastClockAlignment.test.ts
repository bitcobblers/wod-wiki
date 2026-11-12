import { describe, expect, it } from 'vitest';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { RuntimeFactory } from '../../src/runtime/compiler/RuntimeFactory';
import { NextEvent } from '../../src/runtime/events/NextEvent';
import { TickEvent } from '../../src/runtime/events/TickEvent';

describe('RuntimeFactory fast-clock alignment', () => {
  it('aligns RuntimeClock with injected INowProvider so countdown blocks do not falsely expire on their first tick', () => {
    // Simulate accelerated clock already 60s ahead of Date.now() after page navigation
    let fakeMs = Date.now() + 60_000;
    const nowProvider = {
      now: () => new Date(fakeMs),
      nowMs: () => fakeMs,
    };

    const content = 'Timer: 0:06\n5 Burpees';
    const parsed = createParser().read(content);
    const factory = new RuntimeFactory(createCompiler(), nowProvider);
    const runtime = factory.createRuntime({
      id: 'fast-clock-test',
      content,
      statements: parsed.statements,
      startLine: 0,
      endLine: 1,
      state: 'idle',
      version: 1,
      createdAt: fakeMs,
    });
    expect(runtime).not.toBeNull();

    // Advance past WaitingToStart into Timer: 0:06
    runtime!.handle(new NextEvent(undefined, nowProvider));
    expect(runtime!.stack.current?.label).toContain('0:06');

    // First 20ms tick at +400ms accelerated time MUST NOT falsely expire the 6s countdown
    fakeMs += 400;
    runtime!.handle(new TickEvent(undefined, nowProvider));
    expect(runtime!.stack.current?.label).toContain('0:06');

    // Advancing past 6,000ms expires Timer: 0:06 naturally into 5 Burpees
    fakeMs += 5_700;
    runtime!.handle(new TickEvent(undefined, nowProvider));
    expect(runtime!.stack.current?.label?.toLowerCase()).toContain('burpees');

    runtime!.dispose();
  });
});
