import { IMetric, MetricType, CodeMetadata } from '@bitcobblers/wod-wiki-core';
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { UnitSet } from '../../metrics/units';
import { EffortMetric } from "../../runtime/compiler/metrics/EffortMetric";
import { metricForDimension, EMPTY_UNIT } from "../../runtime/compiler/metrics/dimensionFactory";

import { ChoiceGroupMetric } from "../../runtime/compiler/metrics/ChoiceGroupMetric";
import { IntensityMetric } from "../../runtime/compiler/metrics/IntensityMetric";

/** Source location carried alongside a metric (the parser's SyntaxMeta, which
 *  includes `raw`). Optional because the pure helper is used meta-less in tests. */
type Meta = {
  line?: number;
  startOffset?: number;
  endOffset?: number;
  columnStart?: number;
  columnEnd?: number;
  length?: number;
  raw?: string;
} | undefined;

interface MetaPair {
  metric: IMetric;
  meta: Meta;
}


function isBareNumber(m: IMetric): boolean {
    // RepMetric carries a number, or `undefined` for a collectible `?` quantity.
    return m.type === MetricType.Rep && (typeof m.value === 'number' || m.value === undefined);
}

/** Whether a metric is the bare "/" separator (reclassified as an effort primitive). */
function isSlashSeparator(m: IMetric): boolean {
    return m.type === MetricType.Effort && (typeof m.value === 'string' ? m.value : m.image) === '/';
}

/** Whether a metric is the bare "|" separator (reclassified as an effort primitive). */
function isPipeSeparator(m: IMetric): boolean {
    return m.type === MetricType.Effort && (typeof m.value === 'string' ? m.value : m.image) === '|';
}

function effortText(m: IMetric): string | null {
    if (m.type !== MetricType.Effort && m.type !== MetricType.Text) return null;
    if (typeof m.value === 'string') return m.value;
    return typeof m.image === 'string' ? m.image : null;
}

/** Whether a metric is a Distance/Resistance whose unit slot is still empty. */
function hasEmptyUnit(m: IMetric): boolean {
    if (m.type !== MetricType.Distance && m.type !== MetricType.Resistance) return false;
    const v = m.value as { amount?: number; unit?: string } | undefined;
    return !!v && v.amount !== undefined && (!v.unit || v.unit === EMPTY_UNIT);
}

/** Meta spanning the number metric through the consumed unit token. */
function fusedMeta(numberMeta: Meta, effortMeta: Meta, token: string): Meta {
  if (!numberMeta || !effortMeta) return numberMeta ?? effortMeta;
  const startOffset = numberMeta.startOffset;
  const tokenEnd = (effortMeta.startOffset ?? 0) + token.length;
  const gap = (effortMeta.startOffset ?? 0) - (numberMeta.endOffset ?? 0);
  const raw =
    numberMeta.raw !== undefined
      ? numberMeta.raw + ' '.repeat(Math.max(0, gap)) + token
      : undefined;
  const length = startOffset !== undefined ? tokenEnd - startOffset : undefined;
  return {
    line: numberMeta.line,
    startOffset,
    endOffset: tokenEnd,
    columnStart: numberMeta.columnStart,
    columnEnd: numberMeta.columnStart !== undefined && length !== undefined
      ? numberMeta.columnStart + length
      : numberMeta.columnEnd,
    length,
    raw,
  };
}

/** Meta for the residual effort text left after a LEADING unit token is peeled. */
function residualMeta(effortMeta: Meta, rest: string): Meta {
  if (!effortMeta || effortMeta.raw === undefined) {
    return effortMeta ? { ...effortMeta, raw: rest } : effortMeta;
  }
  const restStart = effortMeta.raw.indexOf(rest);
  const offset = restStart >= 0 ? restStart : 0;
  const startOffset = (effortMeta.startOffset ?? 0) + offset;
  return {
    line: effortMeta.line,
    startOffset,
    endOffset: effortMeta.endOffset,
    columnStart: (effortMeta.columnStart ?? 0) + offset,
    columnEnd: effortMeta.columnEnd,
    length: rest.length,
    raw: rest,
  };
}

const TRAILING_WORD = /^([\s\S]*?)([a-zA-Z]+)$/;

