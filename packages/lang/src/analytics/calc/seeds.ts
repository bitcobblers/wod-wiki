/**
 * Built-in calculation suite as DAG seed records (#849 resolution 4: seeds
 * are TS object literals; no parser on the critical path — the line-form
 * parser's acceptance test is round-tripping these exact records).
 *
 * This is spec §6 compiled to record form, with the migration decisions
 * baked in:
 * - rest exclusion pinned once as the shared filter `rest|pause|rest-*` (§10.6);
 * - origin provenance via the metMinutesEstimated companion count (§10.3);
 * - TIS intermediate nodes published as fact metadata (§10.4);
 * - durationScore carries a `pts` cast — §5.3 applied to intermediates so
 *   the score algebra passes static dimension checking;
 * - rounding lives in `round()` where today rounds, nowhere else (§10.9).
 */

import { CalculationDefinition } from './types';

/** Shared rest/pause exclusion filter constant (§10.6). */
export const REST_EXCLUSION = 'rest|pause|rest-*';

const WORKOUT_FENCES = ['time', 'log', 'wod', 'whiteboard', 'crossfit'];

const expr = (id: string, expression: string, unit?: string) =>
  ({ id, kind: 'expr' as const, expression, unit });

export const BUILTIN_CALCS: CalculationDefinition[] = [
  // ── segment scope (Tier-1 annotations) ────────────────────────────────
  {
    id: 'pace-reps',
    kind: 'output',
    scope: 'segment',
    fences: WORKOUT_FENCES,
    when: 'elapsed > 0 and has(reps)',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { value: expr('value', 'reps / convert(elapsed, min)') },
    }],
    output: { nodeId: 'value', emitType: 'pace', unit: 'reps/min' },
  },
  {
    id: 'pace-speed',
    kind: 'output',
    scope: 'segment',
    fences: WORKOUT_FENCES,
    when: 'elapsed > 0 and has(distance)',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { value: expr('value', 'distance / convert(elapsed, s)') },
    }],
    output: { nodeId: 'value', emitType: 'pace', unit: 'm/s' },
  },
  {
    id: 'pace-runner',
    kind: 'output',
    scope: 'segment',
    fences: WORKOUT_FENCES,
    when: 'elapsed > 0 and has(distance)',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { value: expr('value', 'convert(elapsed, min) / convert(distance, km)') },
    }],
    output: { nodeId: 'value', emitType: 'pace', unit: 'min/km' },
  },
  {
    id: 'power',
    kind: 'output',
    scope: 'segment',
    fences: WORKOUT_FENCES,
    when: 'elapsed > 0 and has(reps) and has(resistance)',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { value: expr('value', 'reps * resistance / convert(elapsed, s)') },
    }],
    output: { nodeId: 'value', emitType: 'power', unit: 'auto' },
  },
  {
    id: 'segment-volume',
    kind: 'library',
    scope: 'segment',
    when: 'has(reps) and has(resistance)',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { segmentVolume: expr('segmentVolume', 'reps * resistance') },
    }],
  },
  // Estimated one-rep max (#904) — Epley: load × (1 + reps/30). Bodyweight
  // segments (no resistance) produce no estimate by construction, which
  // sidesteps the missing bodyweight profile field; an RPE/RIR-adjusted
  // variant can layer on later via effortRpe (higher priority, same key).
  // emitType carries the full `calc.e1rm` key so segment-grain facts and
  // WQL (`max:calc.e1rm{} by {effort}`) resolve it directly.
  {
    id: 'e1rm',
    kind: 'output',
    scope: 'segment',
    fences: WORKOUT_FENCES,
    when: 'has(reps) and has(resistance) and reps > 0 and resistance > 0',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        // ratio cast (§5.3): reps is count-dimensioned, the Epley factor
        // must be dimensionless for 1 + reps/30 to type-check.
        repFactor: expr('repFactor', 'reps / 30', 'ratio'),
        value: expr('value', 'round(resistance * (1 + repFactor), 1)'),
      },
    }],
    output: { nodeId: 'value', emitType: 'calc.e1rm', key: 'calc.e1rm', unit: 'auto', label: 'Estimated 1RM' },
  },
  {
    // %1RM intensity — the Epley inverse: a set of N reps ≈ 100/(1+N/30)%
    // of that set's projected e1RM. Independent of load history, so it needs
    // no profile 1RM; the dashboard tracks intensity by `by {week}`.
    id: 'pct1rm',
    kind: 'output',
    scope: 'segment',
    fences: WORKOUT_FENCES,
    when: 'has(reps) and has(resistance) and reps > 0',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        repFactor: expr('repFactor', 'reps / 30', 'ratio'),
        value: expr('value', '100 / (1 + repFactor)'),
      },
    }],
    output: { nodeId: 'value', emitType: 'calc.pct1rm', key: 'calc.pct1rm', unit: '%', label: '%1RM Intensity' },
  },
  {
    // Climbing sends — one counted unit per completed send (a segment whose
    // ClimbDialect marked a climb-send-type). Metadata carries the grade so
    // `count:calc.sends{} by {grade}` builds the pyramid.
    id: 'climb-sends',
    kind: 'output',
    scope: 'segment',
    fences: WORKOUT_FENCES,
    when: 'has(climbSend)',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { value: expr('value', 'climbSend') },
    }],
    output: { nodeId: 'value', emitType: 'calc.sends', key: 'calc.sends', unit: 'count', label: 'Sends' },
  },
  {
    id: 'effort-rpe',
    kind: 'library',
    scope: 'segment',
    when: 'has(effortLabel)',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { effortRpe: expr('effortRpe', 'lookup("rpe-labels", effortLabel, "rpe")') },
    }],
  },
  {
    id: 'met-minutes-segment',
    kind: 'library',
    scope: 'segment',
    // Fenced like the legacy MetMinuteProjectionEngine — segment-scope only
    // (its workout consumer is fenced too).
    fences: WORKOUT_FENCES,
    when: 'elapsed > 0',
    variants: [
      {
        id: 'resolved', priority: 100,
        when: 'lookup("effort", effort, "resolvedFrom") != "default"',
        origin: 'analyzed',
        nodes: { metMinutes: expr('metMinutes', 'lookup("effort", effort, "met") * convert(elapsed, min)') },
      },
      {
        id: 'unresolved', priority: 10,
        origin: 'analyzed-estimated',
        nodes: {
          metMinutes: expr('metMinutes', 'lookup("effort", effort, "met") * convert(elapsed, min)'),
          // Companion count (§10.3): workout variants predicate on this.
          metMinutesEstimated: expr('metMinutesEstimated', '1'),
        },
      },
    ],
  },

  // ── workout scope (Tier-2 summaries) ───────────────────────────────────
  {
    id: 'total-reps',
    kind: 'output',
    scope: 'workout',
    fences: WORKOUT_FENCES,
    when: 'has(sum(reps)) and sum(reps) > 0',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { total: expr('total', 'sum(reps)') },
    }],
    output: { nodeId: 'total', key: 'reps', emitType: 'rep', unit: 'reps' },
  },
  {
    id: 'total-reps-by-effort',
    kind: 'output',
    scope: 'workout',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { total: expr('total', `sum(reps, without: ${REST_EXCLUSION})`) },
    }],
    output: { nodeId: 'total', key: 'reps', emitType: 'rep', unit: 'reps', isGrouped: true, groupBy: ['effort'] },
  },
  {
    id: 'total-distance',
    kind: 'output',
    scope: 'workout',
    fences: WORKOUT_FENCES,
    when: 'has(sum(distance)) and sum(distance) > 0',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { total: expr('total', 'sum(distance)') },
    }],
    output: { nodeId: 'total', key: 'distance', emitType: 'distance', unit: 'auto' },
  },
  {
    id: 'total-volume',
    kind: 'output',
    scope: 'workout',
    fences: WORKOUT_FENCES,
    when: 'has(sum(segmentVolume)) and sum(segmentVolume) > 0',
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: { total: expr('total', 'sum(segmentVolume)') },
    }],
    output: { nodeId: 'total', key: 'totalVolume', emitType: 'volume', unit: 'auto' },
  },
  {
    id: 'total-volume-by-effort',
    kind: 'output',
    scope: 'workout',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        total: expr('total', 'sum(segmentVolume)'),
        totalSets: expr('totalSets', 'count(segmentVolume)'),
      },
    }],
    output: {
      nodeId: 'total', key: 'totalVolume', emitType: 'volume', unit: 'auto',
      isGrouped: true, groupBy: ['effort'], publishMetadataNodes: ['totalSets'],
    },
  },
  {
    id: 'met-minutes',
    kind: 'output',
    scope: 'workout',
    fences: WORKOUT_FENCES,
    when: 'has(sum(metMinutes))',
    variants: [
      {
        // Companion-count provenance (§10.3): any estimated segment flags
        // the whole workout estimated — today's resolveDominantOrigin rule.
        id: 'estimated', priority: 100,
        when: 'sum(metMinutesEstimated) > 0',
        origin: 'analyzed-estimated',
        nodes: { total: expr('total', 'sum(metMinutes)') },
      },
      {
        id: 'resolved', priority: 10,
        origin: 'analyzed',
        nodes: { total: expr('total', 'sum(metMinutes)') },
      },
    ],
    output: { nodeId: 'total', key: 'calc.metMinutes', emitType: 'work', unit: 'MET-min' },
  },
  {
    id: 'rpeSource',
    kind: 'library',
    scope: 'workout',
    variants: [
      {
        id: 'captured', priority: 100,
        when: 'has(sessionRpe)',
        origin: 'analyzed',
        nodes: { rpe: expr('rpe', 'sessionRpe') },
      },
      {
        id: 'label', priority: 50,
        when: 'has(max(effortRpe))',
        origin: 'analyzed',
        nodes: { rpe: expr('rpe', 'max(effortRpe)') },
      },
      {
        id: 'default', priority: 10,
        origin: 'analyzed-estimated',
        nodes: { rpe: expr('rpe', '5') },
      },
    ],
  },
  {
    id: 'session-load',
    kind: 'output',
    scope: 'workout',
    fences: WORKOUT_FENCES,
    when: 'has(session.duration)',
    variants: [
      {
        id: 'captured-rpe', priority: 100,
        when: 'has(sessionRpe)',
        origin: 'analyzed',
        nodes: sessionLoadNodes(),
      },
      {
        id: 'label-rpe', priority: 50,
        when: 'has(max(effortRpe))',
        origin: 'analyzed',
        nodes: sessionLoadNodes(),
      },
      {
        id: 'default-rpe', priority: 10,
        origin: 'analyzed-estimated',
        nodes: sessionLoadNodes(),
      },
    ],
    output: {
      nodeId: 'load', key: 'sessionLoad', emitType: 'load', unit: 'AU',
      publishMetadataNodes: ['sRPE', 'durationMinutes'],
    },
  },
  {
    id: 'sharedMet',
    kind: 'library',
    scope: 'workout',
    variants: [
      {
        id: 'personalized', priority: 100,
        when: 'has(profile.vo2max)',
        origin: 'analyzed',
        nodes: { metMax: expr('metMax', 'profile.vo2max / 3.5') },
      },
      {
        id: 'population', priority: 10,
        origin: 'analyzed',
        nodes: { metMax: expr('metMax', '11.4') },
      },
    ],
  },
  {
    id: 'tis',
    kind: 'output',
    scope: 'workout',
    fences: WORKOUT_FENCES,
    when: 'has(sum(metMinutes)) and has(sum(elapsed))',
    variants: [
      {
        // Today's origin rule: estimated iff any elapsed-bearing segment had
        // unresolved effort (dominant-origin via the companion count, §10.3).
        id: 'resolved', priority: 100,
        when: 'not (sum(metMinutesEstimated) > 0)',
        origin: 'analyzed',
        nodes: tisNodes(),
      },
      {
        id: 'estimated', priority: 10,
        origin: 'analyzed-estimated',
        nodes: tisNodes(),
      },
    ],
    output: {
      nodeId: 'tis', key: 'tis', emitType: 'tis', unit: 'pts',
      publishMetadataNodes: ['metScore', 'rpeScore', 'durationScore', 'disciplineFactor', 'metMax'],
    },
  },
];

