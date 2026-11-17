/**
 * sampleCorpus.ts — Shared sample analytics dataset for WOD Wiki.
 *
 * Provides a rich, genuine 16-week training block with benchmarks (Fran, Cindy,
 * Annie), strength accessories (back-squat, bench-press, deadlift), endurance
 * sessions (running, rowing), climbing/hangboard, and daily wellness/workload
 * rollups.
 *
 * Emits notes, session results, raw event records, and summary event records
 * compatible with DomainScenarioHarness, persistDomainWorld, and QueryService.
 */
import {
  MetricType,
  blockContentId,
  reconcileNoteBlocks,
  type EventRecord,
  type NoteBlock,
  type NoteTelemetryBundle,
  type Session,
  type StoredOutputStatement,
} from '@bitcobblers/wod-wiki-core';
import type {
  DomainWorldInput,
  TestNoteInput,
  TestSessionInput,
} from '@bitcobblers/wod-wiki-core/testing';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';

export const SAMPLE_TAG = 'sample';
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const LB_TO_KG = 0.453592;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface SampleMovement {
  effortSlug: string;
  discipline: string;
  reps: number;
  /** In pounds; 0 for bodyweight/cardio. */
  loadLbs: number;
  tisSeconds: number;
  distanceMeters?: number;
  grade?: string;
}

export type SampleWorkoutType =
  | 'fran'
  | 'cindy'
  | 'annie'
  | 'rowing'
  | 'running'
  | 'strength'
  | 'recoveryRun'
  | 'hangboard';

export interface SampleSession {
  noteId: string;
  title: string;
  workoutType: SampleWorkoutType;
  timestamp: number;
  durationSeconds: number;
  movements: SampleMovement[];
  tags: string[];
}

export interface SampleBundle {
  bundle: NoteTelemetryBundle;
  rawContent: string;
  blocks: Record<string, NoteBlock>;
  result: Session;
  rawEvents: EventRecord[];
  summaries: EventRecord[];
}

const INTENSITY_BY_EFFORT: Record<string, 'low' | 'moderate' | 'high'> = {
  thruster: 'high',
  'pull-up': 'high',
  'push-up': 'moderate',
  'air-squat': 'moderate',
  'double-under': 'high',
  'sit-up': 'low',
  rowing: 'moderate',
  running: 'moderate',
  'recovery-run': 'low',
  'back-squat': 'high',
  'bench-press': 'high',
  deadlift: 'high',
  'max-hang': 'high',
  climb: 'high',
};

const SESSION_INTENSITY: Record<SampleWorkoutType, 'low' | 'moderate' | 'high'> = {
  fran: 'high',
  cindy: 'moderate',
  annie: 'moderate',
  rowing: 'moderate',
  running: 'moderate',
  strength: 'high',
  recoveryRun: 'low',
  hangboard: 'high',
};

function buildFran(now: number, weekOffset: number, attempt: number): SampleSession {
  const baseDuration = 330 - attempt * 16;
  const durationSeconds = Math.max(180, round1(baseDuration + Math.sin(weekOffset) * 10));
  const loadLbs = 95 + attempt * 5;
  const reps = 45;
  return {
    noteId: `sample-fran-${weekOffset}`,
    title: `Sample — Fran (week ${16 - weekOffset})`,
    workoutType: 'fran',
    timestamp: now - weekOffset * WEEK - 2 * DAY,
    durationSeconds,
    tags: [SAMPLE_TAG, 'benchmark', 'crossfit'],
    movements: [
      { effortSlug: 'thruster', discipline: 'strength', reps, loadLbs, tisSeconds: round1(reps * 2.2) },
      { effortSlug: 'pull-up', discipline: 'gymnastics', reps, loadLbs: 0, tisSeconds: round1(reps * 1.6) },
    ],
  };
}

function buildCindy(now: number, weekOffset: number, attempt: number): SampleSession {
  const rounds = 10 + attempt + (weekOffset % 3);
  return {
    noteId: `sample-cindy-${weekOffset}`,
    title: `Sample — Cindy (week ${16 - weekOffset})`,
    workoutType: 'cindy',
    timestamp: now - weekOffset * WEEK - 2 * DAY,
    durationSeconds: 1200,
    tags: [SAMPLE_TAG, 'benchmark', 'crossfit'],
    movements: [
      { effortSlug: 'pull-up', discipline: 'gymnastics', reps: rounds * 5, loadLbs: 0, tisSeconds: round1(rounds * 5 * 1.5) },
      { effortSlug: 'push-up', discipline: 'gymnastics', reps: rounds * 10, loadLbs: 0, tisSeconds: round1(rounds * 10 * 1.2) },
      { effortSlug: 'air-squat', discipline: 'bodyweight', reps: rounds * 15, loadLbs: 0, tisSeconds: round1(rounds * 15 * 1.1) },
    ],
  };
}

