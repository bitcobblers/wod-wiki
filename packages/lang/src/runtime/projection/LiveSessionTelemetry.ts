/**
 * LiveSessionTelemetry — single deep module projecting typed Summary Metrics
 * and round-over-round Effort split deltas from a live `IScriptRuntime`.
 *
 * Eliminates positional Label/Value pair unpacking and string-regex Metric
 * type guessing in UI callers, and produces plain serializable telemetry
 * frames ready for both browser views and the Cast frame projector.
 */

import {
  MetricType,
  type IOutputStatement,
  type MetricOrigin,
} from '@bitcobblers/wod-wiki-core';
import type { ProjectionResult } from '../../analytics/ProjectionResult';
import { computeColumnLabel, metricPresentation } from '../../metrics';
import type { IScriptRuntime } from '../contracts/IScriptRuntime';

export interface LiveSummaryMetric {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly metricType: MetricType | string;
  readonly origin?: MetricOrigin;
}

export interface LiveRoundSplitRow {
  readonly id: string;
  readonly comparisonKey: string;
  readonly label: string;
  readonly elapsedMs: number;
  readonly round?: number;
  readonly totalRounds?: number;
  readonly deltaMs?: number;
  readonly deltaLabel?: string;
}

export interface LiveSessionTelemetryFrame {
  readonly summaries: LiveSummaryMetric[];
  readonly splits: LiveRoundSplitRow[];
}

const NON_LABEL_SEGMENT_METRIC_TYPES: Record<string, true> = {
  [MetricType.Elapsed]: true,
  [MetricType.Total]: true,
  [MetricType.Spans]: true,
  [MetricType.SystemTime]: true,
  [MetricType.CurrentRound]: true,
  [MetricType.System]: true,
};

function projectionsToUniqueSummaries(
  projections: readonly ProjectionResult[],
): LiveSummaryMetric[] {
  const byName = new Map<string, LiveSummaryMetric>();
  for (const proj of projections) {
    byName.set(proj.name, {
      key: proj.name,
      label: computeColumnLabel(proj.name),
      value: proj.value,
      unit: proj.unit,
      metricType: proj.metricType ?? MetricType.Metric,
      origin: proj.origin,
    });
  }
  return [...byName.values()];
}

function fallbackSummariesFromOutputs(outputs: readonly IOutputStatement[]): LiveSummaryMetric[] {
  const byName = new Map<string, LiveSummaryMetric>();
  for (const output of outputs) {
    const metrics = output.metrics;
    for (let j = 0; j + 1 < metrics.length; j += 2) {
      const labelMetric = metrics[j];
      const valueMetric = metrics[j + 1];
      if (!labelMetric || !valueMetric || typeof valueMetric.value !== 'number') continue;
      const name = labelMetric.image ?? String(labelMetric.value);
      byName.set(name, {
        key: name,
        label: computeColumnLabel(name),
        value: valueMetric.value,
        unit: valueMetric.unit ?? '',
        metricType: valueMetric.type || MetricType.Metric,
        origin: valueMetric.origin,
      });
    }
  }
  return [...byName.values()];
}

function formatSplitDeltaLabel(deltaMs: number): string {
  const deltaSec = Math.round(deltaMs / 1000);
  if (deltaSec === 0) return 'even';
  return deltaSec > 0 ? `+${deltaSec}s` : `${deltaSec}s`;
}

function readRoundFromOutput(output: IOutputStatement): {
  round?: number;
  totalRounds?: number;
} {
  const metric = output.getMetric(MetricType.CurrentRound);
  if (!metric) return {};
  const round = typeof metric.value === 'number' ? metric.value : undefined;
  let totalRounds: number | undefined;
  if ('total' in metric && typeof metric.total === 'number') {
    totalRounds = metric.total;
  }
  return { round, totalRounds };
}

function deriveRoundSplits(outputs: readonly IOutputStatement[]): LiveRoundSplitRow[] {
  const previousElapsedByKey = new Map<string, number>();
  const rows: LiveRoundSplitRow[] = [];

  for (let idx = 0; idx < outputs.length; idx++) {
    const out = outputs[idx]!;
    if (out.outputType !== 'segment') continue;
    // Exclude synthetic SessionRoot and container loop summaries from leaf split comparison
    if (out.sourceBlockKey.startsWith('session-root')) continue;
    if (out.completionReason === 'rounds-complete') continue;
    if (out.sourceStatementId === undefined && !out.sourceBlockKey.startsWith('rest')) continue;

    const elapsedVal = out.getMetric(MetricType.Elapsed)?.value;
    const fallbackSpanElapsed =
      out.timeSpan.ended !== undefined ? Math.max(0, out.timeSpan.ended - out.timeSpan.started) : 0;
    const elapsedMs = typeof elapsedVal === 'number' ? elapsedVal : fallbackSpanElapsed;
    if (!Number.isFinite(elapsedMs)) continue;

    const displayTokens = metricPresentation
      .presentGroup(
        out.metrics.filter((m) => !NON_LABEL_SEGMENT_METRIC_TYPES[m.type]),
        'timer-subtitle',
      )
      .filter((t) => t.visible)
      .map((t) => t.label)
      .filter(Boolean)
      .join(' ')
      .trim();

    const label =
      displayTokens ||
      out.text?.trim() ||
      (out.sourceBlockKey.startsWith('rest') ? 'Rest' : 'Segment');

    const comparisonKey =
      out.sourceStatementId !== undefined
        ? `stmt:${out.sourceStatementId}`
        : `key:${label.toLowerCase()}`;

    const prevElapsed = previousElapsedByKey.get(comparisonKey);
    const deltaMs = prevElapsed !== undefined ? elapsedMs - prevElapsed : undefined;
    previousElapsedByKey.set(comparisonKey, elapsedMs);

    const { round, totalRounds } = readRoundFromOutput(out);
    rows.push({
      id: `${out.sourceBlockKey}:${idx}`,
      comparisonKey,
      label,
      elapsedMs,
      ...(round !== undefined ? { round } : {}),
      ...(totalRounds !== undefined ? { totalRounds } : {}),
      ...(deltaMs !== undefined
        ? { deltaMs, deltaLabel: formatSplitDeltaLabel(deltaMs) }
        : {}),
    });
  }

  return rows;
}

export function projectLiveSessionTelemetry(
  runtime: IScriptRuntime | null | undefined,
): LiveSessionTelemetryFrame {
  if (!runtime) {
    return { summaries: [], splits: [] };
  }

  const typedProjections = runtime.getLiveProjections?.();
  const summaries =
    typedProjections && typedProjections.length > 0
      ? projectionsToUniqueSummaries(typedProjections)
      : fallbackSummariesFromOutputs(runtime.getLiveAnalytics?.() ?? []);

  const splits = deriveRoundSplits(runtime.getOutputStatements());
  return { summaries, splits };
}
