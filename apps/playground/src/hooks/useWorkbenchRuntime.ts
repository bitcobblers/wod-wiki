import { useCallback, useEffect, useRef } from 'react';
import { useRuntimeLifecycle } from '@/contexts/RuntimeLifecycleProvider';
import { useWorkoutEvents } from './useWorkoutEvents';
import { useRuntimeExecution, NextEvent, RegisterEventHandlerAction, UnregisterEventHandlerAction } from './useRuntimeTimer';
import type { IEventHandler, IEvent, IScriptRuntime } from './useRuntimeTimer';
import { audioService } from '@/hooks/useBrowserServices';
import type { WorkoutEvent } from '@/hooks/useBrowserServices';
import type { Sessions, ScriptBlock } from '@/components/Editor/types';
import { toStoredOutputStatement } from '@/components/Editor/types';
import { wallClockNow } from '@bitcobblers/wod-wiki-engine';

/**
 * Hook to encapsulate Workbench runtime logic.
 */
export const useWorkbenchRuntime = <T extends ScriptBlock | null = ScriptBlock | null>(
    _viewMode: string,
    _selectedBlock: T,
    completeWorkout: (results: Sessions, resultId?: string) => void,
    startWorkout: (block: ScriptBlock) => void
) => {
    const { runtime, initializeRuntime, disposeRuntime } = useRuntimeLifecycle();
    const execution = useRuntimeExecution(runtime);
    const latestRef = useRef({ runtime, execution, completeWorkout });
    latestRef.current = { runtime, execution, completeWorkout };

    // Register Global Audio Handler when runtime is available
    useEffect(() => {
        if (runtime) {
            const audioHandler: IEventHandler = {
                id: 'global-audio-handler',
                name: 'GlobalAudioHandler',
                handler: (event: IEvent, _runtime: IScriptRuntime) => {
                    if (event.name === 'sound:play' && event.data) {
                        const { sound, volume } = event.data as { sound: string, volume?: number };
                        if (sound) {
                            audioService.playSound(sound, volume).catch(() => {
                                // Sound playback failed silently
                            });
                        }
                    }
                    return [];
                }
            };

            // Register the handler
            const action = new RegisterEventHandlerAction(audioHandler, 'global');
            action.do(runtime);

            // Cleanup on unmount or runtime change
            return () => {
                const unregisterAction = new UnregisterEventHandlerAction('global-audio-handler');
                unregisterAction.do(runtime);
            };
        }
    }, [runtime]);

    // Save partial results on unmount if workout is still running/paused
    useEffect(() => {
        return () => {
            // Read via latestRef — the [completeWorkout] dep means this closure
            // would otherwise hold the MOUNT-TIME execution state and the
            // partial save would silently never fire for stable callbacks.
            const { execution: latestExecution, runtime: activeRuntime } = latestRef.current;

            const isFinishing = latestExecution.status === 'running' || latestExecution.status === 'paused';
            if (isFinishing && latestExecution.startTime) {
                const now = activeRuntime?.nowProvider ?? wallClockNow;
                console.log('[useWorkbenchRuntime] Saving partial workout results on unmount');
                // Same finalize + logs as the formal completion paths — a
                // navigated-away session is still a real session, with facts.
                activeRuntime?.finalizeAnalytics();
                latestRef.current.completeWorkout({
                    startTime: latestExecution.startTime,
                    endTime: now.nowMs(),
                    duration: latestExecution.elapsedTime,
                    logs: (activeRuntime?.getOutputStatements() || []).map(toStoredOutputStatement),
                    completed: false // Explicitly marked as partial
                });
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [completeWorkout]); // Minimal deps to ensure it runs on unmount with final values in closure

    // Auto-complete: when the runtime stack empties (all blocks done),
    // save output statements and navigate to review automatically.
    useEffect(() => {
        if (execution.status === 'completed' && execution.startTime) {
            const now = latestRef.current.runtime?.nowProvider ?? wallClockNow;
            // Finalize summary metrics before completion
            runtime?.finalizeAnalytics();

            completeWorkout({
                startTime: execution.startTime,
                endTime: now.nowMs(),
                duration: execution.elapsedTime,
                logs: (runtime?.getOutputStatements() || []).map(toStoredOutputStatement),
                completed: true
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires ONCE on transition to 'completed'; including runtime/elapsed would re-fire on every tick
  }, [execution.status]); // Only fires on status transition to 'completed'

    // Initialize runtime when entering track view with selected block
    // Note: Consumer needs to use useEffect to call initializeRuntime/disposeRuntime based on viewMode/selectedBlock
    // This hook just provides the callbacks and state

    const handleStart = useCallback(() => latestRef.current.execution.start(), []);
    const handlePause = useCallback(() => latestRef.current.execution.pause(), []);
    const handleStop = useCallback(() => {
        const { runtime, execution, completeWorkout } = latestRef.current;

        execution.stop();
        const now = latestRef.current.runtime?.nowProvider ?? wallClockNow;
        // Finalize summary metrics before completion
        runtime?.finalizeAnalytics();
        
        completeWorkout({
            startTime: execution.startTime ?? now.nowMs(),
            endTime: now.nowMs(),
            duration: execution.elapsedTime,
            logs: (runtime?.getOutputStatements() || []).map(toStoredOutputStatement),
            completed: true
        });
    }, []);

    const handleNext = useCallback(() => {
        const { runtime, execution } = latestRef.current;

        // Sender-side paused gate: paused Next is rejected at the handler, so
        // every route (keyboard, touch, legacy Cast handles) hits the same
        // gate. The runtime remains the final authority for required timers.
        if (execution.status === 'paused') return;
        if (runtime && execution.status !== 'completed') {
            runtime.handle(new NextEvent(undefined, runtime.nowProvider));
            if (execution.status !== 'running') {
                execution.start();
            }
        }
    }, []);

    const handleStartWorkoutAction = useCallback((block: ScriptBlock) => {
        startWorkout(block);
    }, [startWorkout]);

    const handleWorkoutEvent = useCallback((event: WorkoutEvent) => {
        switch (event.type) {
            case 'start-workout':
                handleStartWorkoutAction(event.block);
                break;
            case 'stop-workout':
                completeWorkout(event.results);
                break;
            case 'pause-workout':
                execution.pause();
                break;
            case 'resume-workout':
                execution.start();
                break;
            case 'next-segment':
                if (runtime) {
                    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
                    if (execution.status !== 'running') {
                        execution.start();
                    }
                }
                break;
        }
    }, [handleStartWorkoutAction, completeWorkout, execution, runtime]);

    useWorkoutEvents(handleWorkoutEvent, [handleWorkoutEvent]);

    return {
        runtime,
        initializeRuntime,
        disposeRuntime,
        execution,
        handleStart,
        handlePause,
        handleStop,
        handleNext,
        handleStartWorkoutAction
    };
};