/** SessionLoad node graph — identical across variants, only the origin differs. */
function sessionLoadNodes(): CalculationDefinition['variants'][number]['nodes'] {
  return {
    sRPE: expr('sRPE', 'rpeSource.rpe'),
    durationMinutes: expr('durationMinutes', 'convert(session.duration, min)'),
    load: expr('load', 'round(rpeSource.rpe * convert(session.duration, min))'),
  };
}

/** TIS node graph — identical across variants, only the origin differs. */
function tisNodes(): CalculationDefinition['variants'][number]['nodes'] {
  return {
    elapsedMin: expr('elapsedMin', 'convert(sum(elapsed), min)'),
    avgMets: expr('avgMets', 'sum(metMinutes) / elapsedMin'),
    metMax: expr('metMax', 'sharedMet.metMax'),
    metScore: expr('metScore', 'min(100, avgMets / metMax * 100)'),
    rpeScore: expr('rpeScore', 'rpeSource.rpe * 10'),
    // The pts cast (§5.3 on intermediates): hours×score folds time into the
    // dimensionless score algebra so the weighted sum type-checks.
    durationScore: expr('durationScore', 'elapsedMin / 60 * metScore', 'pts'),
    disciplineFactor: expr('disciplineFactor', 'lookup("effort", effort, "disciplineFactor")'),
    tis: expr('tis', 'round(0.30 * metScore + 0.35 * rpeScore + 0.20 * durationScore + 0.15 * disciplineFactor, 1)'),
  };
}

