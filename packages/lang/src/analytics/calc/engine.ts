/**
 * Composed calculation engine — Phases 1 & 2 of the evaluation pipeline
 * (spec §1.1).
 *
 * Implements both legacy processor contracts so it drops into the existing
 * AnalyticsEngine chain:
 *
 * - `process(output)` — **Phase 1, segment scope.** On each leaf segment,
 *   evaluates segment calcs against the segment's metrics + context and
 *   appends `analyzed` / `analyzed-estimated` annotations to the segment's
 *   own OutputStatement (pace, power, and the library nodes segmentVolume,
 *   effortRpe, metMinutes + the metMinutesEstimated companion count).
 *
 * - `summarize(outputs)` — **Phase 2, workout scope.** Recompute-all over
 *   the accumulated log-stream history: stream aggregates, context nodes,
 *   variant resolution, grouped emission. Emits ProjectionResults which the
 *   AnalyticsEngine turns into replacement `analytics` OutputStatements
 *   with signature dedupe (live running totals).
 *
 * Store scope (Phase 3) lives in the rollup driver replacement (#877).
 */

import type { IMetric, MetricOrigin, TagIndex } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import type { IOutputStatement } from '@bitcobblers/wod-wiki-core';
import type { IRealtimeProcessor } from '../IRealtimeProcessor';
import type { ISummaryProcessor } from '../ISummaryProcessor';
import type { ProjectionResult } from '../ProjectionResult';
import { extractEffortData } from '../effortResolution';
import { ExprNode } from './ast';
import { STREAM_ATOMS } from './atoms';
import { tagMarkerSlugs } from '../../tags/TagContributions';
import { evaluate, EvalContext } from './evaluator';
import { LookupRegistry } from './lookup';
import { outputNodeIds, CalculationRegistry } from './registry';
import { IProfileSource } from './tables';
import { CalculationDefinition, CalcVariant } from './types';
import { ABSENT, num, str, truthy, Val } from './values';
import { DIM_ZERO } from './dimensions';
import { AUTHORITATIVE_CASTS } from './units';

export interface CalcEngineDeps {
  /** Fence dialect of the block being analyzed; calcs filter on it. */
  dialect: string;
  lookups: LookupRegistry;
  userProfile?: IProfileSource;
  /**
   * The tag catalogue. A function a tag carries runs where that tag applies —
   * on the segments the tag marked, and at the end of the workout when the
   * tag was applied anywhere in it.
   */
  tags?: TagIndex;
  /** Tags active for the whole run, whatever the segments say. */
  activeTags?: readonly string[];
}

/** Segment's resolved effort identity for grouping/exclusion. */
interface SegmentEffort {
  slug: string;
  label: string;
}

export class CalcEngine implements IRealtimeProcessor, ISummaryProcessor {
  readonly id = 'composed-calculations';
  readonly fenceTypes = ['time', 'log'] as const;

  private readonly segmentCalcs: CalculationDefinition[];
  private readonly workoutCalcs: CalculationDefinition[];
  /**
   * Last resolved effort slug seen this workout — the "last-seen effort"
   * scan state from MetMinuteProjectionEngine, carried across process()
   * calls (segments arrive in stream order, live and in replay).
   */
  private lastSegmentEffort?: string;
  /**
   * The tags that carry each function: function name → the tags that carry
   * it. A function no tag carries runs everywhere, as it always did.
   */
  private readonly tagCarriedFunctions = new Map<string, Set<string>>();
  /** The tags applied anywhere in the run so far. */
  private readonly activatedTags = new Set<string>();

