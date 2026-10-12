/**
 * Sample analytics dataset (PRD #767 §5).
 *
 * Persistence mechanism: each session is written as a Session with
 * synthetic runtime logs, then flushed to the unified event store via
 * `appendEvents(toEventRows(...))` + `finalizeSummaries(resultId,
 * toSummaryEventRows(...))`. Every session is backed by a Note tagged `sample`
 * in the `note_tags` store.
 *
 * Purge removes sample-tagged live notes and analytics events. Immutable
 * revisions and Session pins remain available until an explicit store wipe.
 */
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import { MetricType, blockContentId, reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type { StoredOutputStatement } from '@/components/Editor/types';
import type { Session } from '@/types/storage';
import { storageService, type StorageService } from '@/services/storage';

/**
 * Backing store, injectable for tests. The full bun suite has sibling files
 * that stub this module process-globally via mock.module; tests construct a
 * real instance through the '?real' specifier and install it here (same
 * documented-exception pattern as queryService.integration.test.ts).
 */
let service: StorageService = storageService;

export function setSampleDataService(instance: StorageService): void {
  service = instance;
}

const SAMPLE_TAG = 'sample';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

interface SampleMovement {
  effortSlug: string;
  discipline: string;
  reps: number;
  /** Pounds; 0 for bodyweight movements. */
  loadLbs: number;
  /** Approximate seconds spent in motion for this movement. */
  tisSeconds: number;
  /** Distance in meters, when the movement is distance-bearing (rowing, running, etc.). */
  distanceMeters?: number;
}

interface SampleSession {
  noteId: string;
  title: string;
  workoutType: 'fran' | 'cindy' | 'annie' | 'rowing' | 'running' | 'strength' | 'recoveryRun';
  timestamp: number;
  durationSeconds: number;
  movements: SampleMovement[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const INTENSITY_BY_EFFORT: Record<string, 'low' | 'moderate' | 'high'> = {
  'thruster': 'high',
  'pull-up': 'high',
  'push-up': 'moderate',
  'air-squat': 'moderate',
  'double-under': 'high',
  'sit-up': 'low',
  'rowing': 'moderate',
  'running': 'moderate',
  'recovery-run': 'low',
  'back-squat': 'high',
  'deadlift': 'high',
};

const SESSION_INTENSITY: Record<SampleSession['workoutType'], 'low' | 'moderate' | 'high'> = {
  fran: 'high',
  cindy: 'moderate',
  annie: 'moderate',
  rowing: 'moderate',
  running: 'moderate',
  strength: 'high',
  recoveryRun: 'low',
};

function franMovement(reps: number, loadLbs: number, effortSlug: string, discipline: string): SampleMovement {
  const secondsPerRep = effortSlug === 'thruster' ? 2.2 : 1.6;
  return {
    effortSlug,
    discipline,
    reps,
    loadLbs,
    tisSeconds: round1(reps * secondsPerRep),
  };
}

function buildFran(now: number, weekOffset: number, attempt: number): SampleSession {
  // Slight improvement trend: duration drops ~5% per attempt; load rises.
  const baseDuration = 330 - attempt * 16;
  const durationSeconds = Math.max(180, round1(baseDuration + (Math.random() - 0.5) * 20));
  const loadLbs = 95 + attempt * 5;
  const thrusterReps = 45;
  const pullUpReps = 45;
  return {
    noteId: `sample-fran-${weekOffset}-${crypto.randomUUID()}`,
    title: `Sample — Fran (week ${16 - weekOffset})`,
    workoutType: 'fran',
    timestamp: now - weekOffset * WEEK,
    durationSeconds,
    movements: [
      franMovement(thrusterReps, loadLbs, 'thruster', 'strength'),
      franMovement(pullUpReps, 0, 'pull-up', 'gymnastics'),
    ],
  };
}

function buildCindy(now: number, weekOffset: number, attempt: number): SampleSession {
  // Capacity improves slightly: a few more rounds each attempt.
  const rounds = 10 + attempt + Math.round((Math.random() - 0.5) * 2);
  const clampedRounds = Math.max(8, rounds);
  return {
    noteId: `sample-cindy-${weekOffset}-${crypto.randomUUID()}`,
    title: `Sample — Cindy (week ${16 - weekOffset})`,
    workoutType: 'cindy',
    timestamp: now - weekOffset * WEEK,
    durationSeconds: 1200,
    movements: [
      { effortSlug: 'pull-up', discipline: 'gymnastics', reps: clampedRounds * 5, loadLbs: 0, tisSeconds: round1(clampedRounds * 5 * 1.5) },
      { effortSlug: 'push-up', discipline: 'gymnastics', reps: clampedRounds * 10, loadLbs: 0, tisSeconds: round1(clampedRounds * 10 * 1.2) },
      { effortSlug: 'air-squat', discipline: 'bodyweight', reps: clampedRounds * 15, loadLbs: 0, tisSeconds: round1(clampedRounds * 15 * 1.1) },
    ],
  };
}

function buildAnnie(now: number, weekOffset: number, attempt: number): SampleSession {
  const baseDuration = 540 - attempt * 22;
  const durationSeconds = Math.max(360, round1(baseDuration + (Math.random() - 0.5) * 30));
  const reps = 150;
  return {
    noteId: `sample-annie-${weekOffset}-${crypto.randomUUID()}`,
    title: `Sample — Annie (week ${16 - weekOffset})`,
    workoutType: 'annie',
    timestamp: now - weekOffset * WEEK,
    durationSeconds,
    movements: [
      { effortSlug: 'double-under', discipline: 'gymnastics', reps, loadLbs: 0, tisSeconds: round1(reps * 0.5) },
      { effortSlug: 'sit-up', discipline: 'bodyweight', reps, loadLbs: 0, tisSeconds: round1(reps * 1.3) },
    ],
  };
}

function buildStrengthAccessory(now: number, weekOffset: number, attempt: number): SampleSession {
  // Linear progression: load rises 5 lb per week.
  const baseBackSquat = 135 + attempt * 5;
  const baseDeadlift = 185 + attempt * 5;
  const backSquatReps = 25; // 5x5
  const deadliftReps = 15; // 3x5
  return {
    noteId: `sample-strength-${weekOffset}-${crypto.randomUUID()}`,
    title: `Sample — Strength accessory (week ${16 - weekOffset})`,
    workoutType: 'strength',
    timestamp: now - weekOffset * WEEK,
    durationSeconds: 1800,
    movements: [
      { effortSlug: 'back-squat', discipline: 'strength', reps: backSquatReps, loadLbs: baseBackSquat, tisSeconds: round1(backSquatReps * 2.5) },
      { effortSlug: 'deadlift', discipline: 'strength', reps: deadliftReps, loadLbs: baseDeadlift, tisSeconds: round1(deadliftReps * 2.8) },
    ],
  };
}

function buildRowing(now: number, weekOffset: number, attempt: number): SampleSession {
  const distanceMeters = 2000 + attempt * 250;
  const durationSeconds = round1(distanceMeters / 2.0 + (Math.random() - 0.5) * 30);
  return {
    noteId: `sample-rowing-${weekOffset}-${crypto.randomUUID()}`,
    title: `Sample — Rowing (week ${16 - weekOffset})`,
    workoutType: 'rowing',
    timestamp: now - weekOffset * WEEK,
    durationSeconds,
    movements: [
      { effortSlug: 'rowing', discipline: 'rowing', reps: 1, loadLbs: 0, tisSeconds: durationSeconds, distanceMeters },
    ],
  };
}

function buildRunning(now: number, weekOffset: number, attempt: number): SampleSession {
  const distanceMeters = 5000 + attempt * 500;
  const durationSeconds = round1(distanceMeters / 2.8 + (Math.random() - 0.5) * 60);
  return {
    noteId: `sample-running-${weekOffset}-${crypto.randomUUID()}`,
    title: `Sample — Running (week ${16 - weekOffset})`,
    workoutType: 'running',
    timestamp: now - weekOffset * WEEK,
    durationSeconds,
    movements: [
      { effortSlug: 'running', discipline: 'running', reps: 1, loadLbs: 0, tisSeconds: durationSeconds, distanceMeters },
    ],
  };
}

function buildRecoveryRun(now: number, weekOffset: number, attempt: number): SampleSession {
  const distanceMeters = 3000 + attempt * 50;
  const durationSeconds = round1(distanceMeters / 2.2 + (Math.random() - 0.5) * 60);
  return {
    noteId: `sample-recovery-run-${weekOffset}-${crypto.randomUUID()}`,
    title: `Sample — Recovery run (week ${16 - weekOffset})`,
    workoutType: 'recoveryRun',
    timestamp: now - weekOffset * WEEK,
    durationSeconds,
    movements: [
      { effortSlug: 'recovery-run', discipline: 'running', reps: 1, loadLbs: 0, tisSeconds: durationSeconds, distanceMeters },
    ],
  };
}

function generateSessions(now: number): SampleSession[] {
  const sessions: SampleSession[] = [];
  // 16-week training block with Fran/Cindy/Annie anchors, plus rowing,
  // running, and weekly strength accessory / recovery runs to densify
  // volume, intensity, and distance history.
  for (let weekOffset = 0; weekOffset < 16; weekOffset++) {
    const block = Math.floor(weekOffset / 4);
    // Loaded strength accessory every week drives a rising tonnage trend.
    sessions.push(buildStrengthAccessory(now, weekOffset, weekOffset));
    // Benchmark / conditioning rotation.
    if (weekOffset % 4 === 0) {
      sessions.push(buildFran(now, weekOffset, block));
    } else if (weekOffset % 4 === 1) {
      sessions.push(buildCindy(now, weekOffset, block));
    } else if (weekOffset % 4 === 2) {
      sessions.push(buildAnnie(now, weekOffset, block));
    } else if (weekOffset === 3 || weekOffset === 11) {
      sessions.push(buildRowing(now, weekOffset, block));
    } else if (weekOffset === 7 || weekOffset === 15) {
      sessions.push(buildRunning(now, weekOffset, block));
    }
    // Recovery run every week adds low-intensity mileage.
    sessions.push(buildRecoveryRun(now, weekOffset, weekOffset));
  }
  return sessions.sort((a, b) => a.timestamp - b.timestamp);
}

function buildSessionLogs(session: SampleSession): StoredOutputStatement[] {
  const startedAt = session.timestamp;
  const sessionIntensity = SESSION_INTENSITY[session.workoutType];
  const totalReps = session.movements.reduce((sum, m) => sum + m.reps, 0);
  const totalVolume = session.movements.reduce((sum, m) => sum + m.reps * m.loadLbs, 0);
  const totalTis = session.movements.reduce((sum, m) => sum + m.tisSeconds, 0);
  const totalDistance = session.movements.reduce((sum, m) => sum + (m.distanceMeters ?? 0), 0);
  const sessionLoad = round1(totalVolume / 100 + totalReps + session.durationSeconds / 10);

  const logs: StoredOutputStatement[] = [];

  const push = (
    label: string,
    value: number,
    unit: string,
    canonicalKey: string,
    tags?: { effortSlug?: string; discipline?: string; intensityTier?: string },
  ) => {
    const metadata: Record<string, unknown> = { canonicalKey };
    if (tags?.effortSlug) metadata.effortSlug = tags.effortSlug;
    if (tags?.discipline) metadata.effortDiscipline = tags.discipline;
    if (tags?.intensityTier) metadata.effortIntensityTier = tags.intensityTier;

    const output: StoredOutputStatement = {
      id: logs.length,
      outputType: 'analytics',
      timeSpan: { started: startedAt },
      metrics: [
        { type: MetricType.Label, value: label, origin: 'analyzed' },
        { type: MetricType.Metric, value, unit, metadata, origin: 'analyzed' },
      ],
      sourceBlockKey: '',
      stackLevel: 0,
    };
    logs.push(output);
  };

  push('Elapsed time', session.durationSeconds, 's', 'elapsed', { intensityTier: sessionIntensity });
  push('Total reps', totalReps, 'reps', 'totalReps', { intensityTier: sessionIntensity });
  push('Time in motion', round1(totalTis), 's', 'tis', { intensityTier: sessionIntensity });
  if (totalVolume > 0) {
    push('Total volume', round1(totalVolume), 'lb', 'totalVolume', { intensityTier: sessionIntensity });
  }
  if (totalDistance > 0) {
    const distanceDiscipline = session.movements.find((m) => m.distanceMeters && m.distanceMeters > 0)?.discipline;
    push('Total distance', round1(totalDistance), 'm', 'totalDistance', { discipline: distanceDiscipline, intensityTier: sessionIntensity });
  }
  push('Session load', sessionLoad, 'AU', 'sessionLoad', { intensityTier: sessionIntensity });

  // Per-effort outputs for `by {effort}` / `by {discipline}` queries.
  for (const m of session.movements) {
    const movementVolume = m.reps * m.loadLbs;
    const movementIntensity = INTENSITY_BY_EFFORT[m.effortSlug] ?? 'moderate';
    const tags = { effortSlug: m.effortSlug, discipline: m.discipline, intensityTier: movementIntensity };
    push('Total reps', m.reps, 'reps', 'totalReps', tags);
    push('Time in motion', m.tisSeconds, 's', 'tis', tags);
    if (movementVolume > 0) {
      push('Total volume', round1(movementVolume), 'lb', 'totalVolume', tags);
    }
    push('Session load', round1(movementVolume / 100 + m.reps + m.tisSeconds / 10), 'AU', 'sessionLoad', tags);
  }

  return logs;
}

function buildSampleResult(session: SampleSession, contentId: string): Session {
  const baseId = `sample-${session.noteId}`;
  const resultId = `${baseId}-result`;
  const startTime = session.timestamp;
  const endTime = startTime + session.durationSeconds * 1000;

  return {
    id: resultId,
    noteId: session.noteId,
    blockId: 'sample-block',
    blockVersion: 1,
    blockContentId: contentId,
    origin: 'journal',
    status: 'completed',
    createdAt: Date.now(),
    startTime,
    endTime,
    duration: session.durationSeconds * 1000,
    completed: true,
  };
}

async function getSampleTagId(): Promise<string | undefined> {
  const tag = await service.getTagByLabel(SAMPLE_TAG);
  return tag?.id;
}

async function getSampleNoteIds(): Promise<string[]> {
  const notes = await service.getNotesForTag(SAMPLE_TAG);
  return notes.map(n => n.id);
}

export async function hasSampleData(): Promise<boolean> {
  const noteIds = await getSampleNoteIds();
  if (noteIds.length === 0) return false;
  const events = await service.scanAll();
  return events.some((event) => noteIds.includes(event.noteId));
}

export async function loadSampleData(): Promise<{ facts: number }> {
  if (await hasSampleData()) {
    const noteIds = await getSampleNoteIds();
    const events = await service.scanAll();
    return { facts: events.filter((event) => event.grain === 'summary' && noteIds.includes(event.noteId)).length };
  }

  const now = Date.now();
  const sessions = generateSessions(now);
  let factsWritten = 0;

  for (const session of sessions) {
    const body = session.movements.map(movement => `${movement.distanceMeters ? `${movement.distanceMeters}m` : movement.reps} ${movement.effortSlug.replaceAll('-', ' ')}${movement.loadLbs ? ` ${movement.loadLbs}lb` : ''}`).join('\n');
    const rawContent = `# ${session.title}\n\n\`\`\`log\n${body}\n\`\`\`\n`;
    const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 1, createId: () => 'sample-block' });
    const logs = buildSessionLogs(session);
    const result = buildSampleResult(session, blockContentId(body));
    const identity = {
      noteId: session.noteId,
      resultId: result.id,
      blockId: result.blockId,
      blockVersion: result.blockVersion,
      blockContentId: result.blockContentId,
      origin: result.origin,
      pageId: result.pageId,
      workoutTimestamp: session.timestamp,
    };

    factsWritten += await service.withTransaction(['notes', 'block_revisions', 'block_index', 'block_efforts', 'tags', 'note_tags', 'tag_types', 'sessions', 'events'], async scoped => {
      await scoped.saveNoteSource({ noteId: session.noteId, rawContent, blocks, expectedSourceRevision: 0, metadata: { title: session.title }, noteType: 'playground', createdAt: session.timestamp });
      await scoped.setNoteTags(session.noteId, [SAMPLE_TAG]);
      await scoped.saveSession(result);
      await scoped.appendEvents(toEventRows(logs, identity));
      const summaries = toSummaryEventRows(logs, identity);
      await scoped.finalizeSummaries(result.id, summaries);
      return summaries.length;
    });
  }

  return { facts: factsWritten };
}

export async function purgeSampleData(): Promise<void> {
  const noteIds = await getSampleNoteIds();
  if (noteIds.length === 0) return;

  // Removing a sample Note does not garbage-collect its pinned history.
  for (const noteId of noteIds) {
    await service.deleteEvents((await service.getEventsForNote(noteId)).map(event => event.id));
    await service.deleteNote(noteId);
  }

  // Drop the shared sample tag if nothing links to it anymore.
  const notes = await service.getNotesForTag(SAMPLE_TAG);
  if (notes.length === 0) {
    const tagId = await getSampleTagId();
    if (tagId) {
      await service.deleteTag(tagId);
    }
  }
}
