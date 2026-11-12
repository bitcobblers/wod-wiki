/**
 * SessionClockProjection — single deep module projecting live clock state,
 * semantic Work/Rest/Final5/Paused/Overrun polarity, required skip-lock
 * visibility, deduplicated secondary timers, immediate lookahead, and Effort
 * rep targets from an `IScriptRuntime`.
 *
 * Pure and DOM-free: runs identically in Tier 1 engine tests, browser React
 * views (Minimal, General, Detail), and the Cast frame projector.
 */

import {
  MetricContainer,
  MetricType,
  type IMetric,
} from '@bitcobblers/wod-wiki-core';
import { metricPresentation } from '../../metrics';
import { calculateDuration } from '../../utils/timeUtils';
import type { IRuntimeBlock } from '../contracts/IRuntimeBlock';
import type { IScriptRuntime } from '../contracts/IScriptRuntime';
import type { RoundState, TimerDirection, TimerPolarity, TimerState } from '../memory/MemoryTypes';
import { TimeSpan } from '../models/TimeSpan';

export type SessionVisualPolarity = 'work' | 'rest' | 'final5' | 'paused' | 'overrun';

export type SessionExecutionStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface SerializedTimerSpan {
  readonly started: number;
  readonly ended?: number;
}

export interface ProjectedSecondaryTimer {
  readonly id: string;
  readonly label: string;
  readonly displayMs: number;
  readonly direction: TimerDirection;
  readonly durationMs?: number;
  readonly spans: readonly SerializedTimerSpan[];
}

export interface ProjectedRepTarget {
  readonly occurrenceId: string;
  readonly blockKey: string;
  readonly sourceId?: number;
  readonly label: string;
  readonly target: number | null;
  readonly actual: number | null;
}

export interface SessionClockFrame {
  readonly mainLabel: string;
  readonly subLabels?: string[];
  readonly displayMs: number;
  readonly direction: TimerDirection;
  readonly durationMs?: number;
  readonly activeSpans: readonly SerializedTimerSpan[];
  readonly basePolarity: TimerPolarity;
  readonly required: boolean;
  readonly sessionElapsedMs: number;
  readonly sessionSpans: readonly SerializedTimerSpan[];
  readonly polarity: SessionVisualPolarity;
  readonly isRequiredLockActive: boolean;
  readonly roundCurrent?: number;
  readonly roundTotal?: number;
  readonly roundLabel?: string;
  readonly secondaryTimers: ProjectedSecondaryTimer[];
  readonly upNext: string | null;
  readonly repTargets: ProjectedRepTarget[];
  readonly isRunning: boolean;
  readonly isPaused: boolean;
  readonly isNextDisabled: boolean;
  readonly skipFlash: boolean;
  readonly skipFlashKey: number;
}

export interface SessionClockProjectionOptions {
  readonly nowMs?: number;
  readonly executionStatus?: SessionExecutionStatus;
  readonly canNextOverride?: boolean;
  readonly skipFlash?: boolean;
  readonly skipFlashKey?: number;
}

const EXCLUDED_REP_BLOCK_TYPES: Record<string, true> = {
  Rounds: true,
  Group: true,
  AMRAP: true,
  EMOM: true,
  SessionRoot: true,
  Root: true,
  Timer: true,
  Rest: true,
};

function toSpans(spans: readonly SerializedTimerSpan[]): TimeSpan[] {
  return spans.map((s) => new TimeSpan(s.started, s.ended));
}

function serializeSpans(spans: readonly TimeSpan[]): SerializedTimerSpan[] {
  return spans.map((s) =>
    s.ended !== undefined ? { started: s.started, ended: s.ended } : { started: s.started },
  );
}

export function resolveVisualPolarity(params: {
  readonly isPaused: boolean;
  readonly basePolarity: TimerPolarity;
  readonly direction: TimerDirection;
  readonly durationMs?: number;
  readonly displayMs: number;
}): SessionVisualPolarity {
  if (params.isPaused) return 'paused';
  if (params.direction === 'down' && params.durationMs !== undefined && params.durationMs > 0) {
    if (params.displayMs <= 0) return 'overrun';
    if (params.displayMs <= 5_000) return 'final5';
  }
  return params.basePolarity === 'rest' ? 'rest' : 'work';
}