  constructor(
    private readonly registry: CalculationRegistry,
    private readonly deps: CalcEngineDeps,
  ) {
    const fenced = (d: CalculationDefinition) => !d.fences || d.fences.includes(deps.dialect);
    this.segmentCalcs = registry.byScope('segment').filter(fenced);
    this.workoutCalcs = registry.byScope('workout').filter(fenced);
    for (const tag of deps.tags?.list() ?? []) {
      for (const contribution of tag.contributions) {
        if (contribution.kind !== 'function') continue;
        const carriers = this.tagCarriedFunctions.get(contribution.name);
        if (carriers) carriers.add(tag.slug);
        else this.tagCarriedFunctions.set(contribution.name, new Set([tag.slug]));
      }
    }
    for (const tag of deps.activeTags ?? []) this.activatedTags.add(tag);
  }

  /**
   * Whether a calculation runs here.
   *
   * A function a tag carries runs only where one of the tags that carry it
   * applies; every other function runs as it always did.
   */
  private isActive(def: CalculationDefinition, appliedTags: readonly string[]): boolean {
    const carriers = this.tagCarriedFunctions.get(def.id);
    if (!carriers) return true;
    for (const slug of carriers) {
      if (appliedTags.includes(slug)) return true;
    }
    return false;
  }

  /**
   * The tags applied to a segment — the tags its statement marked — and a
   * record that they were applied, so a workout-scope function the tag
   * carries runs at the end of the workout.
   */
  private appliedTags(output: IOutputStatement): string[] {
    const slugs = tagMarkerSlugs(output.metrics.rawMetrics);
    for (const slug of slugs) this.activatedTags.add(slug);
    return slugs;
  }

  // ── Phase 1: segment scope ─────────────────────────────────────────────

  process(output: IOutputStatement): IOutputStatement {
    if (output.outputType !== 'segment' || !output.isLeaf) return output;
    const effortData = extractEffortData(output.metrics.rawMetrics);
    if (effortData) this.lastSegmentEffort = effortData.resolved.slug;
    const atoms = buildSegmentAtoms(output, this.lastSegmentEffort);
    // Effort identity rides segment annotations as metadata so persisted
    // segment-grain facts (workoutDerivation.normalizeAllMetrics) carry the
    // effortSlug/discipline/intensityTier tags that WQL `by {effort}` and
    // discipline filters group on — without this, derived metrics like
    // calc.e1rm could never group by lift (#904).
    const effortSlug = segmentEffort(output).slug ?? this.lastSegmentEffort;
    const effortTags: Record<string, unknown> = {};
    if (effortSlug) {
      effortTags.effortSlug = effortSlug;
      const discipline = this.lookupString(effortSlug, 'discipline');
      const intensityTier = this.lookupString(effortSlug, 'intensityTier');
      if (discipline) effortTags.effortDiscipline = discipline;
      if (intensityTier) effortTags.effortIntensityTier = intensityTier;
    }
    // Climb grade rides the annotation metadata too, so `calc.sends` facts
    // persist a `grade` tag and WQL groups them `by {grade}`.
    const climbGrade = output.metrics.rawMetrics.find((m) => m.type === 'climb-grade')?.value;
    if (climbGrade && typeof climbGrade === 'object' && 'raw' in climbGrade) {
      effortTags.grade = String(climbGrade.raw);
    }

    const appliedTags = this.appliedTags(output);

    for (const def of this.segmentCalcs) {
      if (!this.isActive(def, appliedTags)) continue;
      const ctx = this.makeContext(atoms);
      if (!this.applicable(def.whenAst, ctx)) continue;
      const variant = this.selectVariant(def, ctx);
      if (!variant) continue;
      const values = this.evaluateVariant(variant, atoms);

      if (def.kind === 'library') {
        // Library results append as annotations so workout-scope aggregates
        // can scan them (review doc §6 note). Absent nodes are skipped —
        // that's how the metMinutesEstimated companion count works. Frozen
        // predictions (#846: replay strips 'analyzed' but freezes
        // 'analyzed-estimated') are never re-derived or double-counted.
        for (const [nodeId, value] of values) {
          if (value.kind !== 'number') continue;
          if (this.hasFrozen(output, nodeId)) continue;
          this.appendAnnotation(output, nodeId, value, variant.origin, undefined, effortTags);
        }
      } else {
        for (const nodeId of outputNodeIds(def)) {
          const value = values.get(nodeId);
          if (value?.kind !== 'number') continue;
          if (this.hasFrozen(output, def.output?.emitType ?? def.id)) continue;
          this.appendAnnotation(output, def.output?.emitType ?? def.id, value, variant.origin, def.output?.unit, effortTags);
        }
      }
    }
    return output;
  }

