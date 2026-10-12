/**
 * homeAnalyticsData.ts — the isolated example dataset behind the home
 * analytics showcase (#938) and the queries its widgets run.
 *
 * The dataset is a small coherent 16-week training block built by pure,
 * deterministic functions (fixed progressions — no Math.random, no clock
 * reads beyond the injectable anchor). Rows are emitted through the engine's
 * own `toSummaryEventRows` pipeline and served by a REAL `QueryService` over
 * the engine's `inMemoryEventStore` — the same query engine the live journal
 * uses, with zero writes to visitor storage: this module never imports
 * storageService, and `loadSampleData` (which writes notes/sessions) is
 * never called on home arrival.
 *
 * The `calc.*` store-scope targets the prebuilt boards query (adherence,
 * ctl/atl/tsb, acwr, ef) are published as engine-authored summary facts per
 * the `calc.* = engine-published` convention (packages/wql/src/vocabulary.ts)
 * — derived here from the same session numbers the boards display, so every
 * widget answers genuinely through the query engine. Segment-scope targets
 * (calc.e1rm, calc.pct1rm) are the Epley formulas from
 * packages/lang/src/analytics/calc/seeds.ts applied per logged top set.
 */
import { QueryService, inMemoryEventStore, type QueryResult } from '@bitcobblers/wod-wiki-engine';
import { toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import type { StoredOutputStatement } from '@/components/Editor/types';
import type { EventRecord } from '@/types/storage';
import { computeWorkloadRollups, dayBucket } from '@/services/analytics/rollup';

/** A named WQL query backing one showcase widget. */
export interface AnalyticsQueryDef {
  key: string;
  query: string;
}

/** The six showcase widgets, keyed for execution against the example store. */
export const HOME_ANALYTICS_QUERIES: AnalyticsQueryDef[] = [
  { key: 'repsByEffort', query: 'sum:totalReps{} by {effort} last 6w' },
  { key: 'weeklyVolume', query: 'sum:totalVolume{} by {week} last 6w' },
  { key: 'loadByIntensity', query: 'sum:sessionLoad{} by {intensity, week} last 6w' },
  { key: 'volumeByEffort', query: 'sum:totalVolume{discipline:strength} by {effort} last 6w' },
  { key: 'avgTis', query: 'avg:tis{} last 6w' },
  { key: 'totalVolume', query: 'sum:totalVolume{} last 6w' },
];

export interface HomeAnalyticsData {
  repsByEffort: QueryResult;
  weeklyVolume: QueryResult;
  loadByIntensity: QueryResult;
  volumeByEffort: QueryResult;
  avgTis: QueryResult;
  totalVolume: QueryResult;
}

// ── the example dataset ─────────────────────────────────────────────────────

const DAY = 86_400_000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Local-civil-date timestamp `daysAgo` days before the anchor (morning hour). */
function daysAgoTs(now: number, daysAgo: number, hour = 9): number {
  const d = new Date(now - daysAgo * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

interface EffortTags {
  effortSlug?: string;
  discipline?: string;
  intensityTier?: string;
}

/** One analytics summary output — Label + Metric pair, the same shape the
 *  runtime's tier-2 analyzer emits (mirrors services/analytics/sample.ts). */
function output(
  logs: StoredOutputStatement[],
  label: string,
  value: number,
  unit: string,
  canonicalKey: string,
  tags: EffortTags = {},
): void {
  const metadata: Record<string, unknown> = { canonicalKey };
  if (tags.effortSlug) metadata.effortSlug = tags.effortSlug;
  if (tags.discipline) metadata.effortDiscipline = tags.discipline;
  if (tags.intensityTier) metadata.effortIntensityTier = tags.intensityTier;
  logs.push({
    id: logs.length,
    outputType: 'analytics',
    // Row timestamps anchor on identity.workoutTimestamp (see
    // toSummaryEventRows) — the statement start is only the fallback.
    timeSpan: { started: 0 },
    metrics: [
      { type: MetricType.Label, value: label, origin: 'analyzed' },
      { type: MetricType.Metric, value, unit, origin: 'analyzed', metadata },
    ],
    sourceBlockKey: '',
    stackLevel: 0,
  });
}

interface ExampleIdentity {
  noteId: string;
  resultId: string;
  blockContentId: string;
  timestamp: number;
}

/** Aggregators the boards/showcase run with `avg` — a summary is admitted
 *  to avg/count only with retained observation stats (selection.ts
 *  statsSufficient). These rows are SINGLE authored observations, so the
 *  stats restate the singleton honestly (never invented for arbitrary
 *  folds — derivation.ts contract). */
const AVG_STAT_KEYS: Set<string> = new Set(['tis', 'calc.acwr', 'calc.adherence', 'calc.ef', 'calc.pct1rm']);

function sessionEvents(logs: StoredOutputStatement[], id: ExampleIdentity): EventRecord[] {
  const rows = toSummaryEventRows(logs, {
    noteId: id.noteId,
    resultId: id.resultId,
    blockId: 'example-block',
    blockVersion: 1,
    blockContentId: id.blockContentId,
    origin: 'journal',
    workoutTimestamp: id.timestamp,
  });
  return rows.map((r) => {
    const metric = r.metrics[0];
    if (!metric || !('metadata' in metric)) return r;
    const key = metric.metadata?.canonicalKey;
    if (typeof key !== 'string' || !AVG_STAT_KEYS.has(key) || typeof metric.value !== 'number') return r;
    return { ...r, reducerStats: { observedCount: 1, sum: metric.value, min: metric.value, max: metric.value } };
  });
}

/**
 * Build the isolated example event set for an anchor instant. 16 weeks of
 * training: a weekly strength day (rising top sets → calc.e1rm/pct1rm and
 * the road-to-560 board), a rotating conditioning day (Fran/Cindy/Annie →
 * intensity spread), an easy run (skipped one week in four → adherence
 * dips, calc.ef) and a row. All quantities in kg/m/s.
 */
export function buildHomeExampleEvents(now: number = Date.now()): EventRecord[] {
  const events: EventRecord[] = [];
  /** dayBucket ordinal → Σ sessionLoad (drives acwr/ctl/atl/tsb). */
  const loadsByDay = new Map<number, number>();
  /** Days with a planned session that did not happen (planned but skipped). */
  const skippedDays: number[] = [];
  /** Run days for calc.ef: { day, pace m/s }. */
  const runDays: Array<{ day: number; pace: number }> = [];

  const addLoad = (ts: number, value: number) => {
    const day = dayBucket(ts);
    loadsByDay.set(day, (loadsByDay.get(day) ?? 0) + value);
  };

  for (let w = 0; w < 16; w++) {
    // Offsets keep the newest session yesterday: an in-progress "today" can
    // never carry a future-dated row past a query's rangeEnd.
    const weeksAgo = (15 - w) * 7 + 1;

    // ── Monday: strength day — one top set per lift ─────────────────────
    const strengthTs = daysAgoTs(now, weeksAgo);
    {
      const lifts = [
        { slug: 'back-squat', top: 100 + 4 * w, reps: 5, tis: 12.5 },
        { slug: 'bench-press', top: 80 + 2.5 * w, reps: 5, tis: 10 },
        { slug: 'deadlift', top: 140 + 4 * w, reps: 3, tis: 8.4 },
      ];
      const logs: StoredOutputStatement[] = [];
      let volume = 0;
      let tis = 0;
      for (const l of lifts) {
        const vol = l.reps * l.top;
        volume += vol;
        tis += l.tis;
        const tags = { effortSlug: l.slug, discipline: 'strength', intensityTier: 'high' };
        output(logs, 'Total reps', l.reps, 'reps', 'totalReps', tags);
        output(logs, 'Training intensity score', l.tis, 'pts', 'tis', tags);
        output(logs, 'Total volume', vol, 'kg', 'totalVolume', tags);
        // Epley (calc/seeds.ts): load × (1 + reps/30), and its inverse.
        output(logs, 'Estimated 1RM', round1(l.top * (1 + l.reps / 30)), 'kg', 'calc.e1rm', tags);
        output(logs, '%1RM intensity', round1(100 / (1 + l.reps / 30)), '%', 'calc.pct1rm', tags);
      }
      // One workout-level sessionLoad row per session → count:sessionLoad
      // answers one session per training day for calc.adherence.
      const load = round1(volume / 100 + 13 + tis / 10);
      output(logs, 'Session load', load, 'AU', 'sessionLoad', { discipline: 'strength', intensityTier: 'high' });
      events.push(...sessionEvents(logs, {
        noteId: `example-strength-w${w}`,
        resultId: `example-strength-w${w}-r`,
        blockContentId: 'example-content-strength',
        timestamp: strengthTs,
      }));
      addLoad(strengthTs, load);
    }

    // ── Wednesday: conditioning rotation ────────────────────────────────
    const condTs = daysAgoTs(now, weeksAgo + 2);
    {
      const logs: StoredOutputStatement[] = [];
      let intensity: string;
      if (w % 3 === 0) {
        intensity = 'high'; // Fran
        for (const [slug, reps, tisPerRep, loadLbs] of [['thruster', 45, 2.2, 42.5], ['pull-up', 45, 1.6, 0]] as const) {
          const tags = { effortSlug: slug, discipline: loadLbs ? 'strength' : 'gymnastics', intensityTier: intensity };
          output(logs, 'Total reps', reps, 'reps', 'totalReps', tags);
          output(logs, 'Training intensity score', round1(reps * tisPerRep), 'pts', 'tis', tags);
          if (loadLbs) output(logs, 'Total volume', reps * loadLbs, 'kg', 'totalVolume', tags);
        }
      } else if (w % 3 === 1) {
        intensity = 'moderate'; // Cindy — rounds rise slowly with capacity
        const rounds = 16 + (w % 5);
        for (const [slug, perRound, tisPerRep] of [['pull-up', 5, 1.5], ['push-up', 10, 1.2], ['air-squat', 15, 1.1]] as const) {
          const reps = rounds * perRound;
          const tags = { effortSlug: slug, discipline: 'gymnastics', intensityTier: intensity };
          output(logs, 'Total reps', reps, 'reps', 'totalReps', tags);
          output(logs, 'Training intensity score', round1(reps * tisPerRep), 'pts', 'tis', tags);
        }
      } else {
        intensity = 'moderate'; // Annie
        for (const [slug, reps, tisPerRep] of [['double-under', 150, 0.5], ['sit-up', 150, 1.3]] as const) {
          const tags = { effortSlug: slug, discipline: 'gymnastics', intensityTier: intensity };
          output(logs, 'Total reps', reps, 'reps', 'totalReps', tags);
          output(logs, 'Training intensity score', round1(reps * tisPerRep), 'pts', 'tis', tags);
        }
      }
      const load = round1(60 / 100 + 0 + 300 / 10); // steady conditioning dose
      output(logs, 'Session load', load, 'AU', 'sessionLoad', { intensityTier: intensity });
      events.push(...sessionEvents(logs, {
        noteId: `example-conditioning-w${w}`,
        resultId: `example-conditioning-w${w}-r`,
        blockContentId: 'example-content-conditioning',
        timestamp: condTs,
      }));
      addLoad(condTs, load);
    }

    // ── Friday: easy run — planned every week, skipped 1 in 4 ───────────
    const runTs = daysAgoTs(now, weeksAgo + 4, 8);
    if (w % 4 === 1) {
      skippedDays.push(dayBucket(runTs));
    } else {
      const dist = 6000 + 100 * w;
      const elapsedS = round1(dist / 2.8);
      const logs: StoredOutputStatement[] = [];
      const tags = { effortSlug: 'running', discipline: 'running', intensityTier: 'low' };
      output(logs, 'Total distance', dist, 'm', 'totalDistance', tags);
      output(logs, 'Elapsed time', elapsedS, 's', 'elapsed', tags);
      output(logs, 'Training intensity score', elapsedS, 'pts', 'tis', tags);
      const load = round1(elapsedS / 10);
      output(logs, 'Session load', load, 'AU', 'sessionLoad', { intensityTier: 'low' });
      events.push(...sessionEvents(logs, {
        noteId: `example-run-w${w}`,
        resultId: `example-run-w${w}-r`,
        blockContentId: 'example-content-run',
        timestamp: runTs,
      }));
      addLoad(runTs, load);
      runDays.push({ day: dayBucket(runTs), pace: dist / elapsedS });
    }

    // ── Sunday: row ─────────────────────────────────────────────────────
    const rowTs = daysAgoTs(now, weeksAgo + 6, 10);
    {
      const dist = 4000 + 50 * w;
      const elapsedS = round1(dist / 2.0);
      const logs: StoredOutputStatement[] = [];
      const tags = { effortSlug: 'rowing', discipline: 'rowing', intensityTier: 'moderate' };
      output(logs, 'Total distance', dist, 'm', 'totalDistance', tags);
      output(logs, 'Elapsed time', elapsedS, 's', 'elapsed', tags);
      output(logs, 'Training intensity score', elapsedS, 'pts', 'tis', tags);
      const load = round1(elapsedS / 10);
      output(logs, 'Session load', load, 'AU', 'sessionLoad', { intensityTier: 'moderate' });
      events.push(...sessionEvents(logs, {
        noteId: `example-row-w${w}`,
        resultId: `example-row-w${w}-r`,
        blockContentId: 'example-content-row',
        timestamp: rowTs,
      }));
      addLoad(rowTs, load);
    }
  }

  // ── store-scope calc.* facts (engine-published convention) ──────────────
  const throughDay = Math.max(...loadsByDay.keys());
  const dayTs = (day: number, hour = 10) => {
    const d = new Date(day * DAY);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const publishCalc = (resultId: string, ts: number, entries: Array<[string, number, string]>) => {
    const logs: StoredOutputStatement[] = [];
    for (const [key, value, unit] of entries) output(logs, key, value, unit, key);
    events.push(...sessionEvents(logs, {
      noteId: 'example-calc',
      resultId,
      blockContentId: 'example-content-calc',
      timestamp: ts,
    }));
  };

  // ACWR (Foster windows — same math the app rollup uses) per day.
  for (const rollup of computeWorkloadRollups(loadsByDay, throughDay)) {
    if (rollup.acwr !== undefined) {
      publishCalc(`example-calc-d${rollup.day}`, dayTs(rollup.day), [['calc.acwr', round1(rollup.acwr), 'ratio']]);
    }
  }

  // PMC: CTL/ATL as canonical-gain EWMAs (1/42, 1/7) over daily load;
  // TSB = CTL − ATL. Published on training days — value widgets read last:.
  let ctl = 0;
  let atl = 0;
  const firstDay = Math.min(...loadsByDay.keys());
  for (let day = firstDay; day <= throughDay; day++) {
    const load = loadsByDay.get(day) ?? 0;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    if (loadsByDay.has(day)) {
      publishCalc(`example-calc-pmc-d${day}`, dayTs(day), [
        ['calc.ctl', round1(ctl), 'AU'],
        ['calc.atl', round1(atl), 'AU'],
        ['calc.tsb', round1(ctl - atl), 'AU'],
      ]);
    }
  }

  // Adherence: done sessions / planned sessions per training day (a skipped
  // run week answers 0 — the "are planned sessions getting done?" dip).
  const plannedDays = new Set<number>([...loadsByDay.keys()]);
  for (const day of skippedDays) plannedDays.add(day);
  for (const day of plannedDays) {
    const done = loadsByDay.has(day) ? 1 : 0;
    publishCalc(`example-calc-adh-d${day}`, dayTs(day, 7), [['calc.adherence', done, 'ratio']]);
  }

  // Efficiency factor: pace (m/s) ÷ avg HR × 100 000 on run days.
  for (const run of runDays) {
    const hr = 140 + 1; // steady easy-run HR
    publishCalc(`example-calc-ef-d${run.day}`, dayTs(run.day, 8), [['calc.ef', round1((run.pace / hr) * 100000), 'pts']]);
  }

  return events;
}

// ── the example query service ───────────────────────────────────────────────

/** A fresh QueryService over the example dataset — pure, in-memory, no
 *  visitor storage. Anchored at `now` so relative windows (`last 6w`) see
 *  the block. */
export function createHomeExampleQueryService(now: number = Date.now()): QueryService {
  return new QueryService(inMemoryEventStore(buildHomeExampleEvents(now)));
}

let exampleService: QueryService | null = null;

/** Process-wide example store — built lazily, one anchor per page load. */
export function getHomeExampleQueryService(): QueryService {
  return (exampleService ??= createHomeExampleQueryService());
}