export function isRequiredCountdownLocked(params: {
  readonly isPaused: boolean;
  readonly required: boolean;
  readonly direction: TimerDirection;
  readonly durationMs?: number;
  readonly displayMs: number;
}): boolean {
  return (
    !params.isPaused &&
    params.required &&
    params.direction === 'down' &&
    params.durationMs !== undefined &&
    params.displayMs > 0
  );
}

const WATCHED_CLOCK_MEMORY_TAGS = [
  'time',
  'round',
  'display',
  'metric:display',
  'metric:result',
  'metric:next',
] as const;

export interface SessionClockInputSignal {
  readonly skipFlash: boolean;
  readonly skipFlashKey: number;
}

/**
 * Shared runtime observer for stack changes, block memory mutations, and 3s
 * `timer:skip-attempt` flashes. Reused by both React (`useSessionClockProjection`)
 * and Cast (`SessionCastProjector`).
 */
export function observeSessionClockInputs(
  runtime: IScriptRuntime,
  onChange: (signal: SessionClockInputSignal) => void,
): () => void {
  let skipFlash = false;
  let skipFlashKey = 0;
  let skipTimer: Parameters<typeof clearTimeout>[0];
  let memoryUnsubs: Array<() => void> = [];

  const emit = () => onChange({ skipFlash, skipFlashKey });

  const rebindBlockMemory = () => {
    memoryUnsubs.forEach((fn) => fn());
    memoryUnsubs = [];
    for (const block of runtime.stack.blocks) {
      for (const tag of WATCHED_CLOCK_MEMORY_TAGS) {
        for (const loc of block.getMemoryByTag(tag)) {
          memoryUnsubs.push(loc.subscribe(emit));
        }
      }
    }
  };

  rebindBlockMemory();
  const unsubStack = runtime.subscribeToStack(() => {
    rebindBlockMemory();
    emit();
  });
  const unsubSkip = runtime.eventBus.on(
    'timer:skip-attempt',
    () => {
      skipFlashKey += 1;
      skipFlash = true;
      clearTimeout(skipTimer);
      emit();
      skipTimer = setTimeout(() => {
        skipFlash = false;
        emit();
      }, 3000);
    },
    'session-clock-inputs-flash',
  );

  return () => {
    clearTimeout(skipTimer);
    unsubStack();
    unsubSkip();
    memoryUnsubs.forEach((fn) => fn());
    memoryUnsubs = [];
  };
}

/**
 * Pure span-based frame interpolation. Used by the stateless Cast receiver and
 * local animation loops to advance clock digits and polarity at 60fps without
 * holding live `IRuntimeBlock` references.
 */
export function interpolateSessionClockFrame(
  frame: SessionClockFrame,
  nowMs: number,
): SessionClockFrame {
  const activeElapsed = calculateDuration(toSpans(frame.activeSpans), nowMs);
  const displayMs =
    frame.direction === 'down' && frame.durationMs !== undefined
      ? Math.max(0, frame.durationMs - activeElapsed)
      : activeElapsed;

  const sessionElapsedMs =
    frame.sessionSpans.length > 0
      ? calculateDuration(toSpans(frame.sessionSpans), nowMs)
      : frame.sessionElapsedMs;

  const secondaryTimers = frame.secondaryTimers.map((st) => {
    const elapsed = calculateDuration(toSpans(st.spans), nowMs);
    return {
      ...st,
      displayMs:
        st.direction === 'down' && st.durationMs !== undefined
          ? Math.max(0, st.durationMs - elapsed)
          : elapsed,
    };
  });

  const polarity = resolveVisualPolarity({
    isPaused: frame.isPaused,
    basePolarity: frame.basePolarity,
    direction: frame.direction,
    durationMs: frame.durationMs,
    displayMs,
  });

  const isRequiredLockActive = isRequiredCountdownLocked({
    isPaused: frame.isPaused,
    required: frame.required,
    direction: frame.direction,
    durationMs: frame.durationMs,
    displayMs,
  });

  return {
    ...frame,
    displayMs,
    sessionElapsedMs,
    secondaryTimers,
    polarity,
    isRequiredLockActive,
  };
}

