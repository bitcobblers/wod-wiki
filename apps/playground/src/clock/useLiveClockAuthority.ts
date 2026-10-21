/**
 * useLiveClockAuthority — snapshot builder + authoritative command handler for
 * a browser live clock (RuntimeTimerPanel overlay, workbench track clock).
 *
 * Projects the runtime's movement occurrences (via @/services/actuals) into a
 * ClockSnapshot, registers it at live priority 0 with the shared keyboard
 * enabled, and implements every ClockCommand against the SAME handle functions
 * the on-screen buttons call — keyboard, touch and Cast commands all pass one
 * gate. The runtime itself remains the final authority for required-timer
 * skip restrictions (ExitBehavior/skip-attempt); this hook only mirrors the
 * paused/completed gates so the UI and the handler can never disagree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import {
  commitActualReps,
  findActualRepOccurrence,
  getActualRepTargets,
  readActualReps,
} from '@/services/actuals';
import {
  createClockRunId,
  dispatchClockCommand,
  useClockController,
  type ClockCommand,
  type ClockEntry,
  type ClockPhase,
  type ClockRepState,
  type ClockSnapshot,
  type ClockStatus,
} from './clockCommands';

export interface LiveClockActions {
  /** Advance to the next segment (Next button semantics). */
  next: () => void;
  /** Start an idle runtime (Ready screen / initial Start). */
  start: () => void;
  /** Toggle start/pause/continue for the current execution state. */
  playback: () => void;
  /** Confirmed stop: halt, persist partial results, host close behavior. */
  stop: () => void;
  /** Review dismiss (optional — false when the host has no dismiss). */
  dismiss?: () => void;
}

export interface UseLiveClockAuthorityOptions {
  runtime: IScriptRuntime | null;
  executionStatus: ClockStatus;
  actions: LiveClockActions;
  /** False keeps the controller registered as a placeholder that owns nothing
   * (e.g. wizard overlay showing). */
  enabled?: boolean;
  /** Persist-in-flight flag surfaced on the snapshot (post-run hosts). */
  saving?: boolean;
}

export interface LiveClockAuthority {
  snapshot: ClockSnapshot | null;
  dispatch: (command: ClockCommand) => boolean;
}

