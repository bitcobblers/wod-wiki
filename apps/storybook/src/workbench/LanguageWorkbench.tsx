/**
 * Language Workbench Component
 *
 * Interactive development and validation workbench for Whiteboard Script and WQL.
 * Designed with a playground-aligned 2/3 + 1/3 split layout:
 *  - Left Column (2/3 width): Note Editor + Timer / Wall Clock stacked vertically;
 *  - Right Column (1/3 width): State & Data View (Compiled Statements + Streaming Output Timeline);
 *  - Bottom: WQL Aggregate Query Lane + 2×2 Diagnostics Grid.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Edit3 } from 'lucide-react';

import { JOURNALS, buildServiceForJournal } from '../gallery/journals';
import {
  QueryService,
  parseQuery,
  isAggregateQuery,
  isFindQuery,
  type QueryResult,
  inMemoryEventStore,
  createParser,
  getHints,
  hintsToContainer,
  defineLanguagePack,
  type IDialect,
  type ICodeStatement,
  type DialectAnalysis,
  type LanguagePack,
  type IScript,
  type IMetric,
  type IScriptRuntime,
  type IRuntimeBlock,
  type IOutputStatement,
  createCompiler,
  RuntimeFactory,
  ScriptRuntimeProvider,
  useRuntimeExecution,
  useScriptRuntime,
  useStackSnapshot,
  useOutputStatements,
  useStackTimers,
  usePrimaryTimer,
  useSecondaryTimers,
  useActiveControls,
  useStackDisplayRows,
  useRoundDisplay,
  metricPresentation,
  createIRFile,
  buildStatementTree,
  type ExecutionLog,
} from '@bitcobblers/wod-wiki-engine';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { ScriptBlock } from '@bitcobblers/wod-wiki-core';
import { TimerStackView } from '@/components/organisms/workout/TimerStackView';
import { PanelSizeProvider } from '@/panels/panel-system/PanelSizeContext';
import { VisualStatePanel } from '@/panels/visual-state-panel';
import { calculateDuration } from '@/lib/timeUtils';
import type { ITimerDisplayEntry } from '@/clock/types/DisplayTypes';
import { toEventRows, type EventStore } from '@bitcobblers/wod-wiki-wql';
import { toStoredOutputStatement, type StoredOutputStatement } from '@bitcobblers/wod-wiki-engine';
import { completeWorkbenchRun, prepareWorkbenchRun } from './runPersistence';
import {
  editorPreset,
  sectionField,
  type EditorSection,
  WidgetFrame,
  QueryValue,
  WqlTimeseries,
  WqlBars,
  WqlTable,
  TopList,
  WqlComposer,
  WqlQueryInspectorModal,
  type QueryExecutor,
  OutputStatementsTable,
  OutputFilterPills,
  presentBadges,
  OUTPUT_TYPE_CLASS,
  OUTPUT_TYPE_DOT,
  formatMMSS,
  formatClockTime,
  DEFAULT_OUTPUT_FILTERS,
  normalizeOutputFilter,
  type OutputFilterInput,
} from '@bitcobblers/wod-wiki-ui';
import { DEFAULT_NOTE } from './presets';

// ── Demo Language Pack (runtime registration proof) ────────────────────────

const DEMO_PACK_ID = 'demo-pack';

/** Emits a `demo.pack` hint on any statement whose source mentions "benchmark". */
export class DemoPackDialect implements IDialect {
  id = DEMO_PACK_ID;
  name = 'Demo Pack';
  priority = 10;

  analyze(statement: ICodeStatement): DialectAnalysis {
    const raw = statement.raw ?? '';
    if (/benchmark/i.test(raw)) {
      return { metrics: hintsToContainer(['demo.pack']) };
    }
    return {};
  }
}

export const demoPack: LanguagePack = defineLanguagePack({
  identity: {
    id: DEMO_PACK_ID,
    name: 'Demo Pack',
  },
  lang: {
    analyzer: DemoPackDialect,
  },
});

// ── CodeMirror Mounting Hooks ───────────────────────────────────────────────

/**
 * Dark-Mode Standard host rule: the storybook theme toolbar toggles `dark`
 * on documentElement. Track it reactively so mounted editors re-theme when
 * the toolbar flips (shared widgets inherit host theme — #994 D3).
 */
function useHtmlDark(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains('dark')));
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

export function useCodeMirror(
  host: React.RefObject<HTMLDivElement | null>,
  doc: string,
  dialect: 'wql',
  onChange: (next: string) => void,
): { setDoc: (next: string) => void } {
  const cb = useRef(onChange);
  cb.current = onChange;
  const viewRef = useRef<EditorView | null>(null);
  const isDark = useHtmlDark();

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          ...editorPreset({ dialect, isDark }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current(u.state.doc.toString());
          }),
        ],
      }),
      parent: host.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect, isDark]);

  const setDoc = useCallback((next: string) => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== next) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    }
  }, []);

  return { setDoc };
}

/** Sections of a note doc, computed with the canonical `sectionField` parser. */
export function computeNoteSections(doc: string): EditorSection[] {
  return EditorState.create({ doc, extensions: [sectionField] }).field(sectionField).sections;
}

/**
 * Note editor mount — markdown preset (sections, syntax hiding, linting,
 * completions) exactly like the playground note page. Reports the doc and its
 * parsed sections on every keystroke.
 */
export function useNoteEditor(
  host: React.RefObject<HTMLDivElement | null>,
  doc: string,
  onChange: (next: string, sections: EditorSection[]) => void,
): { setDoc: (next: string) => void } {
  const cb = useRef(onChange);
  cb.current = onChange;
  const viewRef = useRef<EditorView | null>(null);
  const isDark = useHtmlDark();

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          ...editorPreset({ dialect: 'markdown', isDark }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              cb.current(u.state.doc.toString(), u.state.field(sectionField).sections);
            }
          }),
        ],
      }),
      parent: host.current,
    });
    viewRef.current = view;
    cb.current(view.state.doc.toString(), view.state.field(sectionField).sections);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [doc, isDark, host]);
  const setDoc = useCallback((next: string) => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== next) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    }
  }, []);

  return { setDoc };
}

export interface ParseStats {
  script?: IScript;
  statements: number;
  hints: string[];
  error?: string;
}

export function formatDurationMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

/** Elapsed (Σ span lengths) for a running or finished timer. */
export function sumSpans(spans: ReadonlyArray<{ started: number; ended?: number }>): number {
  const now = Date.now();
  return spans.reduce((total, span) => total + Math.max(0, (span.ended ?? now) - span.started), 0);
}

/** Live wall-clock time (ticking every second). */
export function useWallNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ── Code Statement Representations (Right Column Top) ───────────────────────

export function statementDepth(stmt: ICodeStatement, byId: Map<number, ICodeStatement>): number {
  let depth = 0;
  let current = stmt.parent != null ? byId.get(stmt.parent) : undefined;
  const visited = new Set<number>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    depth += 1;
    current = current.parent != null ? byId.get(current.parent) : undefined;
  }
  return depth;
}