function readBlockRound(block: IRuntimeBlock | undefined): {
  current: number;
  total?: number;
  label: string;
} | undefined {
  if (!block) return undefined;
  const round = block.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
  if (!round || typeof round.current !== 'number') return undefined;
  const display = block.getMemoryByTag('display')[0]?.metrics[0]?.value as
    | { roundDisplay?: string }
    | undefined;
  const label =
    display?.roundDisplay ??
    (round.total !== undefined
      ? `Round ${round.current} of ${round.total}`
      : `Round ${round.current}`);
  return { current: round.current, total: round.total, label };
}

function readNextPreviewText(blocks: readonly IRuntimeBlock[]): string | null {
  for (const block of blocks) {
    const nextLocs = block.getMemoryByTag('metric:next');
    if (nextLocs.length === 0) continue;
    const merged = MetricContainer.empty(block.key.toString());
    for (const loc of nextLocs) merged.merge(loc.metrics);
    if (merged.length > 0) {
      return (
        metricPresentation
          .presentGroup([...merged], 'timer-subtitle')
          .filter((t) => t.visible)
          .map((t) => t.label)
          .filter(Boolean)
          .join(' ')
          .trim() || null
      );
    }
  }
  return null;
}

function extractRepTargets(blocks: readonly IRuntimeBlock[]): ProjectedRepTarget[] {
  const targets: ProjectedRepTarget[] = [];
  for (const block of blocks) {
    const blockType = block.blockType ?? '';
    if (EXCLUDED_REP_BLOCK_TYPES[blockType]) {
      continue;
    }
    if (block.getMemoryByTag('children:status').length > 0) continue;

    const displayLocs = block.getMemoryByTag('metric:display');
    const resultLocs = block.getMemoryByTag('metric:result');
    const blockKey = block.key.toString();
    const grouped = displayLocs.length > 1;

    for (let idx = 0; idx < displayLocs.length; idx++) {
      const loc = displayLocs[idx]!;
      let plannedTarget: number | null = null;
      let movementText: string | undefined;
      for (const m of loc.metrics) {
        if (m.type === MetricType.Rep && m.origin !== 'user' && typeof m.value === 'number') {
          plannedTarget = m.value;
        }
        if (
          (m.type === MetricType.Effort || m.type === MetricType.Action) &&
          typeof m.value === 'string' &&
          m.value
        ) {
          movementText ??= m.value;
        }
      }

      const hasMovementIdentity =
        plannedTarget !== null ||
        loc.metrics.some(
          (m) =>
            (m.type === MetricType.Effort || m.type === MetricType.Action) &&
            (typeof m.value === 'string' || typeof m.image === 'string'),
        );
      if (!hasMovementIdentity) continue;

      let actual: number | null = null;
      if (resultLocs.length > 0) {
        const resLoc = resultLocs[Math.min(idx, resultLocs.length - 1)];
        if (resLoc) {
          const userHits: IMetric[] = [];
          for (const m of resLoc.metrics) {
            if (m.origin === 'user' && m.type === MetricType.Rep && typeof m.value === 'number') {
              userHits.push(m);
            }
          }
          const last = userHits[userHits.length - 1];
          if (last) actual = last.value as number;
        }
      }

      const sourceId = block.sourceIds[idx] ?? idx;
      targets.push({
        occurrenceId: grouped ? `${blockKey}:${sourceId}` : blockKey,
        blockKey,
        ...(grouped ? { sourceId } : {}),
        label: grouped && movementText ? movementText : block.label,
        target: plannedTarget,
        actual,
      });
    }
  }
  return targets;
}