/** Peel the trailing word off `text`. Returns `null` when there is no word. */
function splitTrailingWord(text: string): { rest: string; token: string } | null {
  const m = TRAILING_WORD.exec(text.trimEnd());
  if (!m) return null;
  return { rest: m[1].trim(), token: m[2] };
}

/** Meta for the residual effort text left after a TRAILING unit token is peeled. */
function trailingResidualMeta(effortMeta: Meta, rest: string): Meta {
  if (!effortMeta) return effortMeta;
  return {
    line: effortMeta.line,
    startOffset: effortMeta.startOffset,
    endOffset: effortMeta.startOffset !== undefined ? effortMeta.startOffset + rest.length : effortMeta.endOffset,
    columnStart: effortMeta.columnStart,
    columnEnd: effortMeta.columnStart !== undefined ? effortMeta.columnStart + rest.length : effortMeta.columnEnd,
    length: rest.length,
    raw: rest,
  };
}

/** Meta for a unit token peeled off the END of an effort text. */
function trailingTokenMeta(effortMeta: Meta, token: string): Meta {
  if (!effortMeta) return effortMeta;
  const tokenStart = Math.max(0,
    (effortMeta.raw?.trimEnd().length
      ?? ((effortMeta.endOffset ?? 0) - (effortMeta.startOffset ?? 0))) - token.length,
  );
  return {
    line: effortMeta.line,
    startOffset: effortMeta.startOffset !== undefined ? effortMeta.startOffset + tokenStart : undefined,
    endOffset: effortMeta.startOffset !== undefined ? effortMeta.startOffset + tokenStart + token.length : effortMeta.endOffset,
    columnStart: effortMeta.columnStart !== undefined ? effortMeta.columnStart + tokenStart : undefined,
    columnEnd: effortMeta.columnStart !== undefined ? effortMeta.columnStart + tokenStart + token.length : effortMeta.columnEnd,
    length: token.length,
    raw: token,
  };
}

/** Meta spanning from the first metric through the last metric in a group. */
function spanMeta(firstMeta: Meta, lastMeta: Meta): Meta {
  if (!firstMeta || !lastMeta) return firstMeta ?? lastMeta;
  const startOffset = firstMeta.startOffset;
  const endOffset = lastMeta.endOffset;
  const length = startOffset !== undefined && endOffset !== undefined
    ? endOffset - startOffset
    : undefined;
  return {
    line: firstMeta.line,
    startOffset,
    endOffset,
    columnStart: firstMeta.columnStart,
    columnEnd: lastMeta.columnEnd,
    length,
    raw: firstMeta.raw,
  };
}

/**
 * Core fusion over metric+meta pairs. See {@link fuseUnits} for semantics.
 * Idempotent: once a unit word is consumed there is no bare Number+unit pair
 * left, so re-running is a no-op.
 */