export function useLiveClockAuthority({
  runtime,
  executionStatus,
  actions,
  enabled = true,
  saving = false,
}: UseLiveClockAuthorityOptions): LiveClockAuthority {
  const runIdRef = useRef(createClockRunId());
  const [stackTick, setStackTick] = useState(0);
  const [repTick, setRepTick] = useState(0);
  const [stopRequested, setStopRequested] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The entry is captured (pinned) when opened and stays open until cancel,
  // skip or a successful save. If the pinned occurrence rotates out mid-draft
  // the save is rejected with the card and draft intact — never auto-closed.
  const [entryState, setEntryState] = useState<ClockEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latest = useRef({ runtime, executionStatus, actions });
  latest.current = { runtime, executionStatus, actions };

  useEffect(() => {
    if (!runtime) return undefined;
    return runtime.subscribeToStack(() => setStackTick((t) => t + 1));
  }, [runtime]);

  const reps: ClockRepState[] = useMemo(() => {
    if (!runtime) return [];
    void stackTick;
    void repTick;
    return getActualRepTargets(runtime).map((t) => {
      const found = findActualRepOccurrence(runtime, t.occurrenceId);
      return {
        occurrenceId: t.occurrenceId,
        label: t.label,
        target: t.target,
        actual: found ? readActualReps(found.block, found.occurrence) : null,
      };
    });
  }, [runtime, stackTick, repTick]);

  // Auto-select a lone movement; grouped movements require explicit selection.
  // Selection follows occurrences across segment transitions and resets when
  // the selected occurrence rotates out (new round).
  useEffect(() => {
    if (reps.length === 1) {
      setSelectedId(reps[0]!.occurrenceId);
      return;
    }
    setSelectedId((prev) =>
      prev !== null && reps.some((r) => r.occurrenceId === prev) ? prev : null,
    );
  }, [reps]);

  // Transient context errors ("No rep movements", "Select a movement first")
  // describe the occurrence list at rejection time — once occurrences exist
  // again they are stale and must not linger on the board.
  useEffect(() => {
    if (reps.length > 0) setError((prev) => prev === 'No rep movements' || prev === 'No rep movements to record' ? null : prev);
  }, [reps]);

  // The entry is pinned at open (`entryState`): a stale target (segment
  // rotated mid-draft) is rejected on save with the card and draft intact —
  // never auto-closed or retargeted.

  const entry: ClockEntry | null = entryState;

  const status = executionStatus;
  const phase: ClockPhase = status === 'idle' ? 'ready' : status === 'completed' ? 'review' : 'live';
  const canNext = status === 'running' || status === 'idle';
  const canStop = status === 'running' || status === 'paused';

  const snapshot: ClockSnapshot | null = useMemo(() => {
    if (!enabled || !runtime) return null;
    return {
      runId: runIdRef.current,
      phase,
      status,
      canNext,
      canStop,
      stopRequested,
      reps,
      selectedOccurrenceId: selectedId,
      entry,
      error,
      saving,
    };
  }, [enabled, runtime, phase, status, canNext, canStop, stopRequested, reps, selectedId, entry, error, saving]);

  const handler = useCallback(
    (command: ClockCommand): boolean => {
      const rt = latest.current.runtime;
      const st = latest.current.executionStatus;
      const act = latest.current.actions;
      if (entryState !== null && ['next', 'ready-start', 'playback', 'stop-request', 'reps-select'].includes(command.kind)) return false;
      const findOccurred = (occurrenceId: string | null) =>
        rt !== null && occurrenceId !== null ? findActualRepOccurrence(rt, occurrenceId) : undefined;
      const openEntry = (occurrenceId: string): boolean => {
        const rep = reps.find((r) => r.occurrenceId === occurrenceId);
        if (!rep) {
          setError('Movement no longer active');
          return false;
        }
        setEntryState({
          fieldId: `reps:${rep.occurrenceId}`,
          label: rep.label,
          metricType: 'reps',
          domain: 'integer',
          intent: 'actual',
          required: false,
          value: rep.actual,
          unit: 'reps',
          index: 0,
          total: 1,
        });
        setError(null);
        return true;
      };

      switch (command.kind) {
        case 'next':
          // Paused and confirmation-gated Next are rejected at the authority;
          // the runtime remains the final word on required timers.
          if (stopRequested) return false;
          if (st === 'paused') {
            setError('Paused — press play to continue first');
            return false;
          }
          if (st !== 'running' && st !== 'idle') return false;
          act.next();
          return true;
        case 'ready-start':
          if (stopRequested || st !== 'idle') return false;
          act.start();
          return true;
        case 'playback':
          if (stopRequested || st === 'completed') return false;
          setError(null);
          act.playback();
          return true;
        case 'stop-request':
          if (stopRequested || entryState !== null || (st !== 'running' && st !== 'paused')) return false;
          setStopRequested(true);
          return true;
        case 'stop-cancel':
          if (!stopRequested) return false;
          setStopRequested(false);
          return true;
        case 'stop-confirm':
          if (!stopRequested) return false;
          setStopRequested(false);
          act.stop();
          return true;
        case 'values-open': {
          if (entryState !== null || stopRequested) return false;
          // Grouped movements require explicit target selection — never
          // silently credit the first movement.
          const target = selectedId ?? (reps.length === 1 ? reps[0]!.occurrenceId : null);
          if (target === null) {
            setError(reps.length > 1 ? 'Select a movement first' : 'No rep movements to record');
            return false;
          }
          return openEntry(target);
        }
        case 'entry-cancel':
          if (entryState === null) return false;
          setEntryState(null);
          setError(null);
          return true;
        case 'entry-save': {
          if (entryState === null || command.fieldId !== entryState.fieldId) return false;
          if (!Number.isSafeInteger(command.value) || command.value < 0) {
            setError('Reps must be a whole number of 0 or more');
            return false;
          }
          const occurrenceId = entryState.fieldId.slice('reps:'.length);
          const found = findOccurred(occurrenceId);
          // Pinned occurrence rotated out: reject with the card and draft
          // intact — never auto-close or retarget a stale draft.
          if (!found) {
            setError('Movement no longer active — draft preserved');
            return false;
          }
          commitActualReps(found.block, command.value, found.occurrence);
          setRepTick((t) => t + 1);
          setEntryState(null);
          setError(null);
          return true;
        }
        case 'entry-skip':
          // Actuals stay unknown (≠ 0); the card closes without writing.
          if (entryState === null || command.fieldId !== entryState.fieldId) return false;
          setEntryState(null);
          setError(null);
          return true;
        case 'reps-adjust': {
          if (entryState !== null || stopRequested) return false;
          const occurrenceId = command.occurrenceId !== '' ? command.occurrenceId : selectedId;
          if (occurrenceId === null) {
            setError(reps.length > 1 ? 'Select a movement first' : 'No rep movements');
            return false;
          }
          const found = findOccurred(occurrenceId);
          if (!found) return false;
          const nextValue = (readActualReps(found.block, found.occurrence) ?? 0) + command.delta;
          if (nextValue < 0) return true; // clamped at zero — consumed no-op
          commitActualReps(found.block, nextValue, found.occurrence);
          setRepTick((t) => t + 1);
          setError(null);
          return true;
        }
        case 'reps-set': {
          if (entryState !== null || stopRequested) return false;
          if (!Number.isSafeInteger(command.value) || command.value < 0) {
            setError('Reps must be a whole number of 0 or more');
            return false;
          }
          const occurrenceId = command.occurrenceId !== '' ? command.occurrenceId : selectedId;
          const found = findOccurred(occurrenceId);
          if (!found) return false;
          commitActualReps(found.block, command.value, found.occurrence);
          setRepTick((t) => t + 1);
          setError(null);
          return true;
        }
        case 'reps-select':
          if (stopRequested) return false;
          if (!reps.some((r) => r.occurrenceId === command.occurrenceId)) return false;
          setSelectedId(command.occurrenceId);
          setError(null);
          return true;
        case 'choice-select':
          // Live clock carries no choice fields — the wizard authority answers.
          return false;
        case 'dismiss':
          if (act.dismiss) {
            act.dismiss();
            return true;
          }
          return false;
      }
    },
    [reps, selectedId, entryState, stopRequested],
  );

  useClockController(snapshot, handler, 0, { keyboard: true });

  const dispatch = useCallback((command: ClockCommand) => dispatchClockCommand(runIdRef.current, command), []);

  return { snapshot, dispatch };
}