export function projectSessionClock(
  runtime: IScriptRuntime | null | undefined,
  options: SessionClockProjectionOptions = {},
): SessionClockFrame {
  const status: SessionExecutionStatus = options.executionStatus ?? 'idle';
  const isPaused = status === 'paused';
  const skipFlash = options.skipFlash ?? false;
  const skipFlashKey = options.skipFlashKey ?? 0;

  if (!runtime) {
    return {
      mainLabel: 'Timer',
      displayMs: 0,
      direction: 'up',
      activeSpans: [],
      basePolarity: 'work',
      required: false,
      sessionElapsedMs: 0,
      sessionSpans: [],
      polarity: isPaused ? 'paused' : 'work',
      isRequiredLockActive: false,
      secondaryTimers: [],
      upNext: null,
      repTargets: [],
      isRunning: status === 'running',
      isPaused,
      isNextDisabled: isPaused || options.canNextOverride === false,
      skipFlash,
      skipFlashKey,
    };
  }

  const nowMs = options.nowMs ?? runtime.nowProvider.nowMs();
  // runtime.stack.blocks is leaf -> root (index 0 = leaf, last = root).
  const blocks = runtime.stack.blocks;
  const orderedRootToLeaf = [...blocks].reverse();

  // Display entries (root -> leaf), matching useStackDisplayRows semantics.
  const displayEntries: Array<{
    block: IRuntimeBlock;
    displayRows: MetricContainer[];
    label: string;
    isLeaf: boolean;
  }> = [];

  orderedRootToLeaf.forEach((block, index) => {
    if (block.blockType === 'Root' && !block.label) return;
    const displayRows = block.getMemoryByTag('metric:display').map((loc) => loc.metrics);
    if (displayRows.length === 0 && !block.label) return;
    displayEntries.push({
      block,
      displayRows,
      label: block.label,
      isLeaf: index === orderedRootToLeaf.length - 1,
    });
  });

  const leafEntry = displayEntries.find((e) => e.isLeaf);
  const roundsEntry =
    displayEntries.find((e) => e.block.blockType === 'Rounds') ??
    displayEntries.find((e) => e.block.getMemoryByTag('round').length > 0 && e.block.blockType !== 'SessionRoot');
  const roundInfo = readBlockRound(roundsEntry?.block);
  const roundsLabel = roundInfo?.label ?? roundsEntry?.label;

  // Stack timers (leaf -> root)
  const allTimers: Array<{ block: IRuntimeBlock; timer: TimerState; isPinned: boolean }> = [];
  for (const block of blocks) {
    const timer = block.getMemoryByTag('time')[0]?.metrics[0]?.value as TimerState | undefined;
    if (!timer) continue;
    allTimers.push({
      block,
      timer,
      isPinned: timer.role === 'primary',
    });
  }

  const isAnyTimerRunning = allTimers.some((t) =>
    t.timer.spans.some((s) => s.ended === undefined),
  );

  // Primary timer resolution: leaf Rest (either RestBlock or authored Rest polarity)
  // always overrides parent pinned timers; otherwise root-closest pinned wins.
  const topTimer = allTimers[0];
  const primaryTimer =
    topTimer && (topTimer.block.blockType === 'Rest' || topTimer.timer.polarity === 'rest')
      ? topTimer
      : [...allTimers].reverse().find((t) => t.isPinned) ?? topTimer;

  const leafTimer = leafEntry
    ? allTimers.find((t) => t.block.key.toString() === leafEntry.block.key.toString())
    : undefined;

  const isRestHero =
    primaryTimer?.block.blockType === 'Rest' || primaryTimer?.timer.polarity === 'rest';
  const active =
    isRestHero || primaryTimer?.isPinned ? primaryTimer : leafTimer ?? primaryTimer;

  const leafLabel = leafEntry?.label;
  const mainLabel =
    (isRestHero
      ? primaryTimer?.block.label || primaryTimer?.timer.label
      : primaryTimer?.isPinned
        ? roundsLabel || primaryTimer.timer.label
        : roundsLabel && roundsLabel !== leafLabel
          ? roundsLabel
          : leafLabel || primaryTimer?.timer.label) || 'Timer';

  const subLabel =
    isRestHero && roundsLabel && roundsLabel !== mainLabel
      ? roundsLabel
      : mainLabel === leafLabel
        ? undefined
        : leafLabel;

  let subLabels: string[] | undefined;
  if (!isRestHero && leafEntry && leafEntry.displayRows.length > 1) {
    const lines = leafEntry.displayRows
      .map((row) =>
        metricPresentation
          .presentGroup([...row], 'timer-subtitle')
          .filter((t) => t.visible)
          .map((t) => t.label)
          .filter(Boolean)
          .join(' ')
          .trim(),
      )
      .filter(Boolean);
    if (lines.length > 0) subLabels = lines;
  }
  if (!subLabels) subLabels = subLabel ? [subLabel] : undefined;

  // Hero clock value
  const activeDirection: TimerDirection = active?.timer.direction ?? 'up';
  const activeDurationMs = active?.timer.durationMs;
  const activeSpans = active ? serializeSpans(active.timer.spans) : [];
  let displayMs = 0;
  if (active) {
    const elapsed = calculateDuration(active.timer.spans, nowMs);
    displayMs =
      activeDirection === 'down' && activeDurationMs !== undefined
        ? Math.max(0, activeDurationMs - elapsed)
        : elapsed;
  }

  // Whole-session clock: prefer SessionRoot, else root-most / longest-running timer.
  const withElapsed = allTimers.map((entry) => ({
    entry,
    elapsed: calculateDuration(entry.timer.spans, nowMs),
  }));
  const sessionHolder =
    withElapsed.find((e) => e.entry.block.blockType === 'SessionRoot') ??
    withElapsed.reduce<(typeof withElapsed)[number] | undefined>(
      (best, cur) => (cur.elapsed > (best?.elapsed ?? -1) ? cur : best),
      withElapsed[withElapsed.length - 1],
    );
  const sessionElapsedMs = sessionHolder?.elapsed ?? 0;
  const sessionSpans = sessionHolder ? serializeSpans(sessionHolder.entry.timer.spans) : [];

  // Deduplicated secondary timers: exclude active hero clock, session clock, and hidden role.
  const activeKey = active?.block.key.toString();
  const sessionKey = sessionHolder?.entry.block.key.toString();
  const secondaryTimers: ProjectedSecondaryTimer[] = allTimers
    .filter((t) => {
      if (t.timer.role === 'hidden') return false;
      const key = t.block.key.toString();
      return key !== activeKey && key !== sessionKey;
    })
    .map((t) => {
      const elapsed = calculateDuration(t.timer.spans, nowMs);
      return {
        id: t.block.key.toString(),
        label: t.timer.label || t.block.label || 'Timer',
        displayMs:
          t.timer.direction === 'down' && t.timer.durationMs !== undefined
            ? Math.max(0, t.timer.durationMs - elapsed)
            : elapsed,
        direction: t.timer.direction,
        durationMs: t.timer.durationMs,
        spans: serializeSpans(t.timer.spans),
      };
    });

  const basePolarity: TimerPolarity =
    active?.block.blockType === 'Rest' || active?.timer.polarity === 'rest' ? 'rest' : 'work';
  const required = Boolean(active?.timer.required);
  const polarity = resolveVisualPolarity({
    isPaused,
    basePolarity,
    direction: activeDirection,
    durationMs: activeDurationMs,
    displayMs,
  });
  const isRequiredLockActive = isRequiredCountdownLocked({
    isPaused,
    required,
    direction: activeDirection,
    durationMs: activeDurationMs,
    displayMs,
  });

  return {
    mainLabel,
    subLabels,
    displayMs,
    direction: activeDirection,
    durationMs: activeDurationMs,
    activeSpans,
    basePolarity,
    required,
    sessionElapsedMs,
    sessionSpans,
    polarity,
    isRequiredLockActive,
    roundCurrent: roundInfo?.current,
    roundTotal: roundInfo?.total,
    roundLabel: roundInfo?.label,
    secondaryTimers,
    upNext: readNextPreviewText(blocks),
    repTargets: extractRepTargets(blocks),
    isRunning: isAnyTimerRunning || status === 'running',
    isPaused,
    isNextDisabled: isPaused || options.canNextOverride === false,
    skipFlash,
    skipFlashKey,
  };
}