function buildAnnie(now: number, weekOffset: number, attempt: number): SampleSession {
  const baseDuration = 540 - attempt * 22;
  const durationSeconds = Math.max(360, round1(baseDuration + Math.cos(weekOffset) * 15));
  const reps = 150;
  return {
    noteId: `sample-annie-${weekOffset}`,
    title: `Sample — Annie (week ${16 - weekOffset})`,
    workoutType: 'annie',
    timestamp: now - weekOffset * WEEK - 2 * DAY,
    durationSeconds,
    tags: [SAMPLE_TAG, 'benchmark', 'crossfit'],
    movements: [
      { effortSlug: 'double-under', discipline: 'gymnastics', reps, loadLbs: 0, tisSeconds: round1(reps * 0.5) },
      { effortSlug: 'sit-up', discipline: 'bodyweight', reps, loadLbs: 0, tisSeconds: round1(reps * 1.3) },
    ],
  };
}

function buildStrengthAccessory(now: number, weekOffset: number, attempt: number): SampleSession {
  const baseBackSquat = 135 + attempt * 5;
  const baseBenchPress = 115 + attempt * 5;
  const baseDeadlift = 185 + attempt * 5;
  const backSquatReps = 25;
  const benchPressReps = 25;
  const deadliftReps = 15;
  return {
    noteId: `sample-strength-${weekOffset}`,
    title: `Sample — Strength accessory (week ${16 - weekOffset})`,
    workoutType: 'strength',
    timestamp: now - weekOffset * WEEK - 4 * DAY,
    durationSeconds: 2400,
    tags: [SAMPLE_TAG, 'strength'],
    movements: [
      { effortSlug: 'back-squat', discipline: 'strength', reps: backSquatReps, loadLbs: baseBackSquat, tisSeconds: round1(backSquatReps * 2.5) },
      { effortSlug: 'bench-press', discipline: 'strength', reps: benchPressReps, loadLbs: baseBenchPress, tisSeconds: round1(benchPressReps * 2.0) },
      { effortSlug: 'deadlift', discipline: 'strength', reps: deadliftReps, loadLbs: baseDeadlift, tisSeconds: round1(deadliftReps * 2.8) },
    ],
  };
}

function buildRowing(now: number, weekOffset: number, attempt: number): SampleSession {
  const distanceMeters = 2000 + attempt * 250;
  const durationSeconds = round1(distanceMeters / 2.0);
  return {
    noteId: `sample-rowing-${weekOffset}`,
    title: `Sample — Rowing (week ${16 - weekOffset})`,
    workoutType: 'rowing',
    timestamp: now - weekOffset * WEEK - 5 * DAY,
    durationSeconds,
    tags: [SAMPLE_TAG, 'endurance', 'rowing'],
    movements: [
      { effortSlug: 'rowing', discipline: 'rowing', reps: 1, loadLbs: 0, tisSeconds: durationSeconds, distanceMeters },
    ],
  };
}

function buildRunning(now: number, weekOffset: number, attempt: number): SampleSession {
  const distanceMeters = 5000 + attempt * 500;
  const durationSeconds = round1(distanceMeters / 2.8);
  return {
    noteId: `sample-running-${weekOffset}`,
    title: `Sample — Running (week ${16 - weekOffset})`,
    workoutType: 'running',
    timestamp: now - weekOffset * WEEK - 5 * DAY,
    durationSeconds,
    tags: [SAMPLE_TAG, 'endurance', 'running'],
    movements: [
      { effortSlug: 'running', discipline: 'running', reps: 1, loadLbs: 0, tisSeconds: durationSeconds, distanceMeters },
    ],
  };
}

function buildRecoveryRun(now: number, weekOffset: number, attempt: number): SampleSession {
  const distanceMeters = 3000 + attempt * 50;
  const durationSeconds = round1(distanceMeters / 2.2);
  return {
    noteId: `sample-recovery-run-${weekOffset}`,
    title: `Sample — Recovery run (week ${16 - weekOffset})`,
    workoutType: 'recoveryRun',
    timestamp: now - weekOffset * WEEK - 6 * DAY,
    durationSeconds,
    tags: [SAMPLE_TAG, 'recovery', 'running'],
    movements: [
      { effortSlug: 'recovery-run', discipline: 'running', reps: 1, loadLbs: 0, tisSeconds: durationSeconds, distanceMeters },
    ],
  };
}

