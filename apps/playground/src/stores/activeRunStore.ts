/**
 * activeRunStore — Single source of truth for active/pending/parked workout
 * runtimes, execution status, Chromecast subscription registry, and pre-run
 * user metric overrides.
 *
 * Replaces the retired 1,051-line `workbenchSessionStore` and separate
 * `runtimeStore` maps with one lightweight store (~130 LOC).
 */
import { create } from 'zustand';
import { MetricContainer, type IMetric, type IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import type { UseRuntimeExecutionReturn } from '@bitcobblers/wod-wiki-engine/react';
import type { SubscriptionManager } from '@/hooks/useRuntimeTimer';
import type { ScriptBlock } from '@/components/Editor/types';
import type { ResultOrigin } from '@/types/storage';
import type { SaveNoteInput } from '@/services/persistence';
import type { CapturedRun } from '@/services/runCapture';

export type ActiveExecutionStatus = UseRuntimeExecutionReturn['status'];

export interface ActiveExecutionSnapshot {
  status: ActiveExecutionStatus;
  elapsedTime: number;
  stepCount: number;
  startTime?: number | null;
}

export interface PendingRuntime {
  block: ScriptBlock;
  snapshot?: SaveNoteInput;
  captured?: CapturedRun;
  noteId: string;
  origin?: ResultOrigin;
  returnTo?: string;
}

export interface ParkedRun {
  runtimeId: string;
  block: ScriptBlock;
  noteId: string;
  runtime: IScriptRuntime;
  captured?: CapturedRun;
  journalDate?: string;
}

export const pendingRuntimes = new Map<string, PendingRuntime>();
export const parkedRuns = new Map<string, ParkedRun>();
export const activeRuntimes = new Map<string, ScriptBlock>();

export function parkRun(run: ParkedRun): void {
  parkedRuns.set(run.runtimeId, run);
}

export function takeParkedRun(runtimeId: string): ParkedRun | undefined {
  const run = parkedRuns.get(runtimeId);
  if (run) parkedRuns.delete(runtimeId);
  return run;
}

export function peekParkedRun(runtimeId: string): ParkedRun | undefined {
  return parkedRuns.get(runtimeId);
}

export function findParkedRunByDate(journalDate: string): ParkedRun | undefined {
  for (const run of parkedRuns.values()) {
    if (run.journalDate === journalDate) return run;
  }
  return undefined;
}

export function clearParkedRun(runtimeId: string): void {
  parkedRuns.delete(runtimeId);
}

export interface HaltedRunMarker {
  sessionId: string;
  runtimeId?: string;
  noteId?: string;
  workoutTitle?: string;
  timestamp: number;
  elapsedMs?: number;
}

const HALTED_RUN_STORAGE_KEY = 'wodwiki:halted-run:v1';

function getSessionStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Ignore storage access errors in restricted contexts
  }
  return null;
}