export function StatementStrip({
  statements,
  error,
  blockLabel,
  activeIds,
  completedIds,
}: {
  statements: readonly ICodeStatement[] | undefined;
  error?: string;
  blockLabel?: string;
  activeIds?: ReadonlySet<number>;
  completedIds?: ReadonlySet<number>;
}) {
  const rows = useMemo(() => statements ?? [], [statements]);
  const byId = useMemo(() => new Map(rows.map((s) => [s.id, s])), [rows]);

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 shadow-xs"
      data-testid="statement-strip"
    >
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground truncate">
            Compiled Statements
            {blockLabel && <span className="ml-1.5 normal-case font-normal text-muted-foreground">— {blockLabel}</span>}
          </h4>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono">
          <span className="rounded bg-muted/80 px-1.5 py-0.5 text-muted-foreground">
            {rows.length} total
          </span>
          {activeIds && activeIds.size > 0 && (
            <span className="rounded bg-primary/20 px-1.5 py-0.5 font-bold text-primary">
              {activeIds.size} active
            </span>
          )}
          {completedIds && completedIds.size > 0 && (
            <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400">
              {completedIds.size} done
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {rows.length === 0 && !error && (
        <p className="py-6 text-center text-xs text-muted-foreground">No parsed statements in active block.</p>
      )}

      {rows.length > 0 && (
        <div className="max-h-72 overflow-y-auto flex flex-col gap-1.5 pr-1">
          {rows.map((stmt, idx) => {
            const raw = stmt.raw ?? stmt.text ?? '';
            const isActive = activeIds?.has(stmt.id) ?? false;
            const isDone = completedIds?.has(stmt.id) ?? false;
            const depth = statementDepth(stmt, byId);
            return (
              <div
                key={stmt.id ?? idx}
                data-testid={`code-statement-${stmt.id ?? idx}`}
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border p-2 font-mono text-[11px] transition-all ${
                  isActive
                    ? 'border-primary bg-primary/10 shadow-xs ring-1 ring-primary/30'
                    : isDone
                      ? 'border-border/40 bg-background/20 opacity-55'
                      : 'border-border/60 bg-background/50 hover:bg-background/80'
                }`}
                style={{ marginLeft: `${depth * 14}px` }}
              >
                <span className="rounded bg-muted/70 px-1 py-0.2 text-[9px] text-muted-foreground font-sans">
                  L{stmt.line ?? '·'}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{raw || `#${stmt.id}`}</span>
                <span className="flex flex-wrap items-center gap-1 font-sans">{presentBadges(stmt.metrics)}</span>
                {isDone && <span className="text-[11px] text-blue-500 dark:text-blue-400 font-bold">✓</span>}
                {isActive && (
                  <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[9px] font-bold text-primary uppercase tracking-wider">
                    active
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ActiveStatementStrip({
  statements,
  error,
  blockLabel,
}: {
  statements: readonly ICodeStatement[] | undefined;
  error?: string;
  blockLabel?: string;
}) {
  const snapshot = useStackSnapshot();
  const { outputs } = useOutputStatements();

  const activeIds = useMemo(
    () => new Set(snapshot.blocks.flatMap((b) => [...b.sourceIds])),
    [snapshot],
  );
  const completedIds = useMemo(
    () => new Set(outputs.map((o) => o.sourceStatementId).filter((id): id is number => id != null)),
    [outputs],
  );

  return (
    <StatementStrip
      statements={statements}
      error={error}
      blockLabel={blockLabel}
      activeIds={activeIds}
      completedIds={completedIds}
    />
  );
}

// ── Runtime Controls ────────────────────────────────────────────────────────

export interface RuntimeControlsProps {
  status: string;
  elapsedTime: number;
  stepCount: number;
  onStart: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
  onReset: () => void;
  onStep: () => void;
  isDirty: boolean;
  canStep: boolean;
}

export const STATUS_CLASS: Record<string, string> = {
  idle: 'bg-muted text-muted-foreground border-border/70',
  running: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 animate-pulse',
  paused: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  completed: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  error: 'bg-destructive/10 text-destructive border-destructive/30',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
        STATUS_CLASS[status] || STATUS_CLASS.idle
      }`}
      data-testid="execution-status"
    >
      {status}
    </span>
  );
}

export function WallClockHeader({
  wallNow,
  status,
  onReset,
}: {
  wallNow: Date;
  status: string;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-2">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-primary" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Wall Clock &amp; Timer</h4>
      </div>
      <div className="flex items-center gap-3">
        <StatusBadge status={status} />
        {onReset && (
          <button
            onClick={onReset}
            data-testid="btn-reset-header"
            title="Reset workout to Ready to Start"
            className="rounded-lg border border-border/80 bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent cursor-pointer transition-all shadow-xs flex items-center gap-1 active:scale-95"
          >
            <span>↺</span>
            <span>Reset</span>
          </button>
        )}
        <div className="text-right border-l border-border/50 pl-3">
          <div className="font-mono text-sm font-bold tabular-nums text-foreground leading-none" data-testid="wall-time">
            {formatClockTime(wallNow)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {wallNow.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>
    </div>
  );
}
export function WallClockPanel(props: RuntimeControlsProps) {
  const runtime = useScriptRuntime();
  const primaryTimer = usePrimaryTimer();
  const secondaryTimers = useSecondaryTimers();
  const allTimers = useStackTimers();
  const activeControls = useActiveControls();
  const stackItems = useStackDisplayRows();
  const wallNow = useWallNow();

  const roundsItem = stackItems?.find((i) => i.block.blockType === 'Rounds');
  const roundDisplay = useRoundDisplay(roundsItem?.block);

  const [now, setNow] = useState(Date.now());
  const isAnyTimerRunning = useMemo(() => {
    return allTimers.some((t) => t.timer.spans.some((s) => s.ended === undefined));
  }, [allTimers]);

  useEffect(() => {
    if (!isAnyTimerRunning) return;
    let frameId: number;
    const update = () => {
      setNow(Date.now());
      frameId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frameId);
  }, [isAnyTimerRunning]);

  const primaryElapsedMs = useMemo(() => {
    if (!primaryTimer) return 0;
    return calculateDuration(primaryTimer.timer.spans, now);
  }, [primaryTimer, now]);

  const timerStates = useMemo(() => {
    const map = new Map<string, { elapsed: number; duration?: number; format: 'down' | 'up' }>();
    for (const entry of allTimers) {
      const blockKey = entry.block.key.toString();
      const elapsed = calculateDuration(entry.timer.spans, now);
      map.set(blockKey, {
        elapsed,
        duration: entry.timer.durationMs,
        format: entry.timer.direction,
      });
    }
    return map;
  }, [allTimers, now]);

  const primaryTimerEntry: ITimerDisplayEntry | undefined = useMemo(() => {
    if (!primaryTimer) return undefined;
    const blockKey = primaryTimer.block.key.toString();
    return {
      id: `timer-${blockKey}`,
      ownerId: blockKey,
      timerMemoryId: '',
      label: primaryTimer.timer.label,
      format: primaryTimer.timer.direction,
      durationMs: primaryTimer.timer.durationMs,
      role: primaryTimer.isPinned ? 'primary' : 'auto',
      accumulatedMs: primaryElapsedMs,
    };
  }, [primaryTimer, primaryElapsedMs]);

  const secondaryTimerEntries: ITimerDisplayEntry[] = useMemo(() => {
    return secondaryTimers.map((entry) => {
      const blockKey = entry.block.key.toString();
      return {
        id: `timer-${blockKey}`,
        ownerId: blockKey,
        timerMemoryId: '',
        label: entry.timer.label,
        format: entry.timer.direction,
        durationMs: entry.timer.durationMs,
        role: entry.isPinned ? 'primary' : 'auto',
        accumulatedMs: calculateDuration(entry.timer.spans, now),
      };
    });
  }, [secondaryTimers, now]);

  const actions = useMemo(() => {
    return activeControls
      .filter((btn) => btn.visible && btn.enabled && btn.eventName)
      .map((btn) => ({
        id: btn.id,
        name: btn.label,
        eventName: btn.eventName!,
        ownerId: '',
        displayLabel: btn.label,
        isPinned: btn.isPinned,
      }));
  }, [activeControls]);

  const leafItem = stackItems?.find((i) => i.isLeaf);
  const subLabels = useMemo((): string[] | undefined => {
    if (!leafItem?.displayRows || leafItem.displayRows.length === 0) return undefined;
    const lines = leafItem.displayRows
      .map((row) =>
        metricPresentation
          .presentGroup([...row] as IMetric[], 'timer-subtitle')
          .filter((t) => t.visible)
          .map((t) => t.label)
          .filter(Boolean)
          .join(' ')
          .trim(),
      )
      .filter(Boolean);
    return lines.length > 0 ? lines : undefined;
  }, [leafItem]);

  const mainLabel = roundDisplay?.label ?? primaryTimer?.timer.label ?? leafItem?.label ?? 'Ready to Start';

  const displayTimerEntry: ITimerDisplayEntry | undefined = useMemo(() => {
    if (!primaryTimerEntry) {
      return {
        id: 'session-timer',
        ownerId: 'session',
        timerMemoryId: '',
        label: mainLabel,
        format: 'up',
        role: 'auto',
        accumulatedMs: props.elapsedTime,
      };
    }
    return {
      ...primaryTimerEntry,
      label: mainLabel,
      accumulatedMs: primaryElapsedMs,
    };
  }, [primaryTimerEntry, mainLabel, primaryElapsedMs, props.elapsedTime]);

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-5 shadow-xs"
      data-testid="panel-wallclock"
    >
      <WallClockHeader wallNow={wallNow} status={props.status} onReset={props.onReset} />
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch py-1">
        {/* Left Side (md:col-span-5): Visual State with Current Section & Up Next */}
        <div className="md:col-span-5 rounded-lg border border-border/60 bg-background/50 overflow-hidden min-h-[220px]">
          <VisualStatePanel />
        </div>

        {/* Right Side (md:col-span-7): Timer & Playback Controls */}
        <div className="md:col-span-7 flex flex-col justify-center rounded-lg border border-border/60 bg-background/50 p-2 min-h-[220px]">
          <PanelSizeProvider>
          <TimerStackView
            elapsedMs={primaryElapsedMs || props.elapsedTime}
            hasActiveBlock={Boolean(runtime)}
            onStart={props.onStart}
            onPause={props.onPause}
            onStop={props.onStop}
            onNext={() => {
              runtime?.handle({ name: 'next', timestamp: new Date(), data: {} });
            }}
            actions={actions.length > 0 ? actions : undefined}
            onAction={(eventName, payload) => {
              runtime.handle({ name: eventName, timestamp: new Date(), data: payload });
              if (eventName === 'timer:pause') props.onPause();
              else if (eventName === 'timer:resume' || eventName === 'timer:start') props.onResume();
              else if (eventName === 'workout:stop') props.onStop();
            }}
            isRunning={isAnyTimerRunning || props.status === 'running'}
            isPaused={props.status === 'paused'}
            disableNext={props.status === 'paused'}
            primaryTimer={displayTimerEntry}
            subLabels={subLabels}
            secondaryTimers={secondaryTimerEntries}
            stackItems={stackItems}
            timerStates={timerStates}
          />
          </PanelSizeProvider>
        </div>
      </div>
    </section>
  );
}

export function IdleWallClockPanel(props: RuntimeControlsProps) {
  const wallNow = useWallNow();

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-5 shadow-xs"
      data-testid="panel-wallclock"
    >
      <WallClockHeader wallNow={wallNow} status={props.status} onReset={props.onReset} />
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch py-1">
        {/* Left Side: Idle Preview Card */}
        <div className="md:col-span-5 rounded-lg border border-dashed border-border/70 bg-background/40 p-4 flex flex-col justify-between min-h-[220px]">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Workout Section
            </div>
            <div className="text-sm font-bold text-foreground">Ready to Start</div>
            <p className="text-xs text-muted-foreground mt-1">Start the workout to activate current movement and cue stream.</p>
          </div>
          <div className="p-2.5 rounded-md border border-dashed border-border/60 bg-muted/20">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-0.5">
              Up Next
            </span>
            <span className="text-xs italic text-muted-foreground">First movement in selected block</span>
          </div>
        </div>

        {/* Right Side: Timer */}
        <div className="md:col-span-7 flex flex-col justify-center rounded-lg border border-border/60 bg-background/50 p-2 min-h-[220px]">
          <PanelSizeProvider>
          <TimerStackView
            hasActiveBlock={false}
            onStart={props.onStart}
            onPause={props.onPause}
            onStop={props.onStop}
            onNext={() => {}}
            isRunning={false}
            isPaused={false}
            disableNext={true}
            primaryTimer={{
              id: 'idle-timer',
              ownerId: 'idle',
              timerMemoryId: '',
              label: 'Ready to Start',
              format: 'up',
              role: 'auto',
              accumulatedMs: 0,
            }}
          />
          </PanelSizeProvider>
        </div>
      </div>
    </section>
  );
}

function inferDiscipline(effort: string): string {
  const low = effort.toLowerCase();
  if (low.includes('row') || low.includes('run') || low.includes('bike') || low.includes('swim') || low.includes('skierg')) return 'cardio';
  if (low.includes('pull-up') || low.includes('push-up') || low.includes('dip') || low.includes('muscle-up') || low.includes('sit-up') || low.includes('air squat') || low.includes('handstand') || low.includes('burpee')) return 'gymnastics';
  if (low.includes('kettlebell') || low.includes('snatch') || low.includes('swing') || low.includes('clean')) return 'kettlebell';
  if (low.includes('rest') || low.includes('pause')) return 'recovery';
  return 'strength';
}

function buildWorkbenchSessionStore(outputs: IOutputStatement[]): EventStore {
  const stored = outputs.map(toStoredOutputStatement);
  const now = Date.now();
  const identity = {
    resultId: 'session',
    noteId: 'workbench',
    blockId: 'workbench-workout',
    blockVersion: 1,
    blockContentId: 'workbench',
    origin: 'playground' as const,
    workoutTimestamp: now,
  };
  const eventRows = toEventRows(stored, identity);

  const summaryRows: EventRecord[] = [];
  let _totalReps = 0;
  let _totalVolume = 0;
  let _totalDistance = 0;
  let _totalElapsed = 0;

  const repsByEffort = new Map<string, number>();
  const volumeByEffort = new Map<string, number>();
  const loadByDiscipline = new Map<string, number>();
  const statementReps = (s: StoredOutputStatement): number => {
    let reps = 0;
    for (const m of s.metrics) {
      const type = String(m.type);
      if (type !== 'rep' && type !== 'reps') continue;
      reps += typeof m.value === 'number' ? m.value : Number(m.value) || 0;
    }
    return reps;
  };

  const statementWeight = (s: StoredOutputStatement): number => {
    for (const m of s.metrics) {
      const type = String(m.type);
      if (type !== 'resistance' && type !== 'weight' && type !== 'load') continue;
      if (typeof m.value === 'number') return m.value;
      // resistance values can ride as {amount, unit} objects
      if (m.value && typeof m.value === 'object' && 'amount' in m.value) {
        const amount = (m.value as { amount?: unknown }).amount;
        if (typeof amount === 'number') return amount;
        return Number(amount) || 0;
      }
      return Number(m.value) || 0;
    }
    return 0;
  };

  const statementEffort = (s: StoredOutputStatement): string => {
    for (const m of s.metrics) {
      if (String(m.type) !== 'effort') continue;
      if (typeof m.value === 'string' && m.value) return m.value;
      const image = (m as { image?: unknown }).image;
      if (typeof image === 'string' && image) return image;
    }
    return '';
  };

  const statementDistElapsed = (s: StoredOutputStatement): { dist: number; elapsed: number } => {
    let dist = 0;
    let elapsed = 0;
    for (const m of s.metrics) {
      const type = String(m.type);
      const val = typeof m.value === 'number' ? m.value : Number(m.value) || 0;
      if (type === 'distance') dist += val;
      if (type === 'elapsed' || type === 'time') elapsed += val;
    }
    return { dist, elapsed };
  };

  const blocks = new Map<string, StoredOutputStatement[]>();

  for (const s of stored) {
    if (s.outputType === 'analytics') continue;
    const blockKey = (s.sourceBlockKey ?? 'workbench').split('#')[0];
    const group = blocks.get(blockKey);
    if (group) group.push(s);
    else blocks.set(blockKey, [s]);
  }

  for (const statements of blocks.values()) {
    const blockReps = statements.reduce((sum, s) => sum + statementReps(s), 0);
    _totalReps += blockReps;
    let paired = false;

    for (const s of statements) {
      const { dist, elapsed } = statementDistElapsed(s);
      _totalDistance += dist;
      _totalElapsed += elapsed;

      const effort = statementEffort(s);
      if (!effort) continue;
      paired = true;

      const discipline = inferDiscipline(effort) || 'strength';
      const ownReps = statementReps(s);
      const effortReps = ownReps > 0 ? ownReps : blockReps;
      const weight = statementWeight(s);

      if (effortReps > 0) {
        repsByEffort.set(effort, (repsByEffort.get(effort) || 0) + effortReps);
        if (weight > 0) {
          const vol = effortReps * weight;
          _totalVolume += vol;
          volumeByEffort.set(effort, (volumeByEffort.get(effort) || 0) + vol);
        }
      }
      const segLoad = effortReps > 0 && weight > 0 ? (effortReps * weight) / 10 : effortReps > 0 ? effortReps : 10;
      loadByDiscipline.set(discipline, (loadByDiscipline.get(discipline) || 0) + segLoad);
    }

    if (!paired) {
      const segLoad = blockReps > 0 ? blockReps : 10;
      loadByDiscipline.set('strength', (loadByDiscipline.get('strength') || 0) + segLoad);
    }
  }

  for (const [disc, loadVal] of loadByDiscipline.entries()) {
    summaryRows.push({
      id: `session:summary:sessionLoad:${disc}`,
      resultId: identity.resultId,
      noteId: identity.noteId,
      blockId: identity.blockId,
      blockVersion: identity.blockVersion,
      blockContentId: identity.blockContentId,
      origin: identity.origin,
      timestamp: now,
      grain: 'summary',
      outputType: 'analytics',
      metrics: [{
        type: 'sessionLoad',
        value: loadVal,
        unit: 'pts',
        origin: 'runtime',
        metadata: {
          canonicalKey: 'sessionLoad',
          effortDiscipline: disc,
          groupTags: { discipline: disc },
        },
      }],
    });
  }

  return inMemoryEventStore([...eventRows, ...summaryRows]);
}

function downloadBlob(filename: string, content: string, mimeType: string) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
const DEFAULT_PRIMARY_WQL = 'all';

export function SessionOutputsTable({
  outputs,
  initialQuery = DEFAULT_PRIMARY_WQL,
  filterPresets = DEFAULT_OUTPUT_FILTERS,
}: {
  outputs: IOutputStatement[];
  initialQuery?: string;
  filterPresets?: OutputFilterInput[];
}) {
  const [filterText, setFilterText] = useState(initialQuery);
  const [wqlResult, setWqlResult] = useState<string | null>(null);
  const [wqlError, setWqlError] = useState<string | null>(null);
  const [useComposer, setUseComposer] = useState(true);

  useEffect(() => {
    setFilterText(initialQuery);
  }, [initialQuery]);

  const normalizedPresets = useMemo(() => {
    return (filterPresets ?? DEFAULT_OUTPUT_FILTERS).map(normalizeOutputFilter);
  }, [filterPresets]);
  const t0 = outputs.length > 0 ? outputs[0].timeSpan.started : undefined;
  // Newest-first: the table is a session log, so the latest events lead. t0
  // above is intentionally read from the chronological head so +offsets stay positive.
  const newestFirst = useMemo(() => [...outputs].reverse(), [outputs]);

  // Run WQL queries when an aggregate/find/rows query is entered
  useEffect(() => {
    if (!filterText.trim()) {
      setWqlResult(null);
      setWqlError(null);
      return;
    }

    const t = setTimeout(async () => {
      try {
        const parsed = parseQuery(filterText);
        if (parsed.error) {
          setWqlResult(null);
          setWqlError(null);
          return;
        }

        if (outputs.length === 0) {
          setWqlResult('No session outputs emitted yet to query.');
          setWqlError(null);
          return;
        }

        const store = buildWorkbenchSessionStore(outputs);
        const service = new QueryService(store);
        if (isAggregateQuery(parsed)) {
          const res = await service.run(parsed);
          if (res.series.length > 0) {
            const summaryParts = res.series.flatMap((s) =>
              s.points.map((pt) => {
                const groupLabel = s.tags ? Object.values(s.tags).join(', ') : '';
                const unitStr = s.unit ? ` ${s.unit}` : '';
                return groupLabel ? `${groupLabel}: ${pt.value}${unitStr}` : `${pt.value}${unitStr}`;
              }),
            );
            if (summaryParts.length > 0) {
              setWqlResult(`WQL: ${summaryParts.join(' · ')}`);
            } else {
              setWqlResult('Query executed: 0 matching data points in current session outputs.');
            }
          } else {
            setWqlResult('Query executed: 0 matching data points in current session outputs.');
          }
        } else {
          setWqlResult(null);
        }
      } catch (e) {
        setWqlError(e instanceof Error ? e.message : String(e));
        setWqlResult(null);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [filterText, outputs]);

  return (
    <section
      className="rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-5 flex flex-col gap-4 shadow-xs"
      data-testid="output-wql-section"
    >
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500 dark:bg-violet-400" />
          <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-foreground">
            Session Outputs &amp; Live WQL Filter
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/60">
            <button
              type="button"
              onClick={() => setUseComposer(true)}
              data-testid="toggle-main-composer"
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                useComposer
                  ? 'bg-background text-foreground shadow-2xs font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ✨ Composer
            </button>
            <button
              type="button"
              onClick={() => setUseComposer(false)}
              data-testid="toggle-main-raw"
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                !useComposer
                  ? 'bg-background text-foreground shadow-2xs font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              📝 Raw
            </button>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {outputs.length} statement{outputs.length === 1 ? '' : 's'} logged
          </span>
        </div>
      </div>

      {/* WQL Filter / Query Bar */}
      <div className="flex flex-col gap-2">
        {useComposer ? (
          <div className="rounded-lg border border-border/70 bg-background/80 p-2 shadow-xs" data-testid="session-wql-composer">
            <WqlComposer
              query={filterText}
              onQueryChange={(next) => setFilterText(next)}
              showDiagnostics={false}
            />
          </div>
        ) : (
          <div className="relative flex-1 min-w-[280px]">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Enter WQL query or filter (e.g. sum:rep{}, type:segment, milestone)..."
              className="w-full rounded-lg border border-border/70 bg-background/80 px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-inner"
              data-testid="wql-filter-input"
            />
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Preset Pills (shared) */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <OutputFilterPills
            presets={normalizedPresets}
            filter={filterText}
            onChange={setFilterText}
          />
          {filterText && (
            <button
              onClick={() => setFilterText('')}
              className="text-xs text-muted-foreground hover:text-foreground cursor-pointer underline"
            >
              Clear filter
            </button>
          )}
        </div>

        {wqlError && <p className="text-xs text-destructive font-mono">{wqlError}</p>}
        {wqlResult && !wqlError && (
          <div className="p-2.5 rounded-lg border border-primary/40 bg-primary/10 text-xs font-mono font-bold text-primary flex items-center justify-between">
            <span>{wqlResult}</span>
          </div>
        )}
      </div>
      {/* Session Results Table (shared) — statement rows, fixed metric columns */}
      <OutputStatementsTable
        outputs={newestFirst}
        filter={filterText}
        timeOrigin={t0}
        onClearFilter={() => setFilterText('')}
      />
    </section>
  );
}

export function ActiveSessionOutputsTable({
  initialQuery,
  filterPresets,
}: {
  initialQuery?: string;
  filterPresets?: OutputFilterInput[];
}) {
  const { outputs } = useOutputStatements();
  return (
    <SessionOutputsTable
      outputs={outputs}
      initialQuery={initialQuery}
      filterPresets={filterPresets}
    />
  );
}
// ── Output Timeline (Right Column Bottom) ───────────────────────────────────


export function OutputTimelineHeader({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-2">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-cyan-500 dark:bg-cyan-400" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Output Stream</h4>
      </div>
      <span className="text-[10px] font-mono rounded bg-muted/80 px-2 py-0.5 text-muted-foreground font-semibold" data-testid="output-count">
        {count} emitted
      </span>
    </div>
  );
}

export function ActiveOutputTimeline() {
  const { outputs } = useOutputStatements();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [outputs.length]);

  const t0 = outputs.length > 0 ? outputs[0].timeSpan.started : undefined;
  const rows = outputs.slice(-300);

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 shadow-xs"
      data-testid="panel-timeline"
    >
      <OutputTimelineHeader count={outputs.length} />

      {outputs.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          No output statements yet — outputs stream live as blocks complete.
        </p>
      ) : (
        <div ref={scrollRef} className="max-h-80 overflow-y-auto pr-1">
          <div className="relative ml-1 border-l-2 border-border/60">
            {rows.map((out, idx) => {
              const startedAt = out.timeSpan.started;
              const endedAt = out.timeSpan.ended;
              const type = String(out.outputType);
              return (
                <div
                  key={out.id ?? idx}
                  data-testid={`timeline-row-${idx}`}
                  className="relative pb-2.5 pl-4.5"
                  style={{ marginLeft: `${Math.min(out.stackLevel, 5) * 8}px` }}
                >
                  <span
                    className={`absolute top-1.5 -left-[6px] h-2.5 w-2.5 rounded-full border-2 border-background shadow-xs ${
                      OUTPUT_TYPE_DOT[type] ?? OUTPUT_TYPE_DOT.system
                    }`}
                  />
                  <div className="rounded-lg border border-border/50 bg-background/50 p-2 shadow-2xs">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground font-mono">
                      <span className="font-bold text-primary tabular-nums">
                        {t0 !== undefined ? `+${formatMMSS(startedAt - t0)}` : '+00:00'}
                      </span>
                      <span className="tabular-nums opacity-80">{formatClockTime(new Date(endedAt ?? startedAt))}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded border px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                          OUTPUT_TYPE_CLASS[type] ?? OUTPUT_TYPE_CLASS.system
                        }`}
                      >
                        {type}
                      </span>
                      <span className="max-w-[140px] truncate font-mono text-[10px] text-foreground font-medium">
                        {out.sourceBlockKey || 'session'}
                      </span>
                      {out.completionReason && (
                        <span className="text-[9px] text-muted-foreground font-mono">· {out.completionReason}</span>
                      )}
                    </div>
                    {out.metrics && out.metrics.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">{presentBadges(out.metrics)}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function IdleOutputTimeline() {
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 shadow-xs"
      data-testid="panel-timeline"
    >
      <OutputTimelineHeader count={0} />
      <p className="py-8 text-center text-xs text-muted-foreground">
        Start the workout to stream live engine output statements.
      </p>
    </section>
  );
}

// ── Debug Panels (2×2 Diagnostics Grid) ─────────────────────────────────────

export function ParserPanel({ script, error }: { script?: IScript; error?: string }) {
  const statements = script?.statements ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-4 shadow-xs" data-testid="panel-parser">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
          1. Parser AST &amp; Metrics
        </h4>
        <span className="text-[11px] font-mono text-muted-foreground">
          {statements.length} statement{statements.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {statements.length === 0 && !error && (
        <p className="py-4 text-center text-xs text-muted-foreground">No parsed statements.</p>
      )}

      <div className="max-h-64 overflow-y-auto flex flex-col gap-2 font-mono text-xs pr-1">
        {statements.map((stmt, idx) => {
          const raw = stmt.raw ?? '';
          const metrics: IMetric[] = [...stmt.metrics];
          const hints = getHints(stmt);

          return (
            <div
              key={stmt.id ?? idx}
              className="rounded-lg border border-border/60 bg-background/50 p-2 text-[11px]"
              data-testid={`parsed-statement-${idx}`}
            >
              <div className="flex items-center justify-between text-muted-foreground mb-1">
                <span className="font-semibold text-primary">
                  Statement #{stmt.id ?? idx + 1} (Line {stmt.line ?? '?'})
                </span>
                {raw && <span className="truncate max-w-[200px] text-[10px] text-foreground/80">{raw}</span>}
              </div>

              {metrics.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {metrics.map((m, mIdx) => {
                    const type = String(m.type);
                    const valStr = typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value ?? '');
                    return (
                      <span
                        key={mIdx}
                        className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]"
                        title={`origin: ${m.origin}`}
                      >
                        <span className="text-foreground font-medium">{type}</span>
                        {valStr && <span className="text-muted-foreground">: {valStr}</span>}
                        {m.unit && <span className="text-accent-foreground font-mono"> {m.unit}</span>}
                        <span className="text-[9px] text-muted-foreground/70 ml-1">@{m.origin}</span>
                      </span>
                    );
                  })}
                </div>
              )}

              {hints.length > 0 && (
                <div className="flex flex-wrap gap-1 text-[10px] text-primary/80">
                  <span className="text-muted-foreground font-sans text-[9px]">hints:</span>
                  {hints.map((h, hIdx) => (
                    <span key={hIdx} className="rounded bg-primary/10 px-1 text-primary">
                      {h}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActiveStackPanel(props: RuntimeControlsProps) {
  const snapshot = useStackSnapshot();
  const blocks = snapshot.blocks ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-4 shadow-xs" data-testid="panel-stack">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
          2. Runtime Stack
        </h4>
        <div className="flex items-center gap-2">
          {props.isDirty && props.status !== 'idle' && (
            <span
              className="rounded bg-signal-caution/20 px-1.5 py-0.5 text-[10px] font-medium text-signal-caution border border-signal-caution/40 animate-pulse"
              data-testid="dirty-badge"
            >
              ⚠️ modified
            </span>
          )}
          <StatusBadge status={props.status} />
        </div>
      </div>

      <div className="max-h-52 overflow-y-auto flex flex-col gap-1 font-mono text-xs pr-1">
        {blocks.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Stack empty.</p>
        ) : (
          blocks.map((b: IRuntimeBlock, idx: number) => {
            const isTop = idx === 0; // snapshot.blocks is top-first
            return (
              <div
                key={b.key?.toString() || idx}
                className={`flex items-center justify-between rounded-lg border p-1.5 text-[11px] ${
                  isTop ? 'border-primary/60 bg-primary/5 font-semibold' : 'border-border/50 bg-background/40'
                }`}
                data-testid={`stack-block-${idx}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
                  <span className="text-foreground">{b.label}</span>
                  <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{b.blockType || 'block'}</span>
                </div>
                <div className="flex items-center gap-2">
                  {b.isComplete && <span className="text-[10px] text-blue-500 dark:text-blue-400">✓ complete</span>}
                  {isTop && <span className="rounded bg-primary/20 px-1.5 text-[9px] text-primary">active</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function IdleStackPanel(props: RuntimeControlsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-4 shadow-xs" data-testid="panel-stack">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
          2. Runtime Stack
        </h4>
        <StatusBadge status={props.status} />
      </div>
      <div className="py-6 text-center text-xs text-muted-foreground">
        Click <strong className="text-foreground">▶ Run Workout</strong> to mount the runtime.
      </div>
    </div>
  );
}

export function ActiveMemoryPanel() {
  const snapshot = useStackSnapshot();
  const blocks = snapshot.blocks ?? [];
  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  const activeBlock: IRuntimeBlock | undefined = blocks[selectedIdx] ?? blocks[0];

  const allMemory: IMetric[] = useMemo(() => {
    if (!activeBlock?.getAllMemory) return [];
    try {
      return (activeBlock.getAllMemory() ?? []).flatMap((loc) => [...loc.metrics]);
    } catch {
      return [];
    }
  }, [activeBlock]);

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-4 shadow-xs" data-testid="panel-memory">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
          3. Block Memory Map
        </h4>
        {blocks.length > 0 && (
          <select
            value={selectedIdx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground font-mono"
            data-testid="memory-block-select"
          >
            {blocks.map((b: IRuntimeBlock, idx: number) => (
              <option key={b.key?.toString() || idx} value={idx}>
                #{idx + 1}: {b.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {!activeBlock ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No active runtime block.</p>
      ) : allMemory.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No memory entries on selected block.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto flex flex-col gap-1.5 font-mono text-xs pr-1">
          {allMemory.map((m, idx) => {
            const valStr = typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value ?? '');
            return (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-1.5 text-[11px]"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground">{String(m.type)}</span>
                  <span className="text-muted-foreground">: {valStr}</span>
                  {m.unit && <span className="text-accent-foreground font-mono">{m.unit}</span>}
                </div>
                <span className="text-[10px] text-muted-foreground">@{m.origin}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function IdleMemoryPanel() {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-4 shadow-xs" data-testid="panel-memory">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
          3. Block Memory Map
        </h4>
      </div>
      <p className="py-6 text-center text-xs text-muted-foreground">
        No active runtime block.
      </p>
    </div>
  );
}

export function ActiveLogsPanel() {
  const { outputs } = useOutputStatements();

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-4 shadow-xs" data-testid="panel-logs">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
          4. Output Log Stream
        </h4>
        <span className="text-[11px] font-mono text-muted-foreground" data-testid="output-log-count">
          {outputs.length} statement{outputs.length === 1 ? '' : 's'}
        </span>
      </div>

      {outputs.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No emitted output statements.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto flex flex-col gap-1 font-mono text-xs pr-1">
          {outputs.slice(-200).map((out: IOutputStatement, idx: number) => {
            const metricsStr = out.metrics
              ?.map((m) => `${String(m.type)}:${typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value ?? '')}`)
              .join(' ') ?? '';

            return (
              <div
                key={idx}
                className="rounded-lg border border-border/40 bg-background/40 p-1.5 text-[11px]"
                data-testid={`log-statement-${idx}`}
              >
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                  <span className="text-primary font-medium">[{out.outputType}]</span>
                  <span>{out.sourceBlockKey || 'session'}</span>
                </div>
                {metricsStr && <p className="text-foreground/90">{metricsStr}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function IdleLogsPanel() {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-4 shadow-xs" data-testid="panel-logs">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
          4. Output Log Stream
        </h4>
      </div>
      <p className="py-6 text-center text-xs text-muted-foreground">
        No emitted output statements.
      </p>
    </div>
  );
}

export function ActiveDebugGrid({
  script,
  parseError,
  controlsProps,
}: {
  script?: IScript;
  parseError?: string;
  controlsProps: RuntimeControlsProps;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="debug-panel-grid">
      <ParserPanel script={script} error={parseError} />
      <ActiveStackPanel {...controlsProps} />
      <ActiveMemoryPanel />
      <ActiveLogsPanel />
    </div>
  );
}

export function IdleDebugGrid({
  script,
  parseError,
  controlsProps,
}: {
  script?: IScript;
  parseError?: string;
  controlsProps: RuntimeControlsProps;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="debug-panel-grid">
      <ParserPanel script={script} error={parseError} />
      <IdleStackPanel {...controlsProps} />
      <IdleMemoryPanel />
      <IdleLogsPanel />
    </div>
  );
}

export interface DashboardQuerySegment {
  id: string;
  title: string;
  question?: string;
  query: string;
  widgetType: 'auto' | 'value' | 'timeseries' | 'bars' | 'top-list' | 'table';
  dataSource: 'corpus' | 'session';
}
export type DashboardInput = string | Partial<DashboardQuerySegment>;

export const DEFAULT_DASHBOARD_QUERIES: DashboardInput[] = [
  {
    id: 'seg-1',
    title: 'Session Total Volume',
    question: 'How much volume moved this session?',
    query: 'sum:totalVolume{}',
    widgetType: 'value',
    dataSource: 'session',
  },
  {
    id: 'seg-2',
    title: 'Reps by Movement',
    question: 'What was the rep distribution across movements?',
    query: 'sum:rep{} by {effort}',
    widgetType: 'bars',
    dataSource: 'session',
  },
  {
    id: 'seg-3',
    title: 'Load by Discipline',
    question: 'Training stimulus by modality',
    query: 'sum:sessionLoad{} by {discipline}',
    widgetType: 'bars',
    dataSource: 'session',
  },
];

export function normalizeDashboardSegment(input: DashboardInput, index: number): DashboardQuerySegment {
  if (typeof input === 'object' && input !== null) {
    return {
      id: input.id || `dash-${index + 1}`,
      title: input.title || `Query Widget #${index + 1}`,
      question: input.question || 'Custom query',
      query: input.query || '',
      widgetType: input.widgetType || 'auto',
      dataSource: input.dataSource || 'session',
    };
  }

  const query = String(input).trim();
  let title = `Query #${index + 1}`;
  let widgetType: DashboardQuerySegment['widgetType'] = 'auto';

  if (query.includes('by {week}') || query.includes('by {day}') || query.includes('by {month}')) {
    const metricPart = query.split('{}')[0] || '';
    const cleanMetric = metricPart.replace('sum:', '').replace('avg:', '').replace('count:', '');
    title = cleanMetric ? `${cleanMetric} Trend` : title;
    widgetType = 'timeseries';
  } else if (query.includes('by {') || query.includes('by discipline') || query.includes('by tag')) {
    const metricPart = query.split('{}')[0] || '';
    const cleanMetric = metricPart.replace('sum:', '').replace('avg:', '').replace('count:', '');
    title = cleanMetric ? `${cleanMetric} Breakdown` : title;
    widgetType = 'bars';
  } else if (query.startsWith('sum:') || query.startsWith('avg:') || query.startsWith('count:')) {
    title = query.replace('sum:', 'Total ').replace('avg:', 'Average ').replace('count:', 'Count ').replace('{}', '');
    widgetType = 'value';
  }

  return {
    id: `dash-${index + 1}-${Date.now()}`,
    title,
    question: 'WQL Query',
    query,
    widgetType,
    dataSource: input.dataSource || (query.includes('by {week}') || query.includes('by {month}') ? 'corpus' : 'session'),
  };
}
export function DashboardQueryCard({
  segment,
  sessionOutputs,
  corpusService,
  onUpdate,
  onDelete,
  canDelete,
}: {
  segment: DashboardQuerySegment;
  sessionOutputs?: IOutputStatement[];
  corpusService: QueryService;
  onUpdate: (updated: DashboardQuerySegment) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [result, setResult] = useState<QueryResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);

  // Composer-dialog diagnostics mirror the card's execution — same source
  // dispatch, so previews in the dialog match what the card will render.
  const executor = useMemo<QueryExecutor>(() => ({
    runQuery: (query) => {
      const parsed = parseQuery(query);
      if (parsed.error) return Promise.reject(new Error(parsed.error));
      if (isFindQuery(parsed)) {
        return Promise.reject(new Error('Dashboard widgets evaluate aggregate queries — find/rows queries are for table views.'));
      }
      if (segment.dataSource === 'session') {
        const outputs = sessionOutputs ?? [];
        if (outputs.length === 0) {
          return Promise.reject(new Error('No session outputs emitted yet from workout execution.'));
        }
        const sessionService = new QueryService(buildWorkbenchSessionStore(outputs));
        return sessionService.run(parsed, { preferredUnit: 'lb' });
      }
      const newest = Math.max(...JOURNALS.crossfit.records.map((r) => r.timestamp));
      return corpusService.run(parsed, { rangeEnd: newest, preferredUnit: 'lb' });
    },
    // The card renders aggregates only; the modal routes find/rows here,
    // so both diagnostics paths reject with the card's own message.
    runFind: () => Promise.reject(new Error('Dashboard widgets evaluate aggregate queries — find/rows queries are for table views.')),
    runRows: () => Promise.reject(new Error('Dashboard widgets evaluate aggregate queries — find/rows queries are for table views.')),
  }), [segment.dataSource, sessionOutputs, corpusService]);


  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const parsed = parseQuery(segment.query);
        if (parsed.error) {
          setError(parsed.error);
          setResult(undefined);
          return;
        }

        if (isFindQuery(parsed)) {
          setError('Dashboard widgets evaluate aggregate queries — find/rows queries are for table views.');
          setResult(undefined);
          return;
        }

        if (segment.dataSource === 'session') {
          const outputs = sessionOutputs ?? [];
          if (outputs.length === 0) {
            setError('No session outputs emitted yet from workout execution.');
            setResult(undefined);
            return;
          }
          const store = buildWorkbenchSessionStore(outputs);
          const sessionService = new QueryService(store);
          const r = await sessionService.run(parsed, { preferredUnit: 'lb' });
          setResult(r);
          setError(undefined);
        } else {
          const newest = Math.max(...JOURNALS.crossfit.records.map((r) => r.timestamp));
          const r = await corpusService.run(parsed, { rangeEnd: newest, preferredUnit: 'lb' });
          setResult(r);
          setError(undefined);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResult(undefined);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [segment.query, segment.dataSource, sessionOutputs, corpusService]);

  const groupCount = result?.parsed.groupBy.length ?? 0;
  const resolvedWidgetType = segment.widgetType === 'auto'
    ? (groupCount === 0 ? 'value' : groupCount === 1 && result?.parsed.groupBy[0] === 'week' ? 'timeseries' : 'bars')
    : segment.widgetType;

  return (
    <div className="rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-4 flex flex-col gap-3 shadow-xs">
      {/* Top Segment Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <input
            type="text"
            value={segment.title}
            onChange={(e) => onUpdate({ ...segment, title: e.target.value })}
            placeholder="Widget title..."
            className="font-bold text-xs bg-transparent text-foreground border-b border-transparent hover:border-border/60 focus:border-primary focus:outline-none px-1 py-0.5 rounded"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            data-testid={`edit-widget-query-${segment.id}`}
            title="Edit query"
            aria-label={`Edit query for ${segment.title}`}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 cursor-pointer transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>

          <select
            value={segment.dataSource}
            onChange={(e) => onUpdate({ ...segment, dataSource: e.target.value as 'corpus' | 'session' })}
            className="rounded-lg border border-border/70 bg-background px-2 py-1 text-[10px] font-mono text-foreground cursor-pointer focus:outline-none"
            title="Choose data source"
          >
            <option value="corpus">📚 Corpus</option>
            <option value="session">⚡ Session</option>
          </select>

          <select
            value={segment.widgetType}
            onChange={(e) => onUpdate({ ...segment, widgetType: e.target.value as 'auto' | 'value' | 'timeseries' | 'bars' | 'top-list' | 'table' })}
            className="rounded-lg border border-border/70 bg-background px-2 py-1 text-[10px] font-mono text-foreground cursor-pointer focus:outline-none"
            title="Widget type"
          >
            <option value="auto">Auto</option>
            <option value="value">KPI</option>
            <option value="timeseries">Trend</option>
            <option value="bars">Bars</option>
            <option value="top-list">Top List</option>
            <option value="table">Table</option>
          </select>

          {canDelete && (
            <button
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive text-xs p-1 rounded hover:bg-muted/40 cursor-pointer transition-colors"
              title="Remove widget"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-destructive font-mono">{error}</p>}

      {/* Live Rendered Widget */}
      {result && !error && (
        <div className="h-52 mt-1 [&>*]:h-full" data-testid="dashboard-widget-content">
          <WidgetFrame title={segment.title} question={segment.question} query={segment.query || ''}>
            {resolvedWidgetType === 'value' ? (
              <QueryValue result={result} label={segment.title} />
            ) : resolvedWidgetType === 'timeseries' ? (
              <WqlTimeseries result={result} />
            ) : resolvedWidgetType === 'bars' ? (
              <WqlBars result={result} />
            ) : resolvedWidgetType === 'top-list' ? (
              <TopList result={result} limit={6} />
            ) : (
              <WqlTable result={result} />
            )}
          </WidgetFrame>
        </div>
      )}

      <WqlQueryInspectorModal
        isOpen={editing}
        onClose={() => setEditing(false)}
        initialQuery={segment.query ?? ''}
        executor={executor}
        title="Edit Widget Query"
        subtitle={segment.dataSource === 'session'
          ? 'Runs against the live session outputs.'
          : 'Runs against the crossfit corpus.'}
        applyLabel="Apply to Widget"
        onApply={(next) => onUpdate({ ...segment, query: next })}
      />
    </div>
  );
}

export function DashboardAnalyticsSection({
  sessionOutputs,
  dashboards = DEFAULT_DASHBOARD_QUERIES,
}: {
  sessionOutputs?: IOutputStatement[];
  dashboards?: DashboardInput[];
}) {
  const initialSegments = useMemo(() => {
    return (dashboards ?? DEFAULT_DASHBOARD_QUERIES).map((d, i) => normalizeDashboardSegment(d, i));
  }, [dashboards]);

  const [segments, setSegments] = useState<DashboardQuerySegment[]>(initialSegments);

  useEffect(() => {
    setSegments((dashboards ?? DEFAULT_DASHBOARD_QUERIES).map((d, i) => normalizeDashboardSegment(d, i)));
  }, [dashboards]);
  const corpusService = useMemo(() => buildServiceForJournal(JOURNALS.crossfit), []);

  // Add flow: compose in the dialog first — the widget is appended only on
  // Apply. Diagnostics run against the corpus (always populated); the card
  // starts on the session source like the other defaults.
  const [adding, setAdding] = useState(false);
  const addExecutor = useMemo<QueryExecutor>(() => ({
    runQuery: (query) => {
      const parsed = parseQuery(query);
      if (parsed.error) return Promise.reject(new Error(parsed.error));
      if (isFindQuery(parsed)) {
        return Promise.reject(new Error('Dashboard widgets evaluate aggregate queries — find/rows queries are for table views.'));
      }
      const newest = Math.max(...JOURNALS.crossfit.records.map((r) => r.timestamp));
      return corpusService.run(parsed, { rangeEnd: newest, preferredUnit: 'lb' });
    },
    runFind: () => Promise.reject(new Error('Dashboard widgets evaluate aggregate queries — find/rows queries are for table views.')),
    runRows: () => Promise.reject(new Error('Dashboard widgets evaluate aggregate queries — find/rows queries are for table views.')),
  }), [corpusService]);

  const handleAddSegment = (query: string) => {
    setSegments((prev) => [
      ...prev,
      {
        id: `seg-${Date.now()}`,
        title: `Query Widget #${prev.length + 1}`,
        question: 'Custom query',
        query,
        widgetType: 'auto',
        dataSource: 'session',
      },
    ]);
    setAdding(false);
  };

  const handleUpdateSegment = (idx: number, updated: DashboardQuerySegment) => {
    setSegments((prev) => prev.map((s, i) => (i === idx ? updated : s)));
  };

  const handleDeleteSegment = (idx: number) => {
    setSegments((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <section
      className="rounded-xl border border-border/70 bg-card/30 backdrop-blur-xs p-5 flex flex-col gap-4 shadow-xs"
      data-testid="dashboard-analytics-section"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500 dark:bg-violet-400" />
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Dashboard Analytics &amp; Query Widgets
            </h3>
            <p className="text-xs text-muted-foreground">
              Evaluate multi-segment WQL query blocks and render live interactive widgets over corpus or session data.
            </p>
          </div>
        </div>

        <button
          onClick={() => setAdding(true)}
          data-testid="btn-add-query-widget"
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 py-1.5 text-xs font-bold shadow-xs cursor-pointer transition-all active:scale-95 flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span>＋ Add Query Widget</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {segments.map((seg, idx) => (
          <DashboardQueryCard
            key={seg.id}
            segment={seg}
            sessionOutputs={sessionOutputs}
            corpusService={corpusService}
            onUpdate={(updated) => handleUpdateSegment(idx, updated)}
            onDelete={() => handleDeleteSegment(idx)}
            canDelete={segments.length > 1}
          />
        ))}
      </div>

      <WqlQueryInspectorModal
        isOpen={adding}
        onClose={() => setAdding(false)}
        initialQuery="sum:rep{}"
        executor={addExecutor}
        title="New Query Widget"
        subtitle="Compose the WQL, then add — the widget renders live below."
        applyLabel="Add Widget"
        onApply={handleAddSegment}
      />
    </section>
  );
}

export function ActiveDashboardAnalyticsSection({
  dashboards,
}: {
  dashboards?: DashboardInput[];
}) {
  const { outputs } = useOutputStatements();
  return <DashboardAnalyticsSection sessionOutputs={outputs} dashboards={dashboards} />;
}

export interface LanguageWorkbenchProps {
  /** Initial markdown note content (defaults to Fran) */
  initialNote?: string;
  /** Primary WQL query for the session outputs table (defaults to 'type:segment') */
  outputTableQuery?: string;
  /** Secondary predefined WQL filter presets under the table (defaults to ['all', 'segments', 'events']) */
  outputTableFilters?: OutputFilterInput[];
  /** Dashboard analytics query widgets (array of WQL strings or segment configs) */
  dashboards?: DashboardInput[];
  /** Show or hide WQL dashboard analytics section (defaults to true) */
  showWqlLane?: boolean;
  /** Show or hide 2x2 debug grid (defaults to true) */
  showDebugGrid?: boolean;
  /** Opt-in run persistence: finished runs are stored as Sessions in the active database under this note. */
  runNote?: { id: string; title: string; persistRuns?: boolean };
  /** Optional custom test ID override */
  'data-testid'?: string;
}
// ── Main LanguageWorkbench Component ────────────────────────────────────────

export function LanguageWorkbench({
  initialNote = DEFAULT_NOTE,
  outputTableQuery = DEFAULT_PRIMARY_WQL,
  outputTableFilters = DEFAULT_OUTPUT_FILTERS,
  dashboards = DEFAULT_DASHBOARD_QUERIES,
  showWqlLane = true,
  showDebugGrid = true,
  runNote,
  'data-testid': testId = 'language-workbench',
}: LanguageWorkbenchProps = {}) {
  const [noteText, setNoteText] = useState(initialNote);
  const [noteSections, setNoteSections] = useState<EditorSection[]>(() => computeNoteSections(initialNote));
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  /** Where the last finished run stands: not stored, being written, or written. */
  const [persistedRun, setPersistedRun] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setNoteText(initialNote);
    setNoteSections(computeNoteSections(initialNote));
    setActiveBlockId(null);
  }, [initialNote]);
  const [runtime, setRuntime] = useState<IScriptRuntime | null>(null);
  const [runSnapshot, setRunSnapshot] = useState<string>('');
  const factoryRef = useRef<RuntimeFactory | null>(null);
  const pendingStartRef = useRef(false);

  if (!factoryRef.current) {
    factoryRef.current = new RuntimeFactory(createCompiler());
  }

  const execution = useRuntimeExecution(runtime);
  // Keep a stable handle to the latest execution controls for deferred starts.
  const executionRef = useRef(execution);
  executionRef.current = execution;

  // Runnable `time` or `log` blocks extracted from the note's fences.
  const timeBlocks = useMemo(() => {
    return noteSections
      .filter((s) => (s.type === 'time' || s.type === 'log') && s.contentFrom !== undefined && s.contentTo !== undefined)
      .map((s, i) => {
        const content = noteText.slice(s.contentFrom!, s.contentTo!);
        const labelLine =
          content
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.length > 0) ?? `block ${i + 1}`;
        return { section: s, index: i, content, label: labelLine.replace(/^\/\/\s*/, '') };
      });
  }, [noteSections, noteText]);

  const activeBlock = timeBlocks.find((b) => b.section.id === activeBlockId) ?? timeBlocks[0];
  const runSource = activeBlock?.content ?? noteText;

  // Whiteboard lane: parse the selected time block on every keystroke.
  const parse: ParseStats = useMemo(() => {
    try {
      const script = createParser().read(runSource, activeBlock?.section.sport);
      const hints = script.statements.flatMap((s) => getHints(s));
      return { script, statements: script.statements.length, hints };
    } catch (e) {
      return { statements: 0, hints: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [runSource, activeBlock]);

  const noteHost = useRef<HTMLDivElement>(null);
  useNoteEditor(noteHost, initialNote, (next, sections) => {
    setNoteText(next);
    setNoteSections(sections);
  });
  // Runtime Lifecycle Actions
  // Auto-mount and initialize runtime in "Ready to Start" state as soon as compile is ready
  useEffect(() => {
    const factory = factoryRef.current;
    if (!factory) return;
    const currentScript = parse.script;
    if (!currentScript || currentScript.statements.length === 0) {
      if (runtime) {
        factory.disposeRuntime(runtime);
        setRuntime(null);
        setRunSnapshot('');
      }
      return;
    }

    // If no runtime exists or if the source script changed, instantiate a fresh runtime
    if (!runtime || runSnapshot !== runSource) {
      if (runtime) {
        factory.disposeRuntime(runtime);
      }
      const block: ScriptBlock = {
        id: activeBlock?.section.id ?? 'workbench-workout',
        startLine: activeBlock?.section.startLine ?? 0,
        endLine: activeBlock?.section.endLine ?? 0,
        state: 'idle',
        version: 1,
        createdAt: Date.now(),
        content: runSource,
        statements: currentScript.statements,
      };
      const newRuntime = factory.createRuntime(block, { debugMode: true });
      if (newRuntime) {
        pendingStartRef.current = true;
        setRuntime(newRuntime);
        setRunSnapshot(runSource);
      }
    }
  }, [parse.script, runSource, runtime, runSnapshot]);

  const handleStartWorkout = () => {
    const factory = factoryRef.current;
    if (!factory) return;
    const currentScript = parse.script;
    if (!currentScript || currentScript.statements.length === 0) return;

    if (runtime) {
      factory.disposeRuntime(runtime);
    }
    const block: ScriptBlock = {
      id: activeBlock?.section.id ?? 'workbench-workout',
      startLine: activeBlock?.section.startLine ?? 0,
      endLine: activeBlock?.section.endLine ?? 0,
      state: 'idle',
      version: 1,
      createdAt: Date.now(),
      content: runSource,
      statements: currentScript.statements,
    };
    const newRuntime = factory.createRuntime(block, { debugMode: true });
    if (newRuntime) {
      pendingStartRef.current = true;
      setRuntime(newRuntime);
      setRunSnapshot(runSource);
    }
  };

  // Auto-start ticking once the runtime state change (and the execution hook's
  // reset-on-runtime-change) has settled.
  useEffect(() => {
    if (!runtime || !pendingStartRef.current) return;
    pendingStartRef.current = false;
    const t = setTimeout(() => executionRef.current.start(), 0);
    return () => clearTimeout(t);
  }, [runtime]);

  // Persist a finished run ("completed" or "stopped") as a Session in the
  // active database. Opt-in via runNote; failures surface as a visible,
  // non-fatal message — never an unhandled rejection.
  const persistedRuntimeRef = useRef<IScriptRuntime | null>(null);
  const finishRun = useCallback((completed: boolean) => {
    const note = runNote;
    if (!note?.persistRuns || !runtime) return;
    if (persistedRuntimeRef.current === runtime) return;
    persistedRuntimeRef.current = runtime;
    const outputs = runtime.getOutputStatements();
    const blockIndex = activeBlock?.index ?? 0;
    const timing = {
      startTime: execution.startTime ?? Date.now(),
      endTime: Date.now(),
      duration: execution.elapsedTime,
    };
    setPersistError(null);
    setPersistedRun('saving');
    void prepareWorkbenchRun({ noteId: note.id, title: note.title, rawContent: noteText }, blockIndex)
      .then((prepared) => completeWorkbenchRun(prepared, outputs, completed, timing))
      .then(() => setPersistedRun('saved'))
      .catch((error: unknown) => {
        setPersistedRun('error');
        setPersistError(error instanceof Error ? error.message : String(error));
      });
  }, [runNote, runtime, noteText, activeBlock, execution.startTime, execution.elapsedTime]);

  useEffect(() => {
    if (execution.status === 'completed') finishRun(true);
  }, [execution.status, finishRun]);

  const handleStopWorkout = () => {
    finishRun(false);
    execution.stop();
    if (runtime && factoryRef.current) {
      factoryRef.current.disposeRuntime(runtime);
      setRuntime(null);
    }
  };

  const handleResetWorkout = () => {
    const factory = factoryRef.current;
    if (!factory) return;
    const currentScript = parse.script;
    if (runtime) {
      factory.disposeRuntime(runtime);
      setRuntime(null);
    }
    if (currentScript && currentScript.statements.length > 0) {
      const block: ScriptBlock = {
        id: activeBlock?.section.id ?? 'workbench-workout',
        startLine: activeBlock?.section.startLine ?? 0,
        endLine: activeBlock?.section.endLine ?? 0,
        state: 'idle',
        version: 1,
        createdAt: Date.now(),
        content: runSource,
        statements: currentScript.statements,
      };
      const newRuntime = factory.createRuntime(block, { debugMode: true });
      if (newRuntime) {
        pendingStartRef.current = true;
        setRuntime(newRuntime);
        setRunSnapshot(runSource);
      }
    }
  };
  useEffect(() => {
    return () => {
      if (runtime && factoryRef.current) {
        factoryRef.current.disposeRuntime(runtime);
      }
    };
  }, [runtime]);

  const isDirty = Boolean(runSnapshot && runSource !== runSnapshot);

  const controlsProps: RuntimeControlsProps = {
    status: execution.status,
    elapsedTime: execution.elapsedTime,
    stepCount: execution.stepCount,
    onStart: handleStartWorkout,
    onResume: execution.start,
    onPause: execution.pause,
    onStop: handleStopWorkout,
    onReset: handleResetWorkout,
    onStep: execution.step,
    isDirty,
    canStep: Boolean(runtime),
  };
  const handleExportMarkdown = useCallback(() => {
    downloadBlob('markdown.md', noteText, 'text/markdown;charset=utf-8');
  }, [noteText]);

  const handleExportParsed = useCallback(() => {
    const ir = createIRFile(
      'parse-tree',
      parse.script ? buildStatementTree(parse.script) : null,
      { source: 'workbench:note' },
    );
    downloadBlob('parsed-output.json', JSON.stringify(ir, null, 2), 'application/json');
  }, [parse.script]);

  const handleExportSession = useCallback(() => {
    const liveOutputs = runtime ? runtime.getOutputStatements() : [];
    const storedLogs = liveOutputs.map(toStoredOutputStatement);
    const executionLog: ExecutionLog = {
      results: {
        startTime: execution.status.sessionStartedAt ?? Date.now(),
        endTime: Date.now(),
        duration: execution.elapsedTime,
        completed: execution.status.state === 'complete' || execution.status.state === 'stopped',
        logs: storedLogs,
      },
      logs: storedLogs,
      statements: storedLogs,
      sourceScript: runSource,
    };
    const ir = createIRFile('execution-log', executionLog, { source: 'workbench:session' });
    downloadBlob('session-output.json', JSON.stringify(ir, null, 2), 'application/json');
  }, [runtime, execution, runSource]);

  return (
    <div className="flex flex-col gap-6" data-testid={testId}>
      {/* ── Workbench Header & Export Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="size-3 rounded-full bg-primary animate-pulse" />
          <h2 className="text-sm font-black uppercase tracking-wider text-foreground">
            Whiteboard Language Workbench
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="workbench-export-bar">
          <button
            type="button"
            onClick={handleExportMarkdown}
            data-testid="btn-export-markdown"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background/80 hover:bg-accent text-xs font-mono text-foreground font-semibold shadow-2xs transition-all cursor-pointer"
            title="Download note as markdown.md"
          >
            <span>📝 markdown.md</span>
          </button>
          <button
            type="button"
            onClick={handleExportParsed}
            data-testid="btn-export-parsed"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background/80 hover:bg-accent text-xs font-mono text-foreground font-semibold shadow-2xs transition-all cursor-pointer"
            title="Download parse tree as parsed-output.json (IR envelope)"
          >
            <span>🌳 parsed-output.json</span>
          </button>
          <button
            type="button"
            onClick={handleExportSession}
            data-testid="btn-export-session"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background/80 hover:bg-accent text-xs font-mono text-foreground font-semibold shadow-2xs transition-all cursor-pointer"
            title="Download session execution log as session-output.json for wod-wql CLI"
          >
            <span>⚡ session-output.json</span>
          </button>
        </div>
      </div>
      {/* ── Section 1: Note Editor (2/3) & Compiled Statements (1/3) (Authoring) ── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left (2/3 width): Note Editor */}
        <div className="lg:col-span-2 rounded-xl border border-border/70 bg-card/40 backdrop-blur-xs p-3.5 flex flex-col gap-3 shadow-xs">
          <div
            ref={noteHost}
            className="min-h-72 overflow-hidden rounded-lg border border-border/60 bg-background/70 shadow-inner"
            data-testid="script-editor-host"
          />

          {/* Time-block selector tabs (only if multiple blocks) */}
          {timeBlocks.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="time-block-chips">
              <span className="text-[11px] font-bold text-muted-foreground mr-1 uppercase tracking-wider">Blocks:</span>
              {timeBlocks.map((b) => (
                <button
                  key={b.section.id}
                  onClick={() => setActiveBlockId(b.section.id)}
                  data-testid={`time-block-chip-${b.index}`}
                  className={`max-w-[240px] truncate rounded-lg border px-2.5 py-1 font-mono text-[11px] cursor-pointer transition-all ${
                    b.section.id === activeBlock?.section.id
                      ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                      : 'border-border text-foreground hover:bg-accent'
                  }`}
                >
                  #{b.index + 1} · {b.label}
                </button>
              ))}
            </div>
          )}

          {parse.error && <p className="text-xs text-destructive font-mono">{parse.error}</p>}

          {persistError && (
            <p className="text-xs text-destructive font-mono" data-testid="workbench-persist-error" role="alert">
              Run not saved: {persistError}
            </p>
          )}

          {persistedRun !== 'idle' && !persistError && (
            <p
              className="text-xs text-muted-foreground font-mono"
              data-testid="workbench-persist-status"
              data-state={persistedRun}
            >
              {persistedRun === 'saving' ? 'Saving run to the active database…' : 'Run saved to the active database'}
            </p>
          )}
        </div>

        {/* Right (1/3 width): Compiled Statements */}
        <div className="lg:col-span-1">
          {runtime ? (
            <ScriptRuntimeProvider runtime={runtime}>
              <ActiveStatementStrip
                statements={parse.script?.statements}
                error={parse.error}
                blockLabel={activeBlock?.label}
              />
            </ScriptRuntimeProvider>
          ) : (
            <StatementStrip
              statements={parse.script?.statements}
              error={parse.error}
              blockLabel={activeBlock?.label}
            />
          )}
        </div>
      </section>

      {/* ── Section 2: Wall Clock & Split Track Screen (Execution) ── */}
      {runtime ? (
        <ScriptRuntimeProvider runtime={runtime}>
          <WallClockPanel {...controlsProps} />
        </ScriptRuntimeProvider>
      ) : (
        <IdleWallClockPanel {...controlsProps} />
      )}

      {/* ── Section 3: Session Outputs & Live WQL Filter (Review & Analysis) ── */}
      {runtime ? (
        <ScriptRuntimeProvider runtime={runtime}>
          <ActiveSessionOutputsTable
            initialQuery={outputTableQuery}
            filterPresets={outputTableFilters}
          />
        </ScriptRuntimeProvider>
      ) : (
        <SessionOutputsTable
          outputs={[]}
          initialQuery={outputTableQuery}
          filterPresets={outputTableFilters}
        />
      )}

      {/* Query lane */}
      {/* ── Section 4: Dashboard Analytics & Dynamic Query Widgets ── */}
      {showWqlLane && (
        runtime ? (
          <ScriptRuntimeProvider runtime={runtime}>
            <ActiveDashboardAnalyticsSection dashboards={dashboards} />
          </ScriptRuntimeProvider>
        ) : (
          <DashboardAnalyticsSection dashboards={dashboards} />
        )
      )}
      {/* Diagnostics Grid */}
      {showDebugGrid && (
        runtime ? (
          <ScriptRuntimeProvider runtime={runtime}>
            <ActiveDebugGrid script={parse.script} parseError={parse.error} controlsProps={controlsProps} />
          </ScriptRuntimeProvider>
        ) : (
          <IdleDebugGrid script={parse.script} parseError={parse.error} controlsProps={controlsProps} />
        )
      )}
    </div>
  );
}