// ── store scope (cross-workout rollups, #877) ──────────────────────────────
//
// ACWR / monotony / strain as composed calcs — the rollup absorption (#850).
// Window semantics are parity-pinned to workloadRollup.ts (#864): trailing
// windows over a zero-filled continuous day domain, population SD, strain =
// monotony × weekly sum. Each output publishes one fact per series point.

const dailyLoads = () => ({ id: 'daily', kind: 'wql' as const, expression: 'sum:sessionLoad{} by {day}' });

export const STORE_CALCS: CalculationDefinition[] = [
  {
    id: 'acwr',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        daily: dailyLoads(),
        acute: expr('acute', 'windowMean(daily, 7d)'),
        chronic: expr('chronic', 'windowMean(daily, 28d)'),
        value: expr('value', 'acute / chronic'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.acwr', unit: 'ratio', label: 'Acute:Chronic Workload Ratio' },
  },
  {
    id: 'monotony',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        daily: dailyLoads(),
        mean7: expr('mean7', 'windowMean(daily, 7d)'),
        sd7: expr('sd7', 'windowSd(daily, 7d)'),
        value: expr('value', 'mean7 / sd7'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.monotony', unit: 'ratio', label: 'Training Monotony' },
  },
  {
    id: 'strain',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        daily: dailyLoads(),
        monotony: expr('monotony', 'windowMean(daily, 7d) / windowSd(daily, 7d)', 'ratio'),
        weekly: expr('weekly', 'windowSum(daily, 7d)'),
        value: expr('value', 'monotony * weekly'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.strain', unit: 'AU', label: 'Training Strain' },
  },
  // ── PMC (#905): CTL/ATL/TSB as EWMAs over daily sessionLoad. Canonical
  // TrainingPeaks gains (1/42, 1/7); TSB = CTL − ATL pointwise. A composite
  // `calc.pmc` series widget is out of scope for this map — the three scalar
  // loads feed value/zone/goal widgets individually.
  {
    id: 'ctl',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        daily: dailyLoads(),
        value: expr('value', 'windowEwma(daily, 42d)'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.ctl', unit: 'AU', label: 'Chronic Training Load (CTL)' },
  },
  {
    id: 'atl',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        daily: dailyLoads(),
        value: expr('value', 'windowEwma(daily, 7d)'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.atl', unit: 'AU', label: 'Acute Training Load (ATL)' },
  },
  {
    id: 'tsb',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        daily: dailyLoads(),
        ctl: expr('ctl', 'windowEwma(daily, 42d)'),
        atl: expr('atl', 'windowEwma(daily, 7d)'),
        value: expr('value', 'ctl - atl'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.tsb', unit: 'AU', label: 'Training Stress Balance (TSB)' },
  },
  // ── Wellness metrics (user-captured ```wellness fences, #901 placeholders
  // landed): the capture writes day-grain user facts under raw keys
  // (soreness / sleep / hrv / weight / hang / hr / planned); these seeds
  // publish the `calc.*` rollup rows the dashboards query. Passthroughs keep
  // the calc.* = engine-published convention; composites derive from the
  // captured series. The `x * (x / x)` masks suppress zero-filled days
  // (0/0 drops the point) so unchecked days emit NO row instead of a
  // misleading zero.
  {
    id: 'soreness',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'user',
      nodes: {
        daily: { id: 'daily', kind: 'wql' as const, expression: 'avg:soreness{} by {day}' },
        value: expr('value', 'daily * (daily / daily)'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.soreness', unit: 'rating', label: 'Soreness' },
  },
  {
    id: 'sleep',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'user',
      nodes: {
        daily: { id: 'daily', kind: 'wql' as const, expression: 'avg:sleep{} by {day}' },
        value: expr('value', 'daily * (daily / daily)'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.sleep', unit: 'pts', label: 'Sleep (h)' },
  },
  {
    id: 'hrv',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'user',
      nodes: {
        daily: { id: 'daily', kind: 'wql' as const, expression: 'avg:hrv{} by {day}' },
        value: expr('value', 'daily * (daily / daily)'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.hrv', unit: 'pts', label: 'HRV (ms)' },
  },
  {
    // Readiness composite: soreness (inverted) 40%, sleep 30%, HRV 30%,
    // normalized to ~0-100. Pure arithmetic over the captured day series —
    // no clamp/min (those are scalar-only in the evaluator). Masks drop any
    // day missing one of the three inputs.
    id: 'readiness',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        soreness: { id: 'soreness', kind: 'wql' as const, expression: 'avg:soreness{} by {day}' },
        sleep: { id: 'sleep', kind: 'wql' as const, expression: 'avg:sleep{} by {day}' },
        hrv: { id: 'hrv', kind: 'wql' as const, expression: 'avg:hrv{} by {day}' },
        value: expr('value', '((10 - soreness) / 10 * 40 + sleep / 8 * 30 + hrv / 90 * 30) * (soreness / soreness) * (sleep / sleep) * (hrv / hrv)'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.readiness', unit: 'pts', label: 'Readiness' },
  },
  {
    // Max-hang MVC as % of bodyweight — the hangboard benchmark. Captured
    // `hang` (max hang added weight, kg) over `weight` (bodyweight, kg).
    id: 'mvcBw',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        hang: { id: 'hang', kind: 'wql' as const, expression: 'max:hang{} by {day}' },
        weight: { id: 'weight', kind: 'wql' as const, expression: 'avg:weight{} by {day}' },
        value: expr('value', 'hang / weight * 100'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.mvcBw', unit: '%', label: 'Max Hang %BW' },
  },
  {
    // Efficiency factor — running pace per beat of captured average HR.
    // pace (m/s) is cast to pts (§5.3 authoritative cast) so the ratio with
    // HR type-checks; the value is a normalized efficiency score.
    id: 'ef',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        dist: { id: 'dist', kind: 'wql' as const, expression: 'sum:totalDistance{discipline:running} by {day}' },
        elapsed: { id: 'elapsed', kind: 'wql' as const, expression: 'sum:elapsed{discipline:running} by {day}' },
        hr: { id: 'hr', kind: 'wql' as const, expression: 'avg:hr{} by {day}' },
        // pace m/s — elapsed facts are ms, so scale to seconds first.
        pace: expr('pace', 'dist / (elapsed / 1000)', 'pts'),
        value: expr('value', 'pace / hr * 100000', 'pts'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.ef', unit: 'pts', label: 'Efficiency Factor' },
  },
  {
    // Plan adherence — completed sessions over planned sessions per day.
    // `planned` is captured in wellness fences; sessions are counted facts.
    id: 'adherence',
    kind: 'output',
    scope: 'store',
    fences: WORKOUT_FENCES,
    variants: [{
      id: 'default', priority: 10, origin: 'analyzed',
      nodes: {
        sessions: { id: 'sessions', kind: 'wql' as const, expression: 'count:sessionLoad{} by {day}' },
        planned: { id: 'planned', kind: 'wql' as const, expression: 'avg:planned{} by {day}' },
        value: expr('value', 'sessions / planned'),
      },
    }],
    output: { nodeId: 'value', key: 'calc.adherence', unit: 'ratio', label: 'Plan Adherence' },
  },
];
