import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine/react';
import { formatTimestamp, formatDurationSmart } from '../../lib/formatTime';
import { calculateDuration } from '../../lib/timeUtils';
import { getRuntimeNowMs } from '@bitcobblers/wod-wiki-engine';
import { ScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { RuntimeBlock } from '@bitcobblers/wod-wiki-engine';
import { CountdownTimerBehavior, CountupTimerBehavior } from '@bitcobblers/wod-wiki-engine';
import { JitCompiler } from '@bitcobblers/wod-wiki-engine';
import { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';
import { TimeSpan } from '@bitcobblers/wod-wiki-engine';
import { TimerState } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeBlock } from '@bitcobblers/wod-wiki-engine';
import { RuntimeStack } from '@bitcobblers/wod-wiki-engine';
import { RuntimeClock } from '@bitcobblers/wod-wiki-engine';
import { EventBus } from '@bitcobblers/wod-wiki-engine';

export interface TimerHarnessResult {
  runtime: ScriptRuntime;
  blockKey: string;
  block: IRuntimeBlock;
  timerState: TimerState | undefined;
  controls: {
    start: () => void;
    stop: () => void;
    reset: () => void;
    pause: () => void;
    resume: () => void;
  };
  isRunning: boolean;
  recalculateElapsed: () => void;
}

export interface TimerHarnessProps {
  /** Timer type: 'countdown' or 'countup' */
  timerType: 'countdown' | 'countup';
  /** Initial duration in milliseconds */
  durationMs: number;
  /** Whether the timer should start running immediately */
  autoStart?: boolean;
  /** Optional: Pre-configured time spans for complex scenarios */
  timeSpans?: TimeSpan[];
  /** Children to render with runtime context */
  children: (harness: TimerHarnessResult) => React.ReactNode;
}

/**
 * Timer Test Harness with memory visualization and controls
 *
 * Uses the new consolidated timer behaviors:
 * - CountdownTimerBehavior for timed (countdown) blocks
 * - CountupTimerBehavior for stopwatch (countup) blocks
 */
export const TimerHarness: React.FC<TimerHarnessProps> = ({
  timerType,
  durationMs,
  autoStart = false,
  timeSpans,
  children
}) => {
  const [, setRecalcTrigger] = useState(0);

  // Create minimal runtime with empty script for testing
  const runtime = useMemo(() => {
    const emptyScript = new WhiteboardScript('', []);
    const jitCompiler = new JitCompiler([]);

    // Create dependencies
    const stack = new RuntimeStack();
    const clock = new RuntimeClock();
    const eventBus = new EventBus();

    return new ScriptRuntime(emptyScript, jitCompiler, {
      stack,
      clock,
      eventBus
    });
  }, []);

  // Create block with new behavior-based timer system
  const { block, blockKey, timerState } = useMemo(() => {
    // Use a single self-contained timer behavior based on type
    const behaviors = timerType === 'countdown'
      ? [new CountdownTimerBehavior({ durationMs, label: 'Timer' })]
      : [new CountupTimerBehavior({ label: 'Timer' })];

    const newBlock = new RuntimeBlock({ runtime, sourceIds: [1], behaviors, blockType: 'Timer' });

    // Mount block to trigger behavior initialization
    newBlock.mount(runtime);

    // Get timer state from the block's typed memory
    const timerLoc = newBlock.getMemoryByTag('time')[0];
    let currentState = timerLoc?.metrics[0]?.value as TimerState | undefined;

    // Configure timer state based on props
    if (currentState) {
      let spans: TimeSpan[];

      if (timeSpans) {
        // Use provided time spans (for complex scenarios)
        spans = timeSpans;
      } else if (autoStart) {
        // Running timer: start time in the past, no stop time
        spans = [new TimeSpan(getRuntimeNowMs() - durationMs)];
      } else {
        // Stopped timer: start and stop time
        const now = getRuntimeNowMs();
        spans = [new TimeSpan(now - durationMs, now)];
      }

    // Update timer state with configured spans
      const timeLoc = newBlock.getMemoryByTag('time')[0];
      if (timeLoc?.metrics[0]) {
        timeLoc.update([{ ...timeLoc.metrics[0], value: { ...currentState, spans } }]);
      }

      // Refresh current state
      const updatedLoc = newBlock.getMemoryByTag('time')[0];
      currentState = updatedLoc?.metrics[0]?.value as TimerState | undefined;
    }

    return {
      block: newBlock,
      blockKey: newBlock.key.toString(),
      timerState: currentState
    };
  }, [runtime, timerType, durationMs, autoStart, timeSpans]);

  // timer:resume/pause mutate block memory in place; setRecalcTrigger forces
  // a re-render, so re-read the freshest state from the block on each render.
  const liveState = (block.getMemoryByTag('time')[0]?.metrics[0]?.value as TimerState | undefined) ?? timerState;
  const isRunning = !!liveState && liveState.spans.length > 0 && liveState.spans[liveState.spans.length - 1].ended === undefined;

  // Control functions using event-based approach
  const handleStart = useCallback(() => {
    // Start means resume if paused, or create new span
    runtime.handle({
      name: 'timer:resume',
      timestamp: new Date(),
      data: { blockKey }
    });
    setRecalcTrigger(prev => prev + 1);
  }, [runtime, blockKey]);

  const handleStop = useCallback(() => {
    // Stop means pause the timer
    runtime.handle({
      name: 'timer:pause',
      timestamp: new Date(),
      data: { blockKey }
    });
    setRecalcTrigger(prev => prev + 1);
  }, [runtime, blockKey]);

  const handlePause = useCallback(() => {
    runtime.handle({
      name: 'timer:pause',
      timestamp: new Date(),
      data: { blockKey }
    });
    setRecalcTrigger(prev => prev + 1);
  }, [runtime, blockKey]);

  const handleResume = useCallback(() => {
    runtime.handle({
      name: 'timer:resume',
      timestamp: new Date(),
      data: { blockKey }
    });
    setRecalcTrigger(prev => prev + 1);
  }, [runtime, blockKey]);

  const handleReset = useCallback(() => {
    // Reset clears all spans and starts fresh
    const timeLoc = block.getMemoryByTag('time')[0];
    if (timeLoc?.metrics[0]) {
      const current = timeLoc.metrics[0].value as TimerState | undefined;
      if (current) {
        timeLoc.update([{ ...timeLoc.metrics[0], value: { ...current, spans: [] } }]);
      }
    }
    setRecalcTrigger(prev => prev + 1);
  }, [block]);

  const recalculateElapsed = useCallback(() => {
    setRecalcTrigger(prev => prev + 1);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      block.dispose(runtime);
    };
  }, [block, blockKey, runtime]);

  const harness: TimerHarnessResult = {
    runtime,
    blockKey,
    block,
    timerState,
    controls: {
      start: handleStart,
      stop: handleStop,
      pause: handlePause,
      resume: handleResume,
      reset: handleReset
    },
    isRunning,
    recalculateElapsed
  };

  return (
    <ScriptRuntimeProvider runtime={runtime}>
      <div className="timer-harness">
        {children(harness)}
      </div>
    </ScriptRuntimeProvider>
  );
};