function fusePairs(pairs: MetaPair[], units: UnitSet): MetaPair[] {
  const out: MetaPair[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const cur = pairs[i];
    const next = pairs[i + 1];

    // ── Slash/Pipe guard: a bare separator that no pattern consumed is silently dropped ──
    // Slash: unhandled fractions (shouldn't happen if patterns below cover all cases).
    // Pipe: heterogeneous choice (e.g. "Run | 5" — Effort + Rep) where no ChoiceGroup is emitted.
    if (isSlashSeparator(cur.metric) || isPipeSeparator(cur.metric)) {
      continue;
    }

    // ── effort|effort choice: Effort(A) Pipe Effort(B) → ChoiceGroupMetric ──────
    // Homogeneous: both sides are Effort → emit a single ChoiceGroupMetric.
    // Heterogeneous (e.g. Run|5): the pipe guard above will drop the pipe
    // when it becomes cur in the next iteration.
    if (next) {
      const curText = effortText(cur.metric);
      const thirdText = pairs[i + 2] ? effortText(pairs[i + 2].metric) : null;
      if (
        curText !== null &&
        isPipeSeparator(next.metric) &&
        thirdText !== null
      ) {
        // Collect all consecutive pipe-separated efforts into one group.
        const alternatives: IMetric[] = [cur.metric];
        let j = i + 1; // points at the PipeMetric
        while (
          j + 1 < pairs.length &&
          isPipeSeparator(pairs[j].metric) &&
          effortText(pairs[j + 1].metric) !== null
        ) {
          alternatives.push(pairs[j + 1].metric);
          j += 2;
        }
        out.push({
          metric: new ChoiceGroupMetric(alternatives),
          meta: spanMeta(cur.meta, pairs[j - 1].meta),
        });
        i = j - 1; // consume all pipe+effort pairs (for-loop does i++)
        continue;
      }
    }

    // ── {number}|{number} {unit} → ChoiceGroupMetric (pipe choices) ────────────
    // Detect the 4-token sequence: bareNumber  Pipe  bareNumber  unitText
    // Both numbers fuse to the same MetricType → ChoiceGroupMetric.
    // e.g. "185 | 125 lb" → ChoiceGroupMetric([Resistance(185,"lb"), Resistance(125,"lb")])
    if (next && pairs[i + 2] && pairs[i + 3]) {
      const second = pairs[i + 2];
      const fourth = pairs[i + 3];
      const fusable1 = isBareNumber(cur.metric) || hasEmptyUnit(cur.metric);
      const fusable2 = isBareNumber(second.metric) || hasEmptyUnit(second.metric);

      if (fusable1 && isPipeSeparator(next.metric) && fusable2) {
        const text = effortText(fourth.metric);
        const match = text !== null ? units.consumeLeading(text) : null;
        if (match) {
          const amount1 = isBareNumber(cur.metric)
            ? (cur.metric.value as number | undefined)
            : (cur.metric.value as { amount?: number }).amount;
          const amount2 = isBareNumber(second.metric)
            ? (second.metric.value as number | undefined)
            : (second.metric.value as { amount?: number }).amount;

          const alt1 = metricForDimension(amount1, match.token, match.unit.dimension);
          const alt2 = metricForDimension(amount2, match.token, match.unit.dimension);

          // Homogeneous check: both alternatives must resolve to the same MetricType.
          if (alt1.type === alt2.type) {
            const choiceMeta = fusedMeta(cur.meta, fourth.meta, match.token);
            out.push({
              metric: new ChoiceGroupMetric([alt1, alt2]),
              meta: choiceMeta,
            });
            if (match.rest) {
              out.push({
                metric: new EffortMetric(match.rest),
                meta: residualMeta(fourth.meta, match.rest),
              });
            }
            i += 3; // consume Pipe, second number, unit text
            continue;
          }
        }
      }
    }

    // ── {number}/{number} {unit} → single decimal metric (fraction) ─────────────
    // Detect the 4-token sequence: bareNumber  Slash  bareNumber  unitText
    // Compute fraction: numerator/denominator → single decimal metric.
    // e.g. "1/4 mile" → Distance(0.25, "mile")
    // e.g. "1/2 pood" → Resistance(0.5, "pood")
    if (next && pairs[i + 2] && pairs[i + 3]) {
      const second = pairs[i + 2];
      const fourth = pairs[i + 3];
      const fusable1 = isBareNumber(cur.metric) || hasEmptyUnit(cur.metric);
      const fusable2 = isBareNumber(second.metric) || hasEmptyUnit(second.metric);

      if (fusable1 && isSlashSeparator(next.metric) && fusable2) {
        const text = effortText(fourth.metric);
        const match = text !== null ? units.consumeLeading(text) : null;
        if (match) {
          const numerator = isBareNumber(cur.metric)
            ? (cur.metric.value as number | undefined)
            : (cur.metric.value as { amount?: number }).amount;
          const denominator = isBareNumber(second.metric)
            ? (second.metric.value as number | undefined)
            : (second.metric.value as { amount?: number }).amount;

          if (numerator !== undefined && denominator !== undefined && denominator !== 0) {
            const decimal = numerator / denominator;
            const fused = metricForDimension(decimal, match.token, match.unit.dimension);
            const fracMeta = fusedMeta(cur.meta, fourth.meta, match.token);
            out.push({
              metric: fused,
              meta: fracMeta,
            });
            if (match.rest) {
              out.push({
                metric: new EffortMetric(match.rest),
                meta: residualMeta(fourth.meta, match.rest),
              });
            }
            i += 3; // consume Slash, second number, unit text
            continue;
          }
        }
      }
    }

    // ── {number}% → Intensity metric (percent of max / 1RM) ─────────────────
    // The grammar lexes `%` as a symbol token, not a word, so it never reaches
    // the unit registry: fuse a bare number followed by a bare `%` effort here.
    // e.g. "Run 400m 80%" → Distance(400,m) + Effort(Run) + Intensity(80,%)
    if (next && isBareNumber(cur.metric)) {
      const text = effortText(next.metric);
      if (text !== null && text.trim() === '%') {
        out.push({
          metric: new IntensityMetric(cur.metric.value as number | undefined),
          meta: fusedMeta(cur.meta, next.meta, '%'),
        });
        i++; // consume the `%`
        continue;
      }
    }

    if (next) {
      const fusable = isBareNumber(cur.metric) || hasEmptyUnit(cur.metric);
      if (fusable) {
        const text = effortText(next.metric);
        const match = text !== null ? units.consumeLeading(text) : null;
        if (match) {
          const amount = isBareNumber(cur.metric)
            ? (cur.metric.value as number | undefined)
            : (cur.metric.value as { amount?: number }).amount;
          out.push({
            metric: metricForDimension(amount, match.token, match.unit.dimension),
            meta: fusedMeta(cur.meta, next.meta, match.token),
          });
          if (match.rest) {
            out.push({
              metric: new EffortMetric(match.rest),
              meta: residualMeta(next.meta, match.rest),
            });
          }
          i++; // consume `next`
          continue;
        }
      }
    }

    // ── {effort} bw → collectible Resistance(?, "bw") qualifier ─────────────
    // The bodyweight qualifier is the only unit conventionally written with
    // no amount ("20 Pushups bw"). When a statement-final effort text ends
    // in that unit word, peel it into a hinted Resistance the collectible
    // pipeline can fill. Every other trailing unit word stays inside the
    // effort name (e.g. "Atlas Stone Carry").
    if (!next) {
      const text = effortText(cur.metric);
      const split = text !== null ? splitTrailingWord(text) : null;
      const unit = split ? units.get(split.token) : undefined;
      if (split && split.rest && unit && unit.canonical === 'bw') {
        out.push({
          metric: new EffortMetric(split.rest),
          meta: trailingResidualMeta(cur.meta, split.rest),
        });
        out.push({
          metric: metricForDimension(undefined, split.token, unit.dimension),
          meta: trailingTokenMeta(cur.meta, split.token),
        });
        continue;
      }
    }

    out.push(cur);
  } // end for

  return out;
}