function buildHangboard(now: number, weekOffset: number, attempt: number): SampleSession {
  const durationSeconds = 1200;
  const grade = `V${Math.min(8, 5 + (attempt % 4))}`;
  return {
    noteId: `sample-hangboard-${weekOffset}`,
    title: `Sample — Hangboard session (week ${16 - weekOffset})`,
    workoutType: 'hangboard',
    timestamp: now - weekOffset * WEEK - 3 * DAY,
    durationSeconds,
    tags: [SAMPLE_TAG, 'hangboard', 'climbing'],
    movements: [
      { effortSlug: 'max-hang', discipline: 'climbing', reps: 5, loadLbs: 35, tisSeconds: 60 },
      { effortSlug: 'climb', discipline: 'climbing', reps: 3, loadLbs: 0, tisSeconds: 180, grade },
    ],
  };
}

/**
 * Generate a complete 16-week training block of sample sessions.
 */
export function generateSampleSessions(anchorNow: number = Date.now()): SampleSession[] {
  const sessions: SampleSession[] = [];
  for (let weekOffset = 0; weekOffset < 16; weekOffset++) {
    const block = Math.floor(weekOffset / 4);

    // Weekly strength accessory progression
    sessions.push(buildStrengthAccessory(anchorNow, weekOffset, weekOffset));

    // Rotating conditioning benchmarks / cardio
    if (weekOffset % 4 === 0) {
      sessions.push(buildFran(anchorNow, weekOffset, block));
    } else if (weekOffset % 4 === 1) {
      sessions.push(buildCindy(anchorNow, weekOffset, block));
    } else if (weekOffset % 4 === 2) {
      sessions.push(buildAnnie(anchorNow, weekOffset, block));
    } else if (weekOffset === 3 || weekOffset === 11) {
      sessions.push(buildRowing(anchorNow, weekOffset, block));
    } else if (weekOffset === 7 || weekOffset === 15) {
      sessions.push(buildRunning(anchorNow, weekOffset, block));
    }

    // Weekly recovery run
    sessions.push(buildRecoveryRun(anchorNow, weekOffset, weekOffset));

    // Bi-weekly hangboard / climbing session
    if (weekOffset % 2 === 0) {
      sessions.push(buildHangboard(anchorNow, weekOffset, weekOffset));
    }
  }
  return sessions.sort((a, b) => a.timestamp - b.timestamp);
}