  private appendAnnotation(
    output: IOutputStatement,
    type: string,
    value: Extract<Val, { kind: 'number' }>,
    origin: MetricOrigin,
    declaredUnit?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const unit = !declaredUnit || declaredUnit === 'auto' ? value.unit : declaredUnit;
    output.metrics.add({
      type,
      image: unit ? `${formatNumber(value.value)} ${unit}` : formatNumber(value.value),
      value: value.value,
      unit,
      origin,
      timestamp: new Date(),
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  }

  /** A frozen prediction of this type already rides the segment (replay). */
  private hasFrozen(output: IOutputStatement, type: string): boolean {
    return output.metrics.rawMetrics.some((m) => m.type === type && m.origin === 'analyzed-estimated');
  }

  // ── Phase 2: workout scope ─────────────────────────────────────────────

  summarize(outputs: IOutputStatement[]): ProjectionResult[] {
    const projections: ProjectionResult[] = [];
    // A workout-scope function a tag carries runs when that tag applied
    // anywhere in the workout — on a segment, or through the run's active tags.
    for (const output of outputs) {
      if (output.outputType !== 'segment') continue;
      for (const slug of tagMarkerSlugs(output.metrics.rawMetrics)) {
        this.activatedTags.add(slug);
      }
    }
    const appliedTags = [...this.activatedTags];
    for (const def of this.workoutCalcs) {
      if (!this.isActive(def, appliedTags)) continue;
      if (def.output?.isGrouped) {
        projections.push(...this.summarizeGrouped(def, outputs));
      } else {
        projections.push(...this.summarizeUngrouped(def, outputs));
      }
    }
    return projections;
  }

  private summarizeUngrouped(def: CalculationDefinition, outputs: IOutputStatement[]): ProjectionResult[] {
    const atoms = this.buildWorkoutAtoms(outputs);
    const ctx = this.makeContext(atoms);
    if (!this.applicable(def.whenAst, ctx)) return [];
    const variant = this.selectVariant(def, ctx);
    if (!variant) return [];
    const values = this.evaluateVariant(variant, atoms);
    const result = this.toProjection(def, variant, values, undefined);
    return result ? [result] : [];
  }

  private summarizeGrouped(def: CalculationDefinition, outputs: IOutputStatement[]): ProjectionResult[] {
    const groups = new Map<string, { label: string; segments: IOutputStatement[] }>();
    for (const output of outputs) {
      if (output.outputType !== 'segment') continue;
      const effort = segmentEffort(output);
      if (!effort.slug) continue;
      let group = groups.get(effort.slug);
      if (!group) {
        group = { label: effort.label, segments: [] };
        groups.set(effort.slug, group);
      }
      group.segments.push(output);
    }

    const projections: ProjectionResult[] = [];
    for (const [slug, group] of groups) {
      const atoms = this.buildWorkoutAtoms(group.segments);
      const ctx = this.makeContext(atoms);
      if (!this.applicable(def.whenAst, ctx)) continue;
      const variant = this.selectVariant(def, ctx);
      if (!variant) continue;
      const values = this.evaluateVariant(variant, atoms);
      const result = this.toProjection(def, variant, values, {
        effortSlug: slug,
        exerciseName: group.label,
        // Group dims auto-tag (spec §7.1); effort identity tags populate the
        // by-effort / by-discipline indexes from the effort lookup table.
        groupTags: { effort: slug },
        effortDiscipline: this.lookupString(slug, 'discipline'),
        effortIntensityTier: this.lookupString(slug, 'intensityTier'),
      });
      if (result) projections.push(result);
    }
    return projections;
  }

  private lookupString(key: string, field: string): string | undefined {
    const value = this.deps.lookups.lookup('effort', key, field);
    return value.kind === 'string' && value.value ? value.value : undefined;
  }

  private toProjection(
    def: CalculationDefinition,
    variant: CalcVariant,
    values: Map<string, Val>,
    group: { effortSlug: string; exerciseName: string; groupTags: Record<string, string>; effortDiscipline?: string; effortIntensityTier?: string } | undefined,
  ): ProjectionResult | undefined {
    const nodeId = outputNodeIds(def)[0];
    const value = values.get(nodeId);
    if (value?.kind !== 'number') return undefined;

    const metadata: Record<string, unknown> = {
      canonicalKey: def.output?.key ?? def.id,
      ...group,
    };
    for (const metaNodeId of def.output?.publishMetadataNodes ?? []) {
      const metaValue = values.get(metaNodeId);
      if (metaValue?.kind === 'number') metadata[metaNodeId] = metaValue.value;
      if (metaValue?.kind === 'string') metadata[metaNodeId] = metaValue.value;
    }

    return {
      name: def.output?.key ?? def.id,
      value: value.value,
      unit: !def.output?.unit || def.output.unit === 'auto' ? (value.unit ?? '') : def.output.unit,
      metricType: def.output?.emitType,
      timeSpan: { started: Date.now(), ended: Date.now() },
      origin: variant.origin,
      metadata,
    };
  }

  // ── Shared evaluation machinery ────────────────────────────────────────

  private applicable(whenAst: ExprNode | undefined, ctx: EvalContext): boolean {
    if (!whenAst) return true;
    return truthy(evaluate(whenAst, ctx));
  }

  /** First applicable variant wins (variants are pre-sorted by priority). */
  private selectVariant(def: CalculationDefinition, ctx: EvalContext): CalcVariant | undefined {
    for (const variant of def.variants) {
      if (this.applicable(variant.whenAst, ctx)) return variant;
    }
    return undefined;
  }

  /** Evaluate all nodes in a variant, resolving sibling refs lazily. */
  private evaluateVariant(variant: CalcVariant, atoms: AtomResolver): Map<string, Val> {
    const memo = new Map<string, Val>();
    const visiting = new Set<string>();
    const resolveNode = (nodeId: string): Val => {
      const cached = memo.get(nodeId);
      if (cached) return cached;
      const node = variant.nodes[nodeId];
      if (!node?.ast || visiting.has(nodeId)) return ABSENT;
      visiting.add(nodeId);
      let value = evaluate(node.ast, this.makeContext(atoms, siblingResolver));
      visiting.delete(nodeId);
      // §5.3 authoritative casts apply at node boundaries, not just at
      // registration — TIS's durationScore folds time into the score here.
      if (value.kind === 'number' && node.unit && AUTHORITATIVE_CASTS[node.unit]) {
        value = num(value.value, DIM_ZERO, node.unit);
      }
      memo.set(nodeId, value);
      return value;
    };
    const siblingResolver = (name: string): Val | undefined =>
      name in variant.nodes ? resolveNode(name) : undefined;
    for (const nodeId of Object.keys(variant.nodes)) resolveNode(nodeId);
    return memo;
  }

  private makeContext(atoms: AtomResolver, siblingResolver?: (nodeId: string) => Val | undefined): EvalContext {
    return {
      resolveRef: (name) => siblingResolver?.(name) ?? atoms.resolveRef(name),
      callFunction: (name, args, rawArgs) => {
        if (name === 'lookup') return this.deps.lookups.callFunction!(name, args, rawArgs);
        return atoms.callFunction?.(name, args, rawArgs);
      },
    };
  }

  /** Workout-scope atoms over a segment list (full history or one group). */
  private buildWorkoutAtoms(segments: IOutputStatement[]): AtomResolver {
    const effortBySegment = new Map<IOutputStatement, SegmentEffort>();
    const effortOf = (s: IOutputStatement): SegmentEffort => {
      let effort = effortBySegment.get(s);
      if (!effort) {
        effort = segmentEffort(s);
        effortBySegment.set(s, effort);
      }
      return effort;
    };

    const collect = (atom: string, exclusion?: string): { values: number[]; unit?: string } => {
      const atomDef = STREAM_ATOMS[atom];
      const metricType = atomDef?.metricType ?? atom;
      const values: number[] = [];
      let unit = atomDef?.unit;
      for (const segment of segments) {
        if (segment.outputType !== 'segment') continue;
        if (exclusion && matchesExclusion(effortOf(segment).slug, exclusion)) continue;
        for (const metric of segment.getDisplayMetrics({ types: [metricType as MetricType] })) {
          const value = numericMetricValue(metric);
          if (value === undefined) continue;
          values.push(value);
          // Last-seen unit wins (DistanceProjectionEngine parity); the unit
          // may be embedded in an `{amount, units}` value or on the metric.
          unit = embeddedMetricUnit(metric) ?? metric.unit ?? unit;
        }
      }
      return { values, unit };
    };

    const aggregate = (name: string, rawArgs: ExprNode[]): Val => {
      const target = rawArgs[0];
      if (target?.kind !== 'ref') return ABSENT;
      const exclusion = rawArgs[1]?.kind === 'filter' ? rawArgs[1].value : undefined;
      const { values, unit } = collect(target.name, exclusion);
      if (values.length === 0) return ABSENT;
      const dim = STREAM_ATOMS[target.name]?.dim;
      switch (name) {
        case 'sum': return num(values.reduce((a, b) => a + b, 0), dim, unit);
        case 'max': return num(Math.max(...values), dim, unit);
        case 'min': return num(Math.min(...values), dim, unit);
        case 'avg': return num(values.reduce((a, b) => a + b, 0) / values.length, dim, unit);
        case 'last': return num(values[values.length - 1], dim, unit);
        case 'count': return num(values.length);
        default: return ABSENT;
      }
    };

    const libraryMemo = new Map<string, Val>();
    const resolveLibrary = (atoms: AtomResolver, name: string): Val => {
      const dot = name.indexOf('.');
      if (dot < 0) return ABSENT;
      const memoized = libraryMemo.get(name);
      if (memoized) return memoized;
      const def = this.registry.get(name.slice(0, dot));
      if (!def || def.kind !== 'library') return ABSENT;
      const ctx = this.makeContext(atoms);
      if (!this.applicable(def.whenAst, ctx)) return ABSENT;
      const variant = this.selectVariant(def, ctx);
      if (!variant) return ABSENT;
      const values = this.evaluateVariant(variant, atoms);
      for (const [nodeId, value] of values) {
        libraryMemo.set(`${def.id}.${nodeId}`, value);
      }
      return libraryMemo.get(name) ?? ABSENT;
    };

    const atoms: AtomResolver = {
      resolveRef: (name) => {
        if (name === 'session.duration') {
          const duration = sessionDuration(segments);
          return duration === undefined ? ABSENT : num(duration, STREAM_ATOMS.elapsed.dim, 'ms');
        }
        if (name === 'sessionRpe') {
          const rpe = lastMetricNumber(segments, MetricType.SessionRPE);
          return rpe === undefined ? ABSENT : num(rpe);
        }
        if (name === 'profile.vo2max') {
          const vo2max = this.deps.userProfile?.vo2max;
          return vo2max === undefined ? ABSENT : num(vo2max);
        }
        if (name === 'effort') {
          // Last resolved effort in the stream (TIS disciplineFactor source);
          // empty string routes through the effort table's default row.
          for (let i = segments.length - 1; i >= 0; i--) {
            const data = extractEffortData(segments[i].metrics.rawMetrics);
            if (data) return str(data.resolved.slug);
          }
          return str('');
        }
        if (name.includes('.')) return resolveLibrary(atoms, name);
        return ABSENT;
      },
      callFunction: (name, _args, rawArgs) => {
        if (['sum', 'max', 'min', 'avg', 'count', 'last'].includes(name)) return aggregate(name, rawArgs);
        return undefined;
      },
    };
    return atoms;
  }
}

/** Ref/function resolution for one scope instance. */
interface AtomResolver {
  resolveRef(name: string): Val;
  callFunction?(name: string, args: Val[], rawArgs: ExprNode[]): Val | undefined;
}

// ── Segment atom extraction ──────────────────────────────────────────────

/** Build segment-scope atoms from a leaf segment's metrics. */
function buildSegmentAtoms(output: IOutputStatement, lastEffortSlug?: string): AtomResolver {
  const raw = output.metrics.rawMetrics;

  const sumNumeric = (type: string): number | undefined => {
    let total = 0;
    let found = false;
    for (const m of output.getDisplayMetrics({ types: [type as MetricType] })) {
      if (typeof m.value === 'number') {
        total += m.value;
        found = true;
      }
    }
    return found ? total : undefined;
  };

  const amountOf = (type: string): { value: number; unit?: string } | undefined => {
    const metric = output.getMetric(type as MetricType);
    if (!metric) return undefined;
    const value = numericMetricValue(metric);
    if (value === undefined) return undefined;
    const embeddedUnit = embeddedMetricUnit(metric);
    return { value, unit: embeddedUnit ?? metric.unit };
  };

  const reps = sumNumeric(MetricType.Rep);
  const elapsed = typeof output.getMetric(MetricType.Elapsed)?.value === 'number'
    ? (output.getMetric(MetricType.Elapsed)!.value as number)
    : undefined;
  const distance = amountOf(MetricType.Distance);
  const resistance = amountOf(MetricType.Resistance);
  const effortData = extractEffortData(raw);
  const effortLabel = [...raw].reverse().find((m) => m.type === MetricType.Effort && typeof m.value === 'string');
  // Climb send detection: a `climb-send-type` metric (onsight/flash/redpoint…)
  // marks this segment as one completed send; the grade stars the fact row so
  // WQL groups sends `by {grade}`. Metric type strings mirror ClimbMetricType
  // (src/dialects/ClimbDialect) without a core→dialects dependency.
  const climbSend = [...raw].some((m) => m.type === 'climb-send-type');
  const climbGradeValue = [...raw].find((m) => m.type === 'climb-grade')?.value;
  const climbGradeLabel =
    climbGradeValue && typeof climbGradeValue === 'object' && 'raw' in climbGradeValue
      ? String((climbGradeValue as { raw: unknown }).raw)
      : undefined;

  return {
    resolveRef: (name) => {
      switch (name) {
        case 'reps': return reps === undefined ? ABSENT : num(reps, STREAM_ATOMS.reps.dim, 'reps');
        case 'elapsed': return elapsed === undefined ? ABSENT : num(elapsed, STREAM_ATOMS.elapsed.dim, 'ms');
        case 'distance': return distance === undefined ? ABSENT : num(distance.value, STREAM_ATOMS.distance.dim, distance.unit ?? 'm');
        case 'resistance': return resistance === undefined ? ABSENT : num(resistance.value, STREAM_ATOMS.resistance.dim, resistance.unit ?? 'kg');
        case 'climbSend': return climbSend ? num(1, STREAM_ATOMS.reps.dim, 'count') : ABSENT;
        case 'climbGrade': return climbGradeLabel ? str(climbGradeLabel) : ABSENT;
        case 'effort': {
          // Never absent: unresolved/never-seen effort resolves through the
          // effort table's default row (default MET, estimated) — the
          // historical fallback path.
          const slug = effortData?.resolved.slug ?? lastEffortSlug ?? '';
          return str(slug);
        }
        case 'effortLabel': return effortLabel ? str(effortLabel.value as string) : ABSENT;
        default: return ABSENT;
      }
    },
  };
}

/** Numeric value of a metric, unwrapping `{amount, units}` objects. */
function numericMetricValue(metric: IMetric): number | undefined {
  if (typeof metric.value === 'number') return metric.value;
  const value = metric.value;
  if (value && typeof value === 'object' && 'amount' in value && typeof value.amount === 'number') {
    return value.amount;
  }
  return undefined;
}

/** Unit embedded in an `{amount, units}` metric value. */
function embeddedMetricUnit(metric: IMetric): string | undefined {
  const value = metric.value;
  if (value && typeof value === 'object' && 'units' in value && typeof value.units === 'string' && value.units) {
    return value.units;
  }
  return undefined;
}

// ── Workout-scope helpers ────────────────────────────────────────────────

/** toSlug parity with RepProjectionEngine. */
function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Segment's effort identity: resolved slug, else slugified raw label. */
function segmentEffort(output: IOutputStatement): SegmentEffort {
  const data = extractEffortData(output.metrics.rawMetrics);
  if (data) return { slug: data.resolved.slug, label: data.resolved.label };
  const raw = [...output.metrics.rawMetrics].reverse().find((m) => m.type === MetricType.Effort && typeof m.value === 'string');
  if (!raw) return { slug: '', label: '' };
  return { slug: toSlug(raw.value as string), label: raw.value as string };
}

/** Exclusion patterns: `rest|pause|rest-*` — exact or trailing-glob prefix. */
function matchesExclusion(slug: string, exclusion: string): boolean {
  for (const pattern of exclusion.split('|')) {
    const p = pattern.trim();
    if (!p) continue;
    if (p.endsWith('*')) {
      if (slug.startsWith(p.slice(0, -1))) return true;
    } else if (slug === p) {
      return true;
    }
  }
  return false;
}

/**
 * `session.duration` — the hierarchy-aware disambiguation (§10.2), ported
 * exactly from SessionLoadProjectionEngine: a root segment's elapsed wins;
 * otherwise sum leaf-segment elapsed; fall back to all segments.
 */
function sessionDuration(outputs: IOutputStatement[]): number | undefined {
  const segments = outputs.filter((o) => o.outputType === 'segment');
  if (segments.length === 0) return undefined;
  const root = segments.find((o) => o.stackLevel === 0 || o.sourceBlockKey === 'root');
  const elapsedOf = (o: IOutputStatement): number => {
    const v = o.getMetric(MetricType.Elapsed)?.value;
    return typeof v === 'number' ? v : 0;
  };
  if (root && elapsedOf(root) > 0) return elapsedOf(root);
  // Legacy parity: the fallback pool is every segment below the root level
  // (NOT just leaves) — SessionLoadProjectionEngine's exact rule.
  const belowRoot = segments.filter((o) => o.stackLevel > 0);
  const pool = belowRoot.length > 0 ? belowRoot : segments;
  const total = pool.reduce((sum, o) => sum + elapsedOf(o), 0);
  return total > 0 ? total : undefined;
}

/** Last numeric metric of a type across the stream (SessionRPE capture). */
function lastMetricNumber(segments: IOutputStatement[], type: string): number | undefined {
  let last: number | undefined;
  for (const segment of segments) {
    for (const metric of segment.metrics.rawMetrics) {
      if (metric.type !== type) continue;
      const value = numericMetricValue(metric);
      if (value !== undefined) last = value;
    }
  }
  return last;
}

/** Compact display formatting for annotation images. */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}
