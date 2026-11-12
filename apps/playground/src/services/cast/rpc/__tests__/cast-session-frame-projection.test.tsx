import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  EventBus,
  NextEvent,
  RuntimeStack,
  ScriptRuntime,
  StartSessionAction,
  createAnalyticsEngineForBlock,
  createCompiler,
  createMockClock,
  createParser,
  type WhiteboardScript,
} from '@bitcobblers/wod-wiki-engine';
import { TEST_IDS } from '@/lib/testIds';
import { ReceiverTimerPanel } from '@/panels/wallclock-panel-chromecast';
import type { ClockSnapshot } from '@/clock/clockCommands';
import { FakeRpcTransport, connectPair } from '@/testing/transport';
import { createReceiverSession } from '../ReceiverSessionManager';
import { attachSessionCastProjector } from '../SessionCastProjector';

function makeClockSnapshot(overrides: Partial<ClockSnapshot> = {}): ClockSnapshot {
  return {
    runId: 'cast-run-1',
    phase: 'live',
    status: 'running',
    canNext: true,
    canStop: true,
    stopRequested: false,
    reps: [],
    selectedOccurrenceId: null,
    entry: null,
    error: null,
    saving: false,
    ...overrides,
  };
}

describe('SessionCastProjector + stateless ReceiverTimerPanel over IRpcTransport', () => {
  afterEach(() => {
    cleanup();
  });

  it('streams live Summary Metrics, workout title/format, and skip-attempt flash to a stateless receiver without ScriptRuntimeProvider', () => {
    const sender = new FakeRpcTransport();
    const receiver = new FakeRpcTransport();
    connectPair(sender, receiver);

    const scriptText = '(2 Rounds)\n  10 Kettlebell Swings 24kg\n  *:30 Rest';
    const script = createParser().read(scriptText) as WhiteboardScript;
    const clock = createMockClock(new Date('2026-04-01T15:00:00Z'));
    const runtime = new ScriptRuntime(
      script,
      createCompiler(),
      { stack: new RuntimeStack(), clock, eventBus: new EventBus() },
      {},
      { now: () => new Date(clock.currentDate.getTime()), nowMs: () => clock.currentDate.getTime() },
    );
    const { engine } = createAnalyticsEngineForBlock({
      id: 'cast-block',
      dialect: 'time',
      startLine: 0,
      endLine: 3,
      content: scriptText,
      statements: script.statements,
      state: 'idle',
      version: 1,
      createdAt: clock.currentDate.getTime(),
    });
    runtime.setAnalyticsEngine(engine);
    runtime.do(new StartSessionAction());
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));

    const receiverSession = createReceiverSession(receiver, { audio: false });

    // Push preview first, then flip mode to 'active' without previewData — title must survive!
    sender.send({
      type: 'rpc-workbench-update',
      mode: 'preview',
      previewData: { title: 'Helen', blocks: [] },
    });
    sender.send({
      type: 'rpc-workbench-update',
      mode: 'active',
    });

    let latestWorkbenchTitle: string | undefined;
    receiverSession.onWorkbenchUpdate((wb) => {
      latestWorkbenchTitle = wb.previewData?.title;
    });
    expect(latestWorkbenchTitle).toBe('Helen');

    const detachProjector = attachSessionCastProjector(runtime, sender, {
      workoutTitle: 'Helen',
      workoutFormat: '2 Rounds',
      getExecutionStatus: () => 'running',
    });

    // Complete 10 Kettlebell Swings 24kg -> enters *:30 Rest and emits live Summary Metrics
    clock.advance(25_000);
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));

    // Attempt early skip on *:30 Rest -> triggers skipFlash over Cast frame
    clock.advance(5_000);
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));

    const frame = receiverSession.getSessionFrame();
    expect(frame).not.toBeNull();
    expect(frame?.workoutTitle).toBe('Helen');
    expect(frame?.workoutFormat).toBe('2 Rounds');
    expect(frame?.telemetry.summaries.length).toBeGreaterThan(0);
    expect(frame?.frame.skipFlash).toBe(true);

    // Render stateless ReceiverTimerPanel WITHOUT ScriptRuntimeProvider and with passive idle fade active
    const sendCommand = vi.fn();
    render(
      <ReceiverTimerPanel
        sessionFrame={frame}
        snapshot={makeClockSnapshot()}
        sendCommand={sendCommand}
        controlsIdleHidden={true}
      />,
    );

    expect(screen.getByText('Helen')).toBeDefined();
    expect(screen.getByText("Timer can't be skipped!")).toBeDefined();
    // D-pad focus targets stay mounted even when passive TV chrome is opacity-faded
    expect(screen.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE)).toBeDefined();
    expect(screen.getByTestId(TEST_IDS.TIMER_STOP_SESSION)).toBeDefined();

    detachProjector();
    receiverSession.dispose();
    runtime.dispose();
    sender.dispose();
    receiver.dispose();
  });
});