/**
 * Pure fusion over a metric array (no source metadata). Used by unit tests and
 * any caller that doesn't track `metricMeta`.
 *
 *   Rep(100) + Effort("m Run")  → Distance(100, "m") + Effort("Run")
 *   Rep(24)  + Effort("kg")     → Resistance(24, "kg")
 *   Rep(5)   + Effort("Burpees")→ unchanged (not a unit)
 */
export function fuseUnitsInMetrics(metrics: IMetric[], units: UnitSet): IMetric[] {
  return fusePairs(metrics.map((metric) => ({ metric, meta: undefined })), units).map((p) => p.metric);
}

/**
 * Rewrite a statement's metric list in place, fusing number + unit pairs and
 * keeping `metricMeta` source locations in sync (the fused metric spans the
 * number through the unit token; the residual effort keeps the remainder).
 * No-op when nothing fuses. Safe to call repeatedly (idempotent).
 */
export function fuseUnits(statement: ICodeStatement, units: UnitSet): void {
  const before = statement.metrics.toArray();
  const pairs: MetaPair[] = before.map((metric) => ({
    metric,
    meta: statement.metricMeta?.get(metric) as Meta,
  }));

  const after = fusePairs(pairs, units);

  const changed =
    after.length !== before.length || after.some((p, idx) => p.metric !== before[idx]);
  if (!changed) return;

  statement.metrics.clear().add(...after.map((p) => p.metric));

  if (statement.metricMeta) {
    const nextMeta = new Map(statement.metricMeta);
    // Drop stale entries for replaced metrics, add entries for new ones.
    for (const m of before) if (!after.some((p) => p.metric === m)) nextMeta.delete(m);
    for (const p of after) if (p.meta) nextMeta.set(p.metric, p.meta as CodeMetadata);
    statement.metricMeta = nextMeta;
  }
}