/**
 * Memory Card Component with start/stop table and recalculate functionality
 */
interface MemoryCardProps {
  timeSpans: TimeSpan[];
  isRunning: boolean;
  blockKey: string;
  onRecalculate: () => void;
  timerType: 'countdown' | 'countup';
}

export const MemoryCard: React.FC<MemoryCardProps> = ({
  timeSpans,
  isRunning,
  blockKey,
  onRecalculate,
  timerType
}) => {
  const formatElapsedTime = formatDurationSmart;

  const elapsedMs = calculateDuration(timeSpans, getRuntimeNowMs());
  const elapsedDisplay = timerType === 'countdown'
    ? `-${formatElapsedTime(elapsedMs)}`
    : formatElapsedTime(elapsedMs);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
      {/* Header with recalculate button */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Memory Card</h3>
          <p className="text-sm text-gray-500">Block Key: {blockKey}</p>
        </div>
        <button
          onClick={onRecalculate}
          className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
        >
          Recalculate Elapsed
        </button>
      </div>

      {/* Current State Display */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 p-3 rounded">
          <div className="text-sm text-gray-600">Status</div>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="font-medium">
              {isRunning ? 'Running' : 'Stopped'}
            </span>
          </div>
        </div>
        <div className="bg-gray-50 p-3 rounded">
          <div className="text-sm text-gray-600">Elapsed Time</div>
          <div className="font-mono font-medium mt-1">
            {elapsedDisplay}
          </div>
        </div>
      </div>

      {/* Start/Stop Table */}
      <div>
        <h4 className="text-md font-semibold text-gray-700 mb-3">Time Spans</h4>
        {timeSpans.length === 0 ? (
          <div className="text-gray-500 italic text-sm">No time spans recorded</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-700">#</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700">Start</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700">Stop</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700">Duration</th>
                </tr>
              </thead>
              <tbody>
                {timeSpans.map((span, index) => {
                  const duration = span.started
                    ? span.ended
                      ? Math.round((span.ended - span.started) / 1000)
                      : Math.round((getRuntimeNowMs() - span.started) / 1000)
                    : 0;

                  return (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-2 px-2 font-medium">{index + 1}</td>
                      <td className="py-2 px-2 font-mono text-xs">
                        {formatTimestamp(span.started)}
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">
                        {formatTimestamp(span.ended)}
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">
                        {duration}s
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Timer Controls Component
 */
interface TimerControlsProps {
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}

export const TimerControls: React.FC<TimerControlsProps> = ({
  isRunning,
  onStart,
  onStop,
  onPause,
  onResume,
  onReset
}) => {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Timer Controls</h3>

      <div className="grid grid-cols-2 gap-3">
        {isRunning ? (
          <>
            <button
              onClick={onPause}
              className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors"
            >
              Pause
            </button>
            <button
              onClick={onStop}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              Stop
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onStart}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
            >
              Start
            </button>
            <button
              onClick={onResume}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Resume
            </button>
          </>
        )}

        <button
          onClick={onReset}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors col-span-2"
        >
          Reset
        </button>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        Status: <span className="font-medium">{isRunning ? 'Running' : 'Stopped'}</span>
      </div>
    </div>
  );
};
