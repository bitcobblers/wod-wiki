import { useMemo } from 'react';
import { MetricType, type IMetric } from '@bitcobblers/wod-wiki-engine';
import { type Segment } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import type { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';
import { ChoiceGroupMetric } from '@bitcobblers/wod-wiki-engine';
import { writeChoiceSelection } from '@bitcobblers/wod-wiki-engine';
import type { ClockEntry } from '@/clock/clockCommands';

/**
 * Explicit intent of a collected value: a pre-run `target` resolves into the
 * statement metrics before the JIT compiles; a post-run `actual` persists as
 * a durable user-origin metric correction and never mutates the statement.
 */
export type ValueIntent = 'target' | 'actual';

/** Validation domain for a collected value (mirrors ClockEntry.domain). */
export type EntryDomain = 'integer' | 'decimal' | 'duration' | 'choice';

/** A hinted metric that requires a free-text/numeric value from the user. */
export interface ValueCollectionItem {
  kind: 'value';
  blockKey: string;
  exerciseLabel: string;
  metricType: MetricType;
  hint: string;
  existingValue?: unknown;
  origin: 'hinted';
  /** Explicit collect intent — targets pre-run, actuals post-run. */
  intent: ValueIntent;
  statementIndex: number;
  setIndex?: number;
  roundIndex?: number;
  /** Occurrence anchors for durable post-run corrections. */
  sourceStatementId?: number;
  stackLevel?: number;
  unit?: string;
  /**
   * Performance data (reps/load) may defer to post-run collection;
   * execution-only values (duration/loop counts) must resolve pre-run.
   */
  deferrable: boolean;
}

/**
 * A Choice Group metric that presents the user with mutually-exclusive
 * alternatives (emitted by Fusion for homogeneous slash expressions).
 * First alternative is pre-selected; user-plan resolution written on confirm.
 */
export interface ChoiceCollectionItem {
  kind: 'choice';
  blockKey: string;
  exerciseLabel: string;
  alternatives: IMetric[];
  selectedIndex: number;  // always 0 initially
  statementIndex: number;
  setIndex?: number;
  roundIndex?: number;
}

export type CollectionItem = ValueCollectionItem | ChoiceCollectionItem;
type CollectionScript = Pick<WhiteboardScript, 'statements'>;

/**
 * Stable per-field identity for drafts, commands, and durable corrections:
 * `stmt-<statementId>:<metricType>` pre-run, `<block.key UUID>:<metricType>`
 * post-run/live — never a display name or array position. When one block
 * emits several groups of the same metric type, the statement id suffix
 * disambiguates the occurrences.
 */
export function entryFieldId(item: CollectionItem): string {
  const metricType = item.kind === 'choice' ? MetricType.Choice : String(item.metricType);
  const occurrence = item.kind === 'value' && item.sourceStatementId !== undefined
    ? `:${item.sourceStatementId}`
    : '';
  return `${item.blockKey}:${metricType}${occurrence}`;
}

const INTEGER_METRICS: Record<string, true> = {
  [MetricType.Rep]: true,
  [MetricType.Rounds]: true,
  [MetricType.RIR]: true,
  [MetricType.SessionRPE]: true,
  [MetricType.Lap]: true,
};
const DURATION_METRICS: Record<string, true> = { [MetricType.Duration]: true };
const CHOICE_METRICS: Record<string, true> = { [MetricType.Choice]: true };

/** Map a metric type to its entry validation domain. */
export function metricDomain(metricType: MetricType | string): EntryDomain {
  const t = String(metricType);
  if (INTEGER_METRICS[t]) return 'integer';
  if (DURATION_METRICS[t]) return 'duration';
  if (CHOICE_METRICS[t]) return 'choice';
  return 'decimal';
}

/** Project a collection item into the shared clock entry shape. */
export function toClockEntry(item: CollectionItem, index: number, total: number): ClockEntry {
  if (item.kind === 'choice') {
    return {
      fieldId: entryFieldId(item),
      label: item.exerciseLabel,
      metricType: MetricType.Choice,
      domain: 'choice',
      intent: 'target',
      required: true,
      value: null,
      unit: '',
      index,
      total,
      selectedIndex: 0,
      alternatives: item.alternatives.map((alt, i) => ({
        label: alt.image ?? String((alt.value as { amount?: unknown } | null)?.amount ?? alt.value ?? i),
        value: i,
      })),
    };
  }
  return {
    fieldId: entryFieldId(item),
    label: item.exerciseLabel,
    metricType: String(item.metricType),
    domain: metricDomain(item.metricType),
    intent: item.intent,
    required: item.intent === 'target',
    value: null,
    unit: item.unit ?? '',
    index,
    total,
  };
}

/**
 * Facade: collapse a {@link ChoiceCollectionItem}'s selection into the script
 * before the WOD compiles, delegating to the ChoiceResolution owner.
 *
 * Lives in the hooks layer so component files resolve choices without importing
 * `@/runtime/*` directly (components-layer boundary, WOD-225).
 */
export function resolveChoiceSelection(
  script: CollectionScript | null | undefined,
  item: ChoiceCollectionItem,
  selectedIndex: number,
): void {
  const stmt = script?.statements[item.statementIndex];
  if (!stmt) return;
  writeChoiceSelection(stmt, item.alternatives, selectedIndex);
}

/**
 * Rebuild a hinted metric as a concrete, data-complete `user-plan` metric.
 * The hint instance carries its class-specific shape (Duration's parsed
 * day/hour/minute/second fields, Distance/Resistance's `{amount, unit}`
 * value, metadata) — the resolution preserves it and fills in the answer,
 * so compiled semantics stay intact instead of degrading to a bare number.
 */
function resolveHintedMetric(hint: IMetric, value: number): IMetric {
  if (hint.type === MetricType.Duration) {
    const total = Math.round(value);
    const seconds = Math.floor(total / 1000) % 60;
    const minutes = Math.floor(total / 60000) % 60;
    const hours = Math.floor(total / 3_600_000) % 24;
    const days = Math.floor(total / 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const image = days > 0
      ? `${days}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${minutes}:${pad(seconds)}`;
    // Inferred local keeps Duration's extra data fields (no excess-property
    // error against IMetric) and returns as IMetric structurally.
    const resolved = {
      ...hint,
      origin: 'user-plan' as const,
      value: total,
      original: total,
      image,
      days,
      hours,
      minutes,
      seconds,
    };
    return resolved;
  }
  if (hint.type === MetricType.Distance || hint.type === MetricType.Resistance) {
    // Hinted value objects carry `{unit}` with the amount undefined; the
    // top-level `unit` (class ctor param) is authoritative when present.
    const nestedUnit = typeof hint.value === 'object' && hint.value !== null && 'unit' in hint.value
      ? hint.value.unit
      : undefined;
    const unit = hint.unit ?? (typeof nestedUnit === 'string' ? nestedUnit : '');
    return { ...hint, origin: 'user-plan', value: { amount: value, unit }, image: `${value} ${unit}`.trim() };
  }
  return { ...hint, origin: 'user-plan', value, image: String(value) };
}

/**
 * Resolve a collected value into the pinned script statements BEFORE the JIT
 * compiles — targets become real `user-plan` statement metrics (the run
 * snapshot), not display-only overrides.
 *
 * - `intent: 'target'` — value items: replaces the hinted placeholder metric
 *   with a concrete `user-plan` metric of the same type (concrete shape and
 *   unit preserved). Choice items: collapses the selected alternative
 *   (value = index).
 * - `intent: 'actual'` — deferred by design: actuals persist durably via the
 *   metric-correction API after the run, never as statement mutations.
 *
 * Returns whether the resolution was applied.
 */
export function resolveValueSelection(
  script: CollectionScript | null | undefined,
  item: CollectionItem,
  value: number,
  intent: ValueIntent,
): boolean {
  if (intent !== 'target' || !Number.isFinite(value)) return false;
  if (item.kind === 'choice') {
    if (!Number.isInteger(value) || value < 0) return false;
    resolveChoiceSelection(script, item, value);
    return true;
  }
  // Required execution values shape what the workout DOES: a zero/negative
  // duration or round count is not a plan — reject before mutating anything.
  if (EXECUTION_ONLY_METRICS[String(item.metricType)] && value <= 0) return false;
  if (item.metricType === MetricType.Rounds && !Number.isInteger(value)) return false;
  const stmt = script?.statements[item.statementIndex];
  if (!stmt) return false;
  const hint = stmt.metrics.find(
    (m) => m.type === item.metricType && (m.origin === 'hinted' || m.image === '?'),
  );
  stmt.metrics.remove((m) => m.type === item.metricType && m.origin === 'user-plan');
  if (hint) {
    stmt.metrics.remove((m) => m === hint);
    stmt.metrics.add(resolveHintedMetric(hint, value));
  } else {
    stmt.metrics.add({ type: item.metricType, origin: 'user-plan', value, image: String(value) });
  }
  return true;
}

/** Occurrence identity carried on derived segments (optional metadata). */
interface SegmentContext {
  sourceBlockKey?: unknown;
  sourceStatementId?: unknown;
}

/** Read + validate the occurrence context attached by the analytics transformer. */
function segmentContext(seg: Segment): SegmentContext | undefined {
  if (!('context' in seg)) return undefined;
  const ctx: unknown = seg.context;
  if (!ctx || typeof ctx !== 'object') return undefined;
  return ctx as SegmentContext;
}

/**
 * Post-run occurrence key: EXACT runtime block key UUID only. A segment
 * without one cannot be corrected durably, so it produces no queue item —
 * display names are not stable identities.
 */
function segmentBlockKey(seg: Segment): string | undefined {
  const key = segmentContext(seg)?.sourceBlockKey;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

const EXECUTION_ONLY_METRICS: Record<string, true> = {
  // Changing these changes what the workout DOES (timer length, loop count):
  // they must be resolved as targets before Start and cannot defer.
  [MetricType.Duration]: true,
  [MetricType.Rounds]: true,
};

/** Whether a hinted value is performance data that may defer to post-run. */
export function isDeferrableMetric(metricType: MetricType | string): boolean {
  return !EXECUTION_ONLY_METRICS[String(metricType)];
}

/** Pure item derivation — Mode A (pre-run targets) and Mode B (post-run actuals). */
export function deriveCollectionItems(
  segments: Segment[],
  userOverrides: Map<string, MetricContainer>,
  script?: CollectionScript | null
): CollectionItem[] {
  const items: CollectionItem[] = [];

    // Mode A: Pre-run planning (from script statements) — target intent.
    if (segments.length === 0 && script) {
      for (let i = 0; i < script.statements.length; i++) {
        const stmt = script.statements[i];
        const blockKey = `stmt-${stmt.id}`;
        const overrides = userOverrides.get(blockKey);
        const effortMetric = stmt.metrics.find(m => m.type === MetricType.Effort || m.type === MetricType.Label);
        const exerciseLabel = effortMetric?.value?.toString() || effortMetric?.image || 'Exercise';

        for (const metric of stmt.metrics) {
          // Choice Group: slash-separated OR expression needing pre-run resolution
          if (metric.type === MetricType.Choice) {
            const choice = metric as ChoiceGroupMetric;
            items.push({
              kind: 'choice',
              blockKey,
              exerciseLabel,
              alternatives: choice.alternatives,
              selectedIndex: 0,
              statementIndex: i,
            } satisfies ChoiceCollectionItem);
            continue;
          }

          // Hinted value: free-text/numeric collection
          if (metric.origin === 'hinted' || metric.image === '?') {
            const hasOverride = overrides?.some(o => o.type === metric.type && o.origin === 'user');
            // Already resolved into the statement (user-plan) — collected.
            const resolvedInStatement = stmt.metrics.some(
              m => m.type === metric.type && m.origin === 'user-plan',
            );
            if (!hasOverride && !resolvedInStatement) {
              items.push({
                kind: 'value',
                blockKey,
                exerciseLabel,
                metricType: metric.type as MetricType,
                hint: metric.image || '?',
                origin: 'hinted',
                intent: 'target',
                statementIndex: i,
                ...(metric.unit ? { unit: metric.unit } : {}),
                deferrable: isDeferrableMetric(metric.type),
              } satisfies ValueCollectionItem);
            }
          }
        }
      }
      return items;
    }

    // Mode B: Post-run review (from segments) — actual intent, keyed by the
    // exact runtime occurrence (sourceBlockKey); segments without one are
    // skipped: no stable identity means no durable correction is possible.
    for (const seg of segments) {
      if (!seg.metrics) continue;

      const blockKey = segmentBlockKey(seg);
      if (!blockKey) continue;
      const ctx = segmentContext(seg);
      const sourceStatementId = typeof ctx?.sourceStatementId === 'number' ? ctx.sourceStatementId : undefined;
      const overrides = userOverrides.get(blockKey);

      // Find every metric still owing an actual: hinted placeholders, plus
      // resolved pre-run targets (user-plan numbers) the run did not answer.
      for (const metric of seg.metrics) {
        const isHint = metric.origin === 'hinted' || metric.image === '?';
        // A pre-run target still owes an actual unless a user-origin value was
        // captured during the run. Execution-only plan values (duration,
        // rounds) are answered by the run itself — elapsed/rounds are
        // recorded — so they never prompt post-run.
        const isUnansweredPlan = metric.origin === 'user-plan'
          && typeof metric.value === 'number'
          && !EXECUTION_ONLY_METRICS[String(metric.type)];
        if (!isHint && !isUnansweredPlan) continue;
        // Already answered — either as a display override or, more
        // importantly, as a user-origin actual captured during the run
        // (an explicit user zero counts as answered).
        const hasOverride = overrides?.some(o => o.type === metric.type && o.origin === 'user');
        const hasUserActual = seg.metrics.some(
          m => m.type === metric.type && m.origin === 'user',
        );

        if (!hasOverride && !hasUserActual) {
          // Find exercise label in the same segment
          const effortMetric = seg.metrics.find(m => m.type === MetricType.Effort || m.type === MetricType.Label);
          const exerciseLabel = effortMetric?.value?.toString() || effortMetric?.image || 'Exercise';

          // Try to extract round/set info from block key or context
          // blockKey format often: "pushups[0][1]" -> round 1, set 2
          const roundMatch = blockKey.match(/\[(\d+)\]/);
          const setMatch = blockKey.match(/\[\d+\]\[(\d+)\]/);

          items.push({
            kind: 'value',
            blockKey,
            exerciseLabel,
            metricType: metric.type as MetricType,
            hint: metric.image || '?',
            origin: 'hinted',
            intent: 'actual',
            // Post-run items never resolve back through script.statements;
            // statementIndex stays 0 — occurrence identity is the blockKey.
            statementIndex: 0,
            roundIndex: roundMatch ? parseInt(roundMatch[1]) + 1 : undefined,
            setIndex: setMatch ? parseInt(setMatch[1]) + 1 : undefined,
            sourceStatementId,
            stackLevel: seg.depth,
            ...(metric.unit ? { unit: metric.unit } : {}),
            deferrable: isDeferrableMetric(metric.type),
          } satisfies ValueCollectionItem);
        }
      }
    }

    return items;
}

export function useCollectionMetrics(
  segments: Segment[],
  userOverrides: Map<string, MetricContainer>,
  script?: CollectionScript | null
) {
  const collectionItems = useMemo(
    () => deriveCollectionItems(segments, userOverrides, script),
    [segments, userOverrides, script],
  );

  return {
    collectionItems,
    totalCount: collectionItems.length,
    isComplete: collectionItems.length === 0,
  };
}