function readHaltedRunFromStorage(): HaltedRunMarker | null {
  const storage = getSessionStorageSafe();
  if (!storage) return null;
  try {
    const raw = storage.getItem(HALTED_RUN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HaltedRunMarker>;
    if (typeof parsed.sessionId !== 'string' || !parsed.sessionId) return null;
    if (typeof parsed.timestamp !== 'number' || !Number.isFinite(parsed.timestamp)) return null;
    return {
      sessionId: parsed.sessionId,
      ...(typeof parsed.runtimeId === 'string' ? { runtimeId: parsed.runtimeId } : {}),
      ...(typeof parsed.noteId === 'string' ? { noteId: parsed.noteId } : {}),
      ...(typeof parsed.workoutTitle === 'string' ? { workoutTitle: parsed.workoutTitle } : {}),
      timestamp: parsed.timestamp,
      ...(typeof parsed.elapsedMs === 'number' && Number.isFinite(parsed.elapsedMs)
        ? { elapsedMs: parsed.elapsedMs }
        : {}),
    };
  } catch {
    return null;
  }
}

function writeHaltedRunToStorage(marker: HaltedRunMarker): void {
  const storage = getSessionStorageSafe();
  if (!storage) return;
  try {
    storage.setItem(HALTED_RUN_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Ignore quota / security errors
  }
}

function removeHaltedRunFromStorage(): void {
  const storage = getSessionStorageSafe();
  if (!storage) return;
  try {
    storage.removeItem(HALTED_RUN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export interface ActiveRunState {
  runtime: IScriptRuntime | null;
  activeNoteId: string | null;
  activeSessionId: string | null;
  haltedRun: HaltedRunMarker | null;
  subscriptionManager: SubscriptionManager | null;
  execution: ActiveExecutionSnapshot;
  userOutputOverrides: Map<string, MetricContainer>;

  setRuntime: (runtime: IScriptRuntime | null, activeNoteId?: string | null) => void;
  setActiveSessionMeta: (sessionId: string | null, noteId?: string | null) => void;
  setHaltedRun: (marker: HaltedRunMarker | null) => void;
  setSubscriptionManager: (manager: SubscriptionManager | null) => void;
  setExecution: (execution: Partial<ActiveExecutionSnapshot> & Pick<ActiveExecutionSnapshot, 'status'>) => void;
  resetExecution: () => void;
  setUserOverride: (blockKey: string, metrics: MetricContainer | IMetric[]) => void;
  clearUserOverride: (blockKey: string) => void;
}

const IDLE_EXECUTION: ActiveExecutionSnapshot = {
  status: 'idle',
  elapsedTime: 0,
  stepCount: 0,
  startTime: null,
};

export const useActiveRunStore = create<ActiveRunState>((set) => ({
  runtime: null,
  activeNoteId: null,
  activeSessionId: null,
  haltedRun: readHaltedRunFromStorage(),
  subscriptionManager: null,
  execution: IDLE_EXECUTION,
  userOutputOverrides: new Map<string, MetricContainer>(),

  setRuntime: (runtime, activeNoteId = null) =>
    set((state) => ({
      runtime,
      activeNoteId: activeNoteId ?? (runtime ? state.activeNoteId : null),
      ...(runtime === null ? { execution: IDLE_EXECUTION } : {}),
    })),

  setActiveSessionMeta: (activeSessionId, activeNoteId = null) =>
    set(() => ({
      activeSessionId,
      activeNoteId,
    })),

  setHaltedRun: (haltedRun) => set({ haltedRun }),

  setSubscriptionManager: (subscriptionManager) => set({ subscriptionManager }),

  setExecution: (next) =>
    set((state) => ({
      execution: {
        ...state.execution,
        ...next,
      },
    })),

  resetExecution: () => set({ execution: IDLE_EXECUTION }),

  setUserOverride: (blockKey, metrics) =>
    set((state) => {
      const next = new Map(state.userOutputOverrides);
      const container =
        metrics instanceof MetricContainer
          ? metrics
          : MetricContainer.from(metrics, blockKey);
      next.set(blockKey, container);
      return { userOutputOverrides: next };
    }),

  clearUserOverride: (blockKey) =>
    set((state) => {
      if (!state.userOutputOverrides.has(blockKey)) return state;
      const next = new Map(state.userOutputOverrides);
      next.delete(blockKey);
      return { userOutputOverrides: next };
    }),
}));

export function recordHaltedRun(marker: HaltedRunMarker): void {
  writeHaltedRunToStorage(marker);
  useActiveRunStore.getState().setHaltedRun(marker);
}

export function getHaltedRun(noteId?: string | null): HaltedRunMarker | null {
  const stored = readHaltedRunFromStorage() ?? useActiveRunStore.getState().haltedRun;
  if (!stored) return null;
  if (noteId && stored.noteId && stored.noteId !== noteId) {
    return null;
  }
  return stored;
}

export function clearHaltedRun(sessionId?: string): void {
  const current = readHaltedRunFromStorage() ?? useActiveRunStore.getState().haltedRun;
  if (sessionId && current && current.sessionId !== sessionId) {
    return;
  }
  removeHaltedRunFromStorage();
  useActiveRunStore.getState().setHaltedRun(null);
}