export function buildSessionLogs(session: SampleSession): StoredOutputStatement[] {
  const startedAt = session.timestamp;
  const sessionIntensity = SESSION_INTENSITY[session.workoutType];
  const totalReps = session.movements.reduce((sum, m) => sum + m.reps, 0);
  const totalVolumeLbs = session.movements.reduce((sum, m) => sum + m.reps * m.loadLbs, 0);
  const totalTis = session.movements.reduce((sum, m) => sum + m.tisSeconds, 0);
  const totalDistance = session.movements.reduce((sum, m) => sum + (m.distanceMeters ?? 0), 0);
  const sessionLoad = round1(totalVolumeLbs / 100 + totalReps + session.durationSeconds / 10);

  const logs: StoredOutputStatement[] = [];

  const push = (
    label: string,
    value: number,
    unit: string,
    canonicalKey: string,
    tags?: { effortSlug?: string; discipline?: string; intensityTier?: string; grade?: string },
  ) => {
    const metadata: Record<string, unknown> = { canonicalKey };
    if (tags?.effortSlug) metadata.effortSlug = tags.effortSlug;
    if (tags?.discipline) metadata.effortDiscipline = tags.discipline;
    if (tags?.intensityTier) metadata.effortIntensityTier = tags.intensityTier;
    if (tags?.grade) metadata.grade = tags.grade;

    logs.push({
      id: logs.length,
      outputType: 'analytics',
      timeSpan: { started: startedAt },
      metrics: [
        { type: MetricType.Label, value: label, origin: 'analyzed' },
        { type: MetricType.Metric, value, unit, metadata, origin: 'analyzed' },
      ],
      sourceBlockKey: '',
      stackLevel: 0,
    });
  };

  // Workout-level facts
  const isBenchmark = session.workoutType === 'fran' || session.workoutType === 'cindy' || session.workoutType === 'annie';
  const workoutEffortSlug = isBenchmark ? session.workoutType : undefined;

  push('Elapsed time', session.durationSeconds, 's', 'elapsed', {
    effortSlug: workoutEffortSlug,
    intensityTier: sessionIntensity,
  });
  push('Total reps', totalReps, 'reps', 'totalReps', { intensityTier: sessionIntensity });
  push('Time in motion', round1(totalTis), 's', 'tis', { intensityTier: sessionIntensity });

  if (totalVolumeLbs > 0) {
    const discipline = session.workoutType === 'strength' ? 'strength' : undefined;
    push('Total volume', round1(totalVolumeLbs * LB_TO_KG), 'kg', 'totalVolume', {
      discipline,
      intensityTier: sessionIntensity,
    });
  }

  if (totalDistance > 0) {
    const distanceDiscipline = session.movements.find((m) => m.distanceMeters && m.distanceMeters > 0)?.discipline;
    push('Total distance', round1(totalDistance), 'm', 'totalDistance', {
      discipline: distanceDiscipline,
      intensityTier: sessionIntensity,
    });
  }

  const sessionDiscipline = session.workoutType === 'strength' ? 'strength' : undefined;
  push('Session load', sessionLoad, 'AU', 'sessionLoad', {
    discipline: sessionDiscipline,
    intensityTier: sessionIntensity,
  });

  // Per-effort outputs for `by {effort}` and `by {discipline}`
  for (const m of session.movements) {
    const movementVolumeLbs = m.reps * m.loadLbs;
    const movementIntensity = INTENSITY_BY_EFFORT[m.effortSlug] ?? 'moderate';
    const tags = {
      effortSlug: m.effortSlug,
      discipline: m.discipline,
      intensityTier: movementIntensity,
      grade: m.grade,
    };

    push('Total reps', m.reps, 'reps', 'totalReps', tags);
    push('Time in motion', m.tisSeconds, 's', 'tis', tags);
    if (movementVolumeLbs > 0) {
      push('Total volume', round1(movementVolumeLbs * LB_TO_KG), 'kg', 'totalVolume', tags);
    }
    push(
      'Session load',
      round1(movementVolumeLbs / 100 + m.reps + m.tisSeconds / 10),
      'AU',
      'sessionLoad',
      tags,
    );

    // Strength lifts provide e1RM and %1RM intensity
    if (m.discipline === 'strength' && m.loadLbs > 0) {
      const loadKg = round1(m.loadLbs * LB_TO_KG);
      const e1rm = round1(loadKg * (1 + m.reps / 30));
      const pct1rm = round1(100 / (1 + m.reps / 30));
      push('Estimated 1RM', e1rm, 'kg', 'calc.e1rm', tags);
      push('%1RM intensity', pct1rm, '%', 'calc.pct1rm', tags);
    }

    // Climbing/hangboard metrics
    if (m.effortSlug === 'max-hang') {
      const mvcBw = round1(28 + ((session.timestamp / DAY) % 8));
      push('Max Hang %BW', mvcBw, '%', 'calc.mvcBw', tags);
    }
    if (m.effortSlug === 'climb' && m.grade) {
      push('Sends', m.reps, 'count', 'calc.sends', tags);
    }
  }

  // Daily wellness & workload rollups (WW-028)
  const dayPhase = (salt: number): number => {
    const x = Math.sin((session.timestamp / DAY) * (12.9898 + salt) + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const soreness = 2 + Math.round(dayPhase(1) * 4);
  const sleepHours = round1(6.8 + dayPhase(2) * 1.6);
  const hrvMs = Math.round(52 + dayPhase(3) * 22);
  const readiness = round1(((10 - soreness) / 10) * 40 + (sleepHours / 8) * 30 + (hrvMs / 90) * 30);
  const monotony = round1(1.1 + dayPhase(4) * 0.7);
  const acwr = round1(0.85 + dayPhase(5) * 0.4);

  push('Readiness', readiness, 'pts', 'calc.readiness', { intensityTier: sessionIntensity });
  push('HRV', hrvMs, 'pts', 'calc.hrv', { intensityTier: sessionIntensity });
  push('Sleep', sleepHours, 'pts', 'calc.sleep', { intensityTier: sessionIntensity });
  push('Soreness', soreness, 'rating', 'calc.soreness', { intensityTier: sessionIntensity });
  push('Monotony', monotony, 'ratio', 'calc.monotony', { intensityTier: sessionIntensity });
  push('ACWR', acwr, 'ratio', 'calc.acwr', { intensityTier: sessionIntensity });

  // PMC models (calc.ctl / calc.atl / calc.tsb)
  const ctl = round1(45 + dayPhase(6) * 15);
  const atl = round1(50 + dayPhase(7) * 20);
  const tsb = round1(ctl - atl);
  push('Fitness (CTL)', ctl, 'AU', 'calc.ctl', { intensityTier: sessionIntensity });
  push('Fatigue (ATL)', atl, 'AU', 'calc.atl', { intensityTier: sessionIntensity });
  push('Form (TSB)', tsb, 'AU', 'calc.tsb', { intensityTier: sessionIntensity });

  // Adherence
  const adherence = round1(0.8 + dayPhase(8) * 0.2);
  push('Adherence', adherence, 'ratio', 'calc.adherence', { intensityTier: sessionIntensity });

  // Efficiency factor for running
  if (session.workoutType === 'running' || session.workoutType === 'recoveryRun') {
    const paceMPerS = round1(totalDistance / session.durationSeconds);
    const ef = round1((paceMPerS / 140) * 100_000);
    push('Efficiency factor', ef, 'pts', 'calc.ef', { intensityTier: sessionIntensity });
  }

  return logs;
}

function buildSampleResult(session: SampleSession, contentId: string, createdAt: number): Session {
  const baseId = `sample-${session.noteId}`;
  const resultId = `${baseId}-result`;
  const startTime = session.timestamp;
  const endTime = startTime + session.durationSeconds * 1000;

  return {
    id: resultId,
    noteId: session.noteId,
    blockId: 'blk-0',
    blockVersion: 1,
    blockContentId: contentId,
    origin: 'journal',
    status: 'completed',
    createdAt,
    startTime,
    endTime,
    duration: session.durationSeconds * 1000,
    completed: true,
  };
}

export function buildSampleBundle(session: SampleSession, now: number = Date.now()): SampleBundle {
  const body = session.movements
    .map(
      (m) =>
        `${m.distanceMeters ? `${m.distanceMeters}m` : m.reps} ${m.effortSlug.replaceAll('-', ' ')}${m.loadLbs ? ` ${m.loadLbs}lb` : ''}`,
    )
    .join('\n');
  const rawContent = `# ${session.title}\n\n\`\`\`log\n${body}\n\`\`\`\n`;
  const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 1, createId: () => 'blk-0' });
  const logs = buildSessionLogs(session);
  const result = buildSampleResult(session, blockContentId(body), now);
  const identity = {
    noteId: session.noteId,
    resultId: result.id,
    blockId: 'blk-0',
    blockVersion: 1,
    blockContentId: result.blockContentId,
    origin: result.origin,
    pageId: result.pageId,
    workoutTimestamp: session.timestamp,
  };
  const rawEvents = toEventRows(logs, identity);
  const summaries = toSummaryEventRows(logs, identity).map((r) => {
    const metric = r.metrics[0];
    if (metric && typeof metric.value === 'number') {
      return {
        ...r,
        reducerStats: {
          observedCount: 1,
          sum: metric.value,
          min: metric.value,
          max: metric.value,
        },
      };
    }
    return r;
  });

  const bundle: NoteTelemetryBundle = {
    note: {
      id: session.noteId,
      title: session.title,
      createdAt: session.timestamp,
      updatedAt: session.timestamp,
      targetDate: session.timestamp,
      rawContent,
      sourceRevision: 1,
      blocks,
      tags: session.tags,
      type: 'playground',
    },
    sessions: [result],
    events: [...rawEvents, ...summaries],
  };

  return { bundle, rawContent, blocks, result, rawEvents, summaries };
}

/**
 * Build a complete DomainWorldInput containing all sample notes, sessions, and events.
 */
export function buildSampleWorld(anchorNow: number = Date.now()): DomainWorldInput {
  const sessions = generateSampleSessions(anchorNow);
  const testNotes: TestNoteInput[] = [];
  const testSessions: TestSessionInput[] = [];

  for (const session of sessions) {
    const { rawContent, result, rawEvents, summaries } = buildSampleBundle(session, anchorNow);

    testNotes.push({
      id: session.noteId,
      title: session.title,
      rawContent,
      createdAt: session.timestamp,
      tags: session.tags,
      type: 'playground',
    });

    testSessions.push({
      id: result.id,
      noteId: session.noteId,
      blockId: 'blk-0',
      blockVersion: 1,
      startedAt: result.startTime,
      completedAt: result.endTime,
      durationMs: result.duration,
      origin: result.origin,
      events: [...rawEvents, ...summaries],
    });
  }

  return {
    notes: testNotes,
    sessions: testSessions,
  };
}
