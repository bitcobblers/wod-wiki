export type FixtureId = 'fran' | 'track-4x1000' | 'manual-strength-log';

export type MetricDomainKind = 'metcon' | 'endurance' | 'strength';

export interface ProtoSplitRow {
  id: string;
  round: number;
  splitIndex: number;
  effortSlug: string;
  movement: string;
  targetReps: number | null;
  actualReps: number | null;
  targetLoadLbs: number | null;
  actualLoadLbs: number | null;
  targetDurationSec: number | null;
  actualDurationSec: number | null;
  targetDistanceM: number | null;
  actualDistanceM: number | null;
  reference1RmLbs?: number;
  hrBpm?: number;
  notes?: string;
}

export interface ProtoSplitDerived extends ProtoSplitRow {
  elapsedOffsetSec: number;
  volumeLbs: number | null;
  e1rmLbs: number | null;
  pct1rm: number | null;
  powerLbsPerSec: number | null;
  paceSecPerKm: number | null;
  isModified: boolean;
}

export interface ProtoPriorRun {
  resultId: string;
  attemptLabel: string;
  dateLabel: string;
  dateIso: string;
  rpe: number;
  elapsedSec: number;
  totalVolumeLbs: number | null;
  totalReps: number;
  totalDistanceM: number | null;
  tis: number;
  sessionLoadAu: number;
  maxE1rmLbs: number | null;
  splitDurationsSec: number[];
  splitVolumesLbs: number[];
}

export interface ProtoRawEventFrame {
  id: string;
  offsetSec: number;
  outputType: 'system' | 'segment' | 'analytics';
  sourceBlockKey: string;
  summary: string;
  payloadPreview: string;
}

export interface ProtoWorkoutFixture {
  id: FixtureId;
  title: string;
  shortLabel: string;
  domain: MetricDomainKind;
  resultId: string;
  blockContentId: string;
  noteId: string;
  noteTitle: string;
  dateLabel: string;
  dateIso: string;
  notebookSlug: string;
  notebookTitle: string;
  attemptLabel: string;
  hasSegments: boolean;
  defaultRpe: number | null;
  proseBefore: string;
  proseAfter: string;
  wodBlockTag: string;
  wodScript: string;
  initialSplits: ProtoSplitRow[];
  priorRuns: ProtoPriorRun[];
  rawFrames: ProtoRawEventFrame[];
}

export interface ProtoOtherWorkout {
  blockContentId: string;
  title: string;
  notebookSlug: string;
  notebookTitle: string;
  dateLabel: string;
  elapsedSec: number;
  totalVolumeLbs: number;
  tis: number;
  avgPaceSecPerKm?: number;
  splitCount: number;
  splitDurationsSec: number[];
  splitVolumesLbs: number[];
}

export interface ProtoNotebookBenchmark {
  slug: string;
  title: string;
  weeklyVolumeLbs: number[];
  weeklyTis: number[];
  avgSessionTis: number;
  avgSessionVolumeLbs: number;
  adherencePct: number;
  sessionCount: number;
}

export interface ProtoMovementRollup {
  effortSlug: string;
  movement: string;
  sets: number;
  totalReps: number;
  avgLoadLbs: number | null;
  totalVolumeLbs: number | null;
  totalDurationSec: number;
  totalDistanceM: number | null;
  bestE1rmLbs: number | null;
  avgPaceSecPerKm: number | null;
  hasPr: boolean;
  prDetail?: string;
}

export interface ProtoSummaryMetrics {
  elapsedSec: number;
  priorDeltaSec: number | null;
  totalVolumeLbs: number | null;
  totalReps: number;
  totalDistanceM: number | null;
  avgPaceSecPerKm: number | null;
  maxE1rmLbs: number | null;
  tis: number;
  sessionLoadAu: number;
  prBadges: string[];
  movementRollup: ProtoMovementRollup[];
  splitCount: number;
  modifiedCount: number;
}

export type ProtoMeasureId =
  | 'splitTime'
  | 'volume'
  | 'e1rm'
  | 'reps'
  | 'tis'
  | 'pace';

export type ProtoComparisonScopeId =
  | 'current'
  | 'priorRuns'
  | 'otherWorkout'
  | 'currentNotebook'
  | 'otherNotebook'
  | 'baseline4w'
  | 'goalTarget';

export type ProtoWidgetVizType =
  | 'line'
  | 'bar'
  | 'summary'
  | 'table'
  | 'value';

export interface ProtoComparisonConfig {
  title: string;
  question: string;
  measure: ProtoMeasureId;
  effortFilter: string; // 'all' or effortSlug
  scopes: ProtoComparisonScopeId[];
  otherWorkoutId: string;
  otherNotebookSlug: string;
  bindingMode: 'pin' | 'tokens';
  vizType: ProtoWidgetVizType;
  goalValue: number;
}

export interface ProtoDashboardWidget {
  id: string;
  title: string;
  question: string;
  vizType: ProtoWidgetVizType;
  spanCols: 1 | 2 | 4;
  fixtureId: FixtureId;
  config: ProtoComparisonConfig;
  isNew?: boolean;
}

export interface ProtoDashboard {
  slug: string;
  title: string;
  editable: boolean;
  clonedFrom?: string;
  tokens: {
    block: string;
    notebook: string;
    effort: string;
    range: '4w' | '12w' | 'all';
  };
  widgets: ProtoDashboardWidget[];
}

export const WEEK_LABELS = ['W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'This Wk'] as const;

export const OTHER_WORKOUTS: readonly ProtoOtherWorkout[] = [
  {
    blockContentId: 'grace-30-cj',
    title: 'Grace (30 Clean & Jerks)',
    notebookSlug: 'benchmarks',
    notebookTitle: 'CrossFit Benchmarks',
    dateLabel: 'Nov 12',
    elapsedSec: 194,
    totalVolumeLbs: 4050,
    tis: 29.4,
    splitCount: 6,
    splitDurationsSec: [31, 32, 33, 34, 33, 31],
    splitVolumesLbs: [675, 675, 675, 675, 675, 675],
  },
  {
    blockContentId: 'helen-3-rounds',
    title: 'Helen (3 Rounds)',
    notebookSlug: 'benchmarks',
    notebookTitle: 'CrossFit Benchmarks',
    dateLabel: 'Nov 05',
    elapsedSec: 542,
    totalVolumeLbs: 3339,
    tis: 48.2,
    splitCount: 6,
    splitDurationsSec: [98, 76, 104, 82, 100, 82],
    splitVolumesLbs: [0, 1113, 0, 1113, 0, 1113],
  },
  {
    blockContentId: 'squat-5x5',
    title: 'Back Squat 5×5',
    notebookSlug: 'strength-cycle',
    notebookTitle: 'Strength Cycle',
    dateLabel: 'Nov 16',
    elapsedSec: 1120,
    totalVolumeLbs: 5625,
    tis: 36.8,
    splitCount: 5,
    splitDurationsSec: [215, 220, 225, 230, 230],
    splitVolumesLbs: [1125, 1125, 1125, 1125, 1125],
  },
];

export const NOTEBOOK_BENCHMARKS: readonly ProtoNotebookBenchmark[] = [
  {
    slug: 'benchmarks',
    title: 'CrossFit Benchmarks',
    weeklyVolumeLbs: [9200, 11400, 10800, 12600, 11900, 13400],
    weeklyTis: [112, 134, 126, 149, 138, 156],
    avgSessionTis: 36.4,
    avgSessionVolumeLbs: 4120,
    adherencePct: 92,
    sessionCount: 14,
  },
  {
    slug: 'strength-cycle',
    title: 'Strength Cycle',
    weeklyVolumeLbs: [16400, 18100, 19500, 17800, 21200, 22400],
    weeklyTis: [141, 152, 165, 148, 173, 181],
    avgSessionTis: 41.2,
    avgSessionVolumeLbs: 5840,
    adherencePct: 88,
    sessionCount: 18,
  },
  {
    slug: 'marathon-prep',
    title: 'Polarized Base',
    weeklyVolumeLbs: [2100, 2400, 1900, 2800, 2600, 2900],
    weeklyTis: [188, 204, 179, 221, 214, 236],
    avgSessionTis: 54.8,
    avgSessionVolumeLbs: 840,
    adherencePct: 95,
    sessionCount: 22,
  },
];

export const WORKOUT_FIXTURES: Record<FixtureId, ProtoWorkoutFixture> = {
  fran: {
    id: 'fran',
    title: 'Fran — 21-15-9 Benchmark',
    shortLabel: 'Fran (Metcon)',
    domain: 'metcon',
    resultId: '01a1f5f2-9361-767c-b727-8dd7634d4b3b',
    blockContentId: 'fran-21-15-9',
    noteId: 'note-2026-11-19-fran',
    noteTitle: 'Morning Session — Fran Re-test',
    dateLabel: 'Nov 19, 2026',
    dateIso: '2026-11-19',
    notebookSlug: 'benchmarks',
    notebookTitle: 'CrossFit Benchmarks',
    attemptLabel: 'Run #3',
    hasSegments: true,
    defaultRpe: 8,
    proseBefore:
      'Re-testing Fran after a 6-week thruster front-rack mobility block. Goal is unbroken 21s and fast transitions to the pull-up bar.',
    proseAfter:
      'Kept the 21 thrusters unbroken and broke the 15s into 9+6 only once. Breathing recovered noticeably faster in round 3.',
    wodBlockTag: 'time',
    wodScript: `(21-15-9)\n  Thruster 95 lb\n  Pull-up`,
    initialSplits: [
      {
        id: 'fran-r1-thruster',
        round: 1,
        splitIndex: 1,
        effortSlug: 'thruster',
        movement: 'Thruster',
        targetReps: 21,
        actualReps: 21,
        targetLoadLbs: 95,
        actualLoadLbs: 95,
        targetDurationSec: 48,
        actualDurationSec: 46,
        targetDistanceM: null,
        actualDistanceM: null,
        reference1RmLbs: 185,
      },
      {
        id: 'fran-r1-pullup',
        round: 1,
        splitIndex: 2,
        effortSlug: 'pull-up',
        movement: 'Pull-up',
        targetReps: 21,
        actualReps: 21,
        targetLoadLbs: null,
        actualLoadLbs: null,
        targetDurationSec: 36,
        actualDurationSec: 34,
        targetDistanceM: null,
        actualDistanceM: null,
      },
      {
        id: 'fran-r2-thruster',
        round: 2,
        splitIndex: 3,
        effortSlug: 'thruster',
        movement: 'Thruster',
        targetReps: 15,
        actualReps: 15,
        targetLoadLbs: 95,
        actualLoadLbs: 95,
        targetDurationSec: 52,
        actualDurationSec: 51,
        targetDistanceM: null,
        actualDistanceM: null,
        reference1RmLbs: 185,
      },
      {
        id: 'fran-r2-pullup',
        round: 2,
        splitIndex: 4,
        effortSlug: 'pull-up',
        movement: 'Pull-up',
        targetReps: 15,
        actualReps: 15,
        targetLoadLbs: null,
        actualLoadLbs: null,
        targetDurationSec: 46,
        actualDurationSec: 45,
        targetDistanceM: null,
        actualDistanceM: null,
      },
      {
        id: 'fran-r3-thruster',
        round: 3,
        splitIndex: 5,
        effortSlug: 'thruster',
        movement: 'Thruster',
        targetReps: 9,
        actualReps: 9,
        targetLoadLbs: 95,
        actualLoadLbs: 105,
        targetDurationSec: 54,
        actualDurationSec: 56,
        targetDistanceM: null,
        actualDistanceM: null,
        reference1RmLbs: 185,
      },
      {
        id: 'fran-r3-pullup',
        round: 3,
        splitIndex: 6,
        effortSlug: 'pull-up',
        movement: 'Pull-up',
        targetReps: 9,
        actualReps: 9,
        targetLoadLbs: null,
        actualLoadLbs: null,
        targetDurationSec: 46,
        actualDurationSec: 44,
        targetDistanceM: null,
        actualDistanceM: null,
      },
    ],
    priorRuns: [
      {
        resultId: '01a09d45-885a-738d-ab1e-be31d44fe901',
        attemptLabel: 'Run #1',
        dateLabel: 'Sep 14',
        dateIso: '2026-09-14',
        rpe: 9,
        elapsedSec: 318,
        totalVolumeLbs: 4275,
        totalReps: 90,
        totalDistanceM: null,
        tis: 30.2,
        sessionLoadAu: 51,
        maxE1rmLbs: 161.5,
        splitDurationsSec: [52, 41, 58, 52, 62, 53],
        splitVolumesLbs: [1995, 0, 1425, 0, 855, 0],
      },
      {
        resultId: '01a16210-12a4-7129-99bc-120188c4b112',
        attemptLabel: 'Run #2',
        dateLabel: 'Oct 18',
        dateIso: '2026-10-18',
        rpe: 8,
        elapsedSec: 290,
        totalVolumeLbs: 4275,
        totalReps: 90,
        totalDistanceM: null,
        tis: 31.8,
        sessionLoadAu: 53,
        maxE1rmLbs: 161.5,
        splitDurationsSec: [48, 37, 54, 48, 55, 48],
        splitVolumesLbs: [1995, 0, 1425, 0, 855, 0],
      },
    ],
    rawFrames: [
      {
        id: 'raw-1',
        offsetSec: 0,
        outputType: 'system',
        sourceBlockKey: 'waiting-to-start:0',
        summary: 'Waiting to start · Armed',
        payloadPreview: 'origin: runtime · waiting-to-start:0',
      },
      {
        id: 'raw-2',
        offsetSec: 0,
        outputType: 'system',
        sourceBlockKey: 'session-root:fran-21-15-9',
        summary: 'Session root initialized',
        payloadPreview: 'blockId: fran-21-15-9 · rounds: 3',
      },
      {
        id: 'raw-3',
        offsetSec: 276,
        outputType: 'analytics',
        sourceBlockKey: 'calc.metMinutes',
        summary: 'Derived summary · calc.metMinutes',
        payloadPreview: 'total: 1.049 MET-min · tis: 34.6 pts',
      },
      {
        id: 'raw-4',
        offsetSec: 276,
        outputType: 'analytics',
        sourceBlockKey: 'calc.sessionLoad',
        summary: 'Derived summary · calc.sessionLoad',
        payloadPreview: 'sessionLoad: 56 AU · totalVolume: 4,365 lb',
      },
    ],
  },

  'track-4x1000': {
    id: 'track-4x1000',
    title: '4×1000m Threshold Intervals',
    shortLabel: '4×1000m (Endurance)',
    domain: 'endurance',
    resultId: '01a1f604-391a-7c4b-9e11-4ab920e178cc',
    blockContentId: 'track-4x1000m',
    noteId: 'note-2026-11-18-track',
    noteTitle: 'Tuesday Track — 4×1000m @ Threshold',
    dateLabel: 'Nov 18, 2026',
    dateIso: '2026-11-18',
    notebookSlug: 'marathon-prep',
    notebookTitle: 'Polarized Base',
    attemptLabel: 'Run #3',
    hasSegments: true,
    defaultRpe: 7,
    proseBefore:
      'Target 3:58/km across all four 1k repeats with 90s jog recovery. Keep HR capped around 172 bpm until the final rep.',
    proseAfter:
      'Negative-split the final interval down to 3:53 with calm mechanics and zero late-rep fade.',
    wodBlockTag: 'time',
    wodScript: `4 rounds\n  Run 1000m\n  Rest 90s`,
    initialSplits: [
      {
        id: 'track-r1',
        round: 1,
        splitIndex: 1,
        effortSlug: 'run',
        movement: 'Run 1000m',
        targetReps: null,
        actualReps: null,
        targetLoadLbs: null,
        actualLoadLbs: null,
        targetDurationSec: 238,
        actualDurationSec: 238,
        targetDistanceM: 1000,
        actualDistanceM: 1000,
        hrBpm: 164,
      },
      {
        id: 'track-r2',
        round: 2,
        splitIndex: 2,
        effortSlug: 'run',
        movement: 'Run 1000m',
        targetReps: null,
        actualReps: null,
        targetLoadLbs: null,
        actualLoadLbs: null,
        targetDurationSec: 238,
        actualDurationSec: 235,
        targetDistanceM: 1000,
        actualDistanceM: 1000,
        hrBpm: 168,
      },
      {
        id: 'track-r3',
        round: 3,
        splitIndex: 3,
        effortSlug: 'run',
        movement: 'Run 1000m',
        targetReps: null,
        actualReps: null,
        targetLoadLbs: null,
        actualLoadLbs: null,
        targetDurationSec: 238,
        actualDurationSec: 236,
        targetDistanceM: 1000,
        actualDistanceM: 1000,
        hrBpm: 171,
      },
      {
        id: 'track-r4',
        round: 4,
        splitIndex: 4,
        effortSlug: 'run',
        movement: 'Run 1000m',
        targetReps: null,
        actualReps: null,
        targetLoadLbs: null,
        actualLoadLbs: null,
        targetDurationSec: 238,
        actualDurationSec: 233,
        targetDistanceM: 1000,
        actualDistanceM: 1000,
        hrBpm: 174,
      },
    ],
    priorRuns: [
      {
        resultId: '01a08411-391a-7c4b-9e11-4ab920e17801',
        attemptLabel: 'Run #1',
        dateLabel: 'Oct 15',
        dateIso: '2026-10-15',
        rpe: 8,
        elapsedSec: 968,
        totalVolumeLbs: null,
        totalReps: 0,
        totalDistanceM: 4000,
        tis: 52.4,
        sessionLoadAu: 74,
        maxE1rmLbs: null,
        splitDurationsSec: [243, 242, 243, 240],
        splitVolumesLbs: [0, 0, 0, 0],
      },
      {
        resultId: '01a11920-391a-7c4b-9e11-4ab920e17802',
        attemptLabel: 'Run #2',
        dateLabel: 'Nov 02',
        dateIso: '2026-11-02',
        rpe: 7,
        elapsedSec: 954,
        totalVolumeLbs: null,
        totalReps: 0,
        totalDistanceM: 4000,
        tis: 54.0,
        sessionLoadAu: 76,
        maxE1rmLbs: null,
        splitDurationsSec: [240, 239, 238, 237],
        splitVolumesLbs: [0, 0, 0, 0],
      },
    ],
    rawFrames: [
      {
        id: 'track-raw-1',
        offsetSec: 0,
        outputType: 'system',
        sourceBlockKey: 'waiting-to-start:0',
        summary: 'Waiting to start · Armed',
        payloadPreview: 'origin: runtime · gps: track',
      },
      {
        id: 'track-raw-2',
        offsetSec: 942,
        outputType: 'analytics',
        sourceBlockKey: 'calc.pace',
        summary: 'Derived summary · avgPace',
        payloadPreview: 'avgPace: 3:56 /km · distance: 4,000 m',
      },
    ],
  },

  'manual-strength-log': {
    id: 'manual-strength-log',
    title: 'Back Squat 5×3 — Heavy Working Sets',
    shortLabel: 'Back Squat (Manual Log)',
    domain: 'strength',
    resultId: 'sample-strength-5x3-result',
    blockContentId: 'back-squat-5x3',
    noteId: 'note-2026-11-17-squat',
    noteTitle: 'Heavy Lower — Back Squat 5×3',
    dateLabel: 'Nov 17, 2026',
    dateIso: '2026-11-17',
    notebookSlug: 'strength-cycle',
    notebookTitle: 'Strength Cycle',
    attemptLabel: 'Week 4 · Day 1',
    hasSegments: false,
    defaultRpe: 8,
    proseBefore:
      'Logged directly without live timer splits (sample/manual log entry). Demonstrates graceful summary + editable set grid when raw segment events are absent.',
    proseAfter:
      'Final triple at 295 lb moved smoothly out of the hole. Ready to bump working weight to 300 lb next cycle.',
    wodBlockTag: 'log',
    wodScript: `5 sets\n  3 Back Squat 285-295 lb`,
    initialSplits: [
      {
        id: 'sq-s1',
        round: 1,
        splitIndex: 1,
        effortSlug: 'back-squat',
        movement: 'Back Squat',
        targetReps: 3,
        actualReps: 3,
        targetLoadLbs: 285,
        actualLoadLbs: 285,
        targetDurationSec: 180,
        actualDurationSec: 175,
        targetDistanceM: null,
        actualDistanceM: null,
        reference1RmLbs: 325,
      },
      {
        id: 'sq-s2',
        round: 2,
        splitIndex: 2,
        effortSlug: 'back-squat',
        movement: 'Back Squat',
        targetReps: 3,
        actualReps: 3,
        targetLoadLbs: 285,
        actualLoadLbs: 285,
        targetDurationSec: 180,
        actualDurationSec: 182,
        targetDistanceM: null,
        actualDistanceM: null,
        reference1RmLbs: 325,
      },
      {
        id: 'sq-s3',
        round: 3,
        splitIndex: 3,
        effortSlug: 'back-squat',
        movement: 'Back Squat',
        targetReps: 3,
        actualReps: 3,
        targetLoadLbs: 290,
        actualLoadLbs: 290,
        targetDurationSec: 180,
        actualDurationSec: 188,
        targetDistanceM: null,
        actualDistanceM: null,
        reference1RmLbs: 325,
      },
      {
        id: 'sq-s4',
        round: 4,
        splitIndex: 4,
        effortSlug: 'back-squat',
        movement: 'Back Squat',
        targetReps: 3,
        actualReps: 3,
        targetLoadLbs: 290,
        actualLoadLbs: 295,
        targetDurationSec: 180,
        actualDurationSec: 194,
        targetDistanceM: null,
        actualDistanceM: null,
        reference1RmLbs: 325,
      },
      {
        id: 'sq-s5',
        round: 5,
        splitIndex: 5,
        effortSlug: 'back-squat',
        movement: 'Back Squat',
        targetReps: 3,
        actualReps: 3,
        targetLoadLbs: 295,
        actualLoadLbs: 295,
        targetDurationSec: 180,
        actualDurationSec: 196,
        targetDistanceM: null,
        actualDistanceM: null,
        reference1RmLbs: 325,
      },
    ],
    priorRuns: [
      {
        resultId: 'sample-strength-5x3-w2',
        attemptLabel: 'Week 2',
        dateLabel: 'Nov 03',
        dateIso: '2026-11-03',
        rpe: 8,
        elapsedSec: 910,
        totalVolumeLbs: 4125,
        totalReps: 15,
        totalDistanceM: null,
        tis: 34.0,
        sessionLoadAu: 58,
        maxE1rmLbs: 313.5,
        splitDurationsSec: [170, 175, 182, 188, 195],
        splitVolumesLbs: [825, 825, 825, 825, 825],
      },
      {
        resultId: 'sample-strength-5x3-w3',
        attemptLabel: 'Week 3',
        dateLabel: 'Nov 10',
        dateIso: '2026-11-10',
        rpe: 8,
        elapsedSec: 925,
        totalVolumeLbs: 4230,
        totalReps: 15,
        totalDistanceM: null,
        tis: 35.6,
        sessionLoadAu: 61,
        maxE1rmLbs: 319.0,
        splitDurationsSec: [175, 180, 185, 190, 195],
        splitVolumesLbs: [840, 840, 840, 855, 855],
      },
    ],
    rawFrames: [
      {
        id: 'sq-raw-1',
        offsetSec: 0,
        outputType: 'analytics',
        sourceBlockKey: 'manual-log:summary',
        summary: 'Summary-only record (no runtime segment events)',
        payloadPreview: 'origin: user · totalVolume: 4,350 lb · calc.e1rm: 324.5 lb',
      },
    ],
  },
};

export function formatDurationMMSS(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec)) return '—';
  const clamped = Math.max(0, Math.round(totalSec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSignedDeltaSec(deltaSec: number | null | undefined): string {
  if (deltaSec == null || !Number.isFinite(deltaSec) || deltaSec === 0) return '0:00';
  const sign = deltaSec < 0 ? '-' : '+';
  return `${sign}${formatDurationMMSS(Math.abs(deltaSec))}`;
}

export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '—';
  return `${formatDurationMMSS(secPerKm)}/km`;
}

export function computeSplitDerived(
  splits: readonly ProtoSplitRow[],
): ProtoSplitDerived[] {
  let runningOffset = 0;
  return splits.map((row) => {
    const reps = row.actualReps ?? row.targetReps ?? 0;
    const load = row.actualLoadLbs ?? row.targetLoadLbs ?? 0;
    const dur = row.actualDurationSec ?? row.targetDurationSec ?? 0;
    const dist = row.actualDistanceM ?? row.targetDistanceM ?? 0;

    const volumeLbs = reps > 0 && load > 0 ? Math.round(reps * load) : null;
    const e1rmLbs =
      reps > 0 && load > 0 ? Math.round(load * (1 + reps / 30) * 10) / 10 : null;
    const pct1rm =
      e1rmLbs != null && row.reference1RmLbs
        ? Math.round((load / row.reference1RmLbs) * 100)
        : null;
    const powerLbsPerSec =
      volumeLbs != null && dur > 0 ? Math.round((volumeLbs / dur) * 10) / 10 : null;
    const paceSecPerKm =
      dist > 0 && dur > 0 ? Math.round((dur / (dist / 1000)) * 10) / 10 : null;

    const isModified =
      (row.actualReps != null && row.actualReps !== row.targetReps) ||
      (row.actualLoadLbs != null && row.actualLoadLbs !== row.targetLoadLbs) ||
      (row.actualDurationSec != null && row.actualDurationSec !== row.targetDurationSec) ||
      (row.actualDistanceM != null && row.actualDistanceM !== row.targetDistanceM);

    const out: ProtoSplitDerived = {
      ...row,
      elapsedOffsetSec: runningOffset,
      volumeLbs,
      e1rmLbs,
      pct1rm,
      powerLbsPerSec,
      paceSecPerKm,
      isModified,
    };
    runningOffset += dur;
    return out;
  });
}

export function computeSessionSummary(
  fixture: ProtoWorkoutFixture,
  splits: readonly ProtoSplitRow[],
  rpe: number | null,
): ProtoSummaryMetrics {
  const derived = computeSplitDerived(splits);
  let elapsedSec = 0;
  let totalVolumeLbs = 0;
  let hasVolume = false;
  let totalReps = 0;
  let totalDistanceM = 0;
  let hasDistance = false;
  let maxE1rmLbs: number | null = null;
  let modifiedCount = 0;

  const byMovement = new Map<
    string,
    {
      effortSlug: string;
      movement: string;
      sets: number;
      totalReps: number;
      loadSum: number;
      loadCount: number;
      totalVolumeLbs: number;
      hasVolume: boolean;
      totalDurationSec: number;
      totalDistanceM: number;
      hasDistance: boolean;
      bestE1rmLbs: number | null;
    }
  >();

  for (const row of derived) {
    const dur = row.actualDurationSec ?? row.targetDurationSec ?? 0;
    const reps = row.actualReps ?? row.targetReps ?? 0;
    const load = row.actualLoadLbs ?? row.targetLoadLbs;
    const dist = row.actualDistanceM ?? row.targetDistanceM;

    elapsedSec += dur;
    totalReps += reps;
    if (row.volumeLbs != null) {
      totalVolumeLbs += row.volumeLbs;
      hasVolume = true;
    }
    if (dist != null && dist > 0) {
      totalDistanceM += dist;
      hasDistance = true;
    }
    if (row.e1rmLbs != null && (maxE1rmLbs == null || row.e1rmLbs > maxE1rmLbs)) {
      maxE1rmLbs = row.e1rmLbs;
    }
    if (row.isModified) modifiedCount += 1;

    const existing = byMovement.get(row.effortSlug) ?? {
      effortSlug: row.effortSlug,
      movement: row.movement,
      sets: 0,
      totalReps: 0,
      loadSum: 0,
      loadCount: 0,
      totalVolumeLbs: 0,
      hasVolume: false,
      totalDurationSec: 0,
      totalDistanceM: 0,
      hasDistance: false,
      bestE1rmLbs: null,
    };
    existing.sets += 1;
    existing.totalReps += reps;
    if (load != null && load > 0) {
      existing.loadSum += load;
      existing.loadCount += 1;
    }
    if (row.volumeLbs != null) {
      existing.totalVolumeLbs += row.volumeLbs;
      existing.hasVolume = true;
    }
    existing.totalDurationSec += dur;
    if (dist != null && dist > 0) {
      existing.totalDistanceM += dist;
      existing.hasDistance = true;
    }
    if (
      row.e1rmLbs != null &&
      (existing.bestE1rmLbs == null || row.e1rmLbs > existing.bestE1rmLbs)
    ) {
      existing.bestE1rmLbs = row.e1rmLbs;
    }
    byMovement.set(row.effortSlug, existing);
  }

  const lastPrior = fixture.priorRuns[fixture.priorRuns.length - 1];
  const priorDeltaSec = lastPrior ? elapsedSec - lastPrior.elapsedSec : null;

  const baseTis =
    fixture.domain === 'endurance'
      ? Math.round((elapsedSec / 60) * 3.6 * 10) / 10
      : Math.round(((elapsedSec / 60) * 4.1 + totalVolumeLbs / 280) * 10) / 10;
  const rpeMultiplier = rpe != null ? 0.8 + rpe * 0.05 : 1.0;
  const tis = Math.round(baseTis * rpeMultiplier * 10) / 10;
  const sessionLoadAu = Math.round((elapsedSec / 60) * (rpe ?? 7) * 1.45);

  const avgPaceSecPerKm =
    hasDistance && totalDistanceM > 0
      ? Math.round((elapsedSec / (totalDistanceM / 1000)) * 10) / 10
      : null;

  const prBadges: string[] = [];
  if (priorDeltaSec != null && priorDeltaSec < 0) {
    prBadges.push(`${formatSignedDeltaSec(priorDeltaSec)} PR`);
  }
  const bestPriorE1rm = fixture.priorRuns.reduce<number | null>(
    (acc, r) => (r.maxE1rmLbs != null && (acc == null || r.maxE1rmLbs > acc) ? r.maxE1rmLbs : acc),
    null,
  );
  if (maxE1rmLbs != null && bestPriorE1rm != null && maxE1rmLbs > bestPriorE1rm) {
    const diff = Math.round((maxE1rmLbs - bestPriorE1rm) * 10) / 10;
    prBadges.push(`+${diff} lb e1RM`);
  }

  const movementRollup: ProtoMovementRollup[] = Array.from(byMovement.values()).map((m) => {
    const hasE1rmPr =
      m.bestE1rmLbs != null && bestPriorE1rm != null && m.bestE1rmLbs > bestPriorE1rm;
    return {
      effortSlug: m.effortSlug,
      movement: m.movement,
      sets: m.sets,
      totalReps: m.totalReps,
      avgLoadLbs: m.loadCount > 0 ? Math.round((m.loadSum / m.loadCount) * 10) / 10 : null,
      totalVolumeLbs: m.hasVolume ? m.totalVolumeLbs : null,
      totalDurationSec: m.totalDurationSec,
      totalDistanceM: m.hasDistance ? m.totalDistanceM : null,
      bestE1rmLbs: m.bestE1rmLbs,
      avgPaceSecPerKm:
        m.hasDistance && m.totalDistanceM > 0
          ? Math.round((m.totalDurationSec / (m.totalDistanceM / 1000)) * 10) / 10
          : null,
      hasPr: hasE1rmPr || (priorDeltaSec != null && priorDeltaSec < 0 && byMovement.size === 1),
      prDetail: hasE1rmPr && bestPriorE1rm != null
        ? `+${Math.round((m.bestE1rmLbs! - bestPriorE1rm) * 10) / 10} lb e1RM`
        : undefined,
    };
  });

  return {
    elapsedSec,
    priorDeltaSec,
    totalVolumeLbs: hasVolume ? totalVolumeLbs : null,
    totalReps,
    totalDistanceM: hasDistance ? totalDistanceM : null,
    avgPaceSecPerKm,
    maxE1rmLbs,
    tis,
    sessionLoadAu,
    prBadges,
    movementRollup,
    splitCount: derived.length,
    modifiedCount,
  };
}

export function generateExplicitSummaryFence(resultId: string): string {
  return `\`\`\`query\nview: summary\nquery: :session{result:${resultId}}\n\`\`\``;
}

export function generateLegacyTableFence(resultId: string): string {
  return `\`\`\`query\n:session{result:${resultId}}\n\`\`\``;
}

export function defaultComparisonConfigForFixture(
  fixture: ProtoWorkoutFixture,
): ProtoComparisonConfig {
  return {
    title:
      fixture.domain === 'endurance'
        ? `${fixture.shortLabel.split(' ')[0]} Split Pace vs Prior Runs`
        : `${fixture.shortLabel.split(' ')[0]} Splits vs Prior Runs`,
    question: `How did this workout stack up against prior runs and ${fixture.notebookTitle}?`,
    measure:
      fixture.domain === 'endurance'
        ? 'pace'
        : fixture.domain === 'strength'
          ? 'e1rm'
          : 'splitTime',
    effortFilter: 'all',
    scopes: ['current', 'priorRuns'],
    otherWorkoutId: OTHER_WORKOUTS[0].blockContentId,
    otherNotebookSlug:
      fixture.notebookSlug === 'benchmarks' ? 'strength-cycle' : 'benchmarks',
    bindingMode: 'tokens',
    vizType: 'line',
    goalValue: fixture.domain === 'endurance' ? 235 : 48,
  };
}

export function measureUnit(measure: ProtoMeasureId): string {
  switch (measure) {
    case 'splitTime':
      return 's';
    case 'volume':
      return 'lb';
    case 'e1rm':
      return 'lb';
    case 'reps':
      return 'reps';
    case 'tis':
      return 'pts';
    case 'pace':
      return 's/km';
  }
}

export function measureLabel(measure: ProtoMeasureId): string {
  switch (measure) {
    case 'splitTime':
      return 'Split Duration';
    case 'volume':
      return 'Total Volume';
    case 'e1rm':
      return 'Estimated 1RM';
    case 'reps':
      return 'Reps';
    case 'tis':
      return 'TIS Score';
    case 'pace':
      return 'Pace';
  }
}

function wqlMetricForMeasure(measure: ProtoMeasureId): { agg: string; metric: string } {
  switch (measure) {
    case 'splitTime':
      return { agg: 'avg', metric: 'elapsed' };
    case 'volume':
      return { agg: 'sum', metric: 'totalVolume' };
    case 'e1rm':
      return { agg: 'max', metric: 'calc.e1rm' };
    case 'reps':
      return { agg: 'sum', metric: 'reps' };
    case 'tis':
      return { agg: 'avg', metric: 'tis' };
    case 'pace':
      return { agg: 'avg', metric: 'pace' };
  }
}

export function generateWidgetYamlAndWql(
  fixture: ProtoWorkoutFixture,
  config: ProtoComparisonConfig,
): { yaml: string; documentWql: string; axisLabel: string } {
  const { agg, metric } = wqlMetricForMeasure(config.measure);
  const effortClause =
    config.effortFilter !== 'all' ? `, effort:${config.effortFilter}` : '';
  const useTokens = config.bindingMode === 'tokens';
  const blockRef = useTokens ? '$block' : fixture.blockContentId;
  const notebookRef = useTokens ? '$notebook' : fixture.notebookSlug;

  const isNotebookCompare =
    config.scopes.includes('currentNotebook') || config.scopes.includes('otherNotebook');
  const alignDim = isNotebookCompare ? 'week' : 'split';
  const axisLabel = isNotebookCompare
    ? 'Aligned by Week (6w rolling)'
    : 'Aligned by Split (S1–S' + fixture.initialSplits.length + ')';

  if (config.vizType === 'summary') {
    const query = `:session{result:${useTokens ? '$result' : fixture.resultId}}`;
    const yaml = [
      '```query',
      `title: ${config.title}`,
      `description: ${config.question}`,
      'view: summary',
      `query: ${query}`,
      '```',
    ].join('\n');
    return { yaml, documentWql: query, axisLabel: 'Session summary projection' };
  }

  if (config.vizType === 'table') {
    const query = `:segment{${
      config.scopes.includes('priorRuns')
        ? `block:${blockRef}`
        : `result:${useTokens ? '$result' : fixture.resultId}`
    }${effortClause}} | select round, effort, reps, resistance, elapsed, totalVolume, calc.e1rm`;
    const yaml = [
      '```query',
      `title: ${config.title}`,
      `description: ${config.question}`,
      'view: table',
      `query: ${query}`,
      'columns: [round, effort, reps, loads, elapsed, calc.e1rm]',
      '```',
    ].join('\n');
    return { yaml, documentWql: query, axisLabel: 'Spreadsheet projection' };
  }

  const lines: string[] = [];
  const showIds: string[] = [];

  if (config.scopes.includes('current') || config.scopes.length === 0) {
    const q = `${agg}:${metric}{result:${useTokens ? '$result' : fixture.resultId}${effortClause}} by {${alignDim}}`;
    lines.push(`current = ${q}`);
    showIds.push('current');
  }
  if (config.scopes.includes('priorRuns')) {
    const q = `${agg}:${metric}{block:${blockRef}, !result:${fixture.resultId}${effortClause}} by {${alignDim}}`;
    lines.push(`prior = ${q}`);
    showIds.push('prior');
  }
  if (config.scopes.includes('otherWorkout')) {
    const other = OTHER_WORKOUTS.find((w) => w.blockContentId === config.otherWorkoutId) ?? OTHER_WORKOUTS[0];
    const q = `${agg}:${metric}{block:${other.blockContentId}${effortClause}} by {${alignDim}}`;
    lines.push(`comparison = ${q}`);
    showIds.push('comparison');
  }
  if (config.scopes.includes('currentNotebook')) {
    const q = `${agg}:${metric}{notebook:${notebookRef}${effortClause}} by {week} last 6w`;
    lines.push(`notebook_a = ${q}`);
    showIds.push('notebook_a');
  }
  if (config.scopes.includes('otherNotebook')) {
    const q = `${agg}:${metric}{notebook:${config.otherNotebookSlug}${effortClause}} by {week} last 6w`;
    lines.push(`notebook_b = ${q}`);
    showIds.push('notebook_b');
  }
  if (config.scopes.includes('baseline4w')) {
    const q = `${agg}:${metric}{block:${blockRef}${effortClause}} by {${alignDim}} .rollup(4w)`;
    lines.push(`baseline_4w = ${q}`);
    showIds.push('baseline_4w');
  }
  if (config.scopes.includes('goalTarget')) {
    const anchor = showIds[0] ?? 'current';
    lines.push(`goal = ${anchor} * 0 + ${config.goalValue}`);
    showIds.push('goal');
  }

  const wqlView =
    config.vizType === 'line'
      ? 'timeseries'
      : config.vizType === 'bar'
        ? 'bar'
        : 'value';

  const documentWql =
    lines.length === 1 && !lines[0].includes(' * 0 + ')
      ? lines[0].replace(/^\w+\s*=\s*/, '')
      : `${lines.join('\n')}\nshow ${showIds.join(', ')}`;

  const yamlLines = [
    '```query',
    `title: ${config.title}`,
    `description: ${config.question}`,
    `view: ${wqlView}`,
  ];
  if (lines.length === 1) {
    yamlLines.push(`query: ${documentWql}`);
  } else {
    yamlLines.push('series:');
    for (const line of lines) {
      const [id, expr] = line.split(/\s*=\s*/, 2);
      if (id === 'goal') {
        yamlLines.push(`  - id: ${id}`);
        yamlLines.push(`    formula: ${expr}`);
      } else {
        yamlLines.push(`  - id: ${id}`);
        yamlLines.push(`    query: ${expr}`);
      }
    }
  }
  yamlLines.push('```');
  return {
    yaml: yamlLines.join('\n'),
    documentWql,
    axisLabel,
  };
}

export function buildComparisonChartSeries(
  fixture: ProtoWorkoutFixture,
  splits: readonly ProtoSplitRow[],
  summary: ProtoSummaryMetrics,
  config: ProtoComparisonConfig,
): {
  mode: 'split' | 'week';
  unit: string;
  seriesDefs: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
} {
  const derived = computeSplitDerived(splits);
  const filteredDerived =
    config.effortFilter === 'all'
      ? derived
      : derived.filter((s) => s.effortSlug === config.effortFilter);
  const activeSplits = filteredDerived.length > 0 ? filteredDerived : derived;
  const unit = measureUnit(config.measure);

  const isNotebookMode =
    config.scopes.includes('currentNotebook') || config.scopes.includes('otherNotebook');

  if (isNotebookMode) {
    const nbCurrent =
      NOTEBOOK_BENCHMARKS.find((n) => n.slug === fixture.notebookSlug) ??
      NOTEBOOK_BENCHMARKS[0];
    const nbOther =
      NOTEBOOK_BENCHMARKS.find((n) => n.slug === config.otherNotebookSlug) ??
      NOTEBOOK_BENCHMARKS[1];

    const seriesDefs: Array<{ key: string; label: string }> = [];
    if (config.scopes.includes('current')) {
      seriesDefs.push({ key: 'current', label: `${fixture.shortLabel.split(' ')[0]} (This Run)` });
    }
    if (config.scopes.includes('currentNotebook')) {
      seriesDefs.push({ key: 'notebook_a', label: nbCurrent.title });
    }
    if (config.scopes.includes('otherNotebook')) {
      seriesDefs.push({ key: 'notebook_b', label: nbOther.title });
    }
    if (config.scopes.includes('goalTarget')) {
      seriesDefs.push({ key: 'goal', label: 'Target' });
    }
    if (seriesDefs.length === 0) {
      seriesDefs.push({ key: 'notebook_a', label: nbCurrent.title });
    }

    const metricFromNb = (nb: ProtoNotebookBenchmark, wkIdx: number): number => {
      switch (config.measure) {
        case 'tis':
          return nb.weeklyTis[wkIdx] ?? nb.avgSessionTis;
        case 'volume':
          return nb.weeklyVolumeLbs[wkIdx] ?? nb.avgSessionVolumeLbs;
        case 'e1rm':
          return Math.round(145 + wkIdx * 4 + (nb.slug === 'strength-cycle' ? 140 : 0));
        case 'reps':
          return Math.round((nb.weeklyVolumeLbs[wkIdx] ?? 4000) / 85);
        case 'pace':
          return nb.slug === 'marathon-prep' ? 245 - wkIdx * 2 : 285 - wkIdx * 2;
        case 'splitTime':
          return Math.round(52 - wkIdx * 1.2 + (nb.slug === 'strength-cycle' ? 18 : 0));
      }
    };

    const currentVal = (): number => {
      switch (config.measure) {
        case 'tis':
          return summary.tis;
        case 'volume':
          return summary.totalVolumeLbs ?? 0;
        case 'e1rm':
          return summary.maxE1rmLbs ?? 150;
        case 'reps':
          return summary.totalReps;
        case 'pace':
          return summary.avgPaceSecPerKm ?? 240;
        case 'splitTime':
          return activeSplits.length > 0
            ? Math.round(summary.elapsedSec / activeSplits.length)
            : 48;
      }
    };

    const rows = WEEK_LABELS.map((wk, idx) => {
      const point: Record<string, string | number | null> = { xLabel: wk };
      if (seriesDefs.some((s) => s.key === 'current')) {
        point.current = idx === WEEK_LABELS.length - 1 ? currentVal() : null;
      }
      if (seriesDefs.some((s) => s.key === 'notebook_a')) {
        point.notebook_a = metricFromNb(nbCurrent, idx);
      }
      if (seriesDefs.some((s) => s.key === 'notebook_b')) {
        point.notebook_b = metricFromNb(nbOther, idx);
      }
      if (seriesDefs.some((s) => s.key === 'goal')) {
        point.goal = config.goalValue;
      }
      return point;
    });

    return { mode: 'week', unit, seriesDefs, rows };
  }

  const seriesDefs: Array<{ key: string; label: string }> = [];
  if (config.scopes.includes('current') || config.scopes.length === 0) {
    seriesDefs.push({ key: 'current', label: `${fixture.attemptLabel} (Current)` });
  }
  if (config.scopes.includes('priorRuns')) {
    const latestPrior = fixture.priorRuns[fixture.priorRuns.length - 1];
    seriesDefs.push({
      key: 'prior',
      label: latestPrior ? `${latestPrior.attemptLabel} (${latestPrior.dateLabel})` : 'Prior Run',
    });
  }
  if (config.scopes.includes('otherWorkout')) {
    const other =
      OTHER_WORKOUTS.find((w) => w.blockContentId === config.otherWorkoutId) ?? OTHER_WORKOUTS[0];
    seriesDefs.push({ key: 'comparison', label: other.title.split(' (')[0] });
  }
  if (config.scopes.includes('baseline4w')) {
    seriesDefs.push({ key: 'baseline_4w', label: '4w Avg' });
  }
  if (config.scopes.includes('goalTarget')) {
    seriesDefs.push({ key: 'goal', label: 'Goal' });
  }

  const latestPrior = fixture.priorRuns[fixture.priorRuns.length - 1];
  const otherWorkout =
    OTHER_WORKOUTS.find((w) => w.blockContentId === config.otherWorkoutId) ?? OTHER_WORKOUTS[0];

  const rows = activeSplits.map((split, i) => {
    const originalIdx = Math.max(0, split.splitIndex - 1);
    const point: Record<string, string | number | null> = {
      xLabel: `S${split.splitIndex} · ${split.movement.split(' ')[0]}`,
    };

    const currentMetric = (): number => {
      switch (config.measure) {
        case 'splitTime':
          return split.actualDurationSec ?? split.targetDurationSec ?? 0;
        case 'volume':
          return split.volumeLbs ?? 0;
        case 'e1rm':
          return split.e1rmLbs ?? 0;
        case 'reps':
          return split.actualReps ?? split.targetReps ?? 0;
        case 'tis':
          return Math.round((summary.tis / Math.max(1, activeSplits.length)) * 10) / 10;
        case 'pace':
          return split.paceSecPerKm ?? split.actualDurationSec ?? 0;
      }
    };

    const priorMetric = (): number => {
      if (!latestPrior) return 0;
      switch (config.measure) {
        case 'splitTime':
          return latestPrior.splitDurationsSec[originalIdx] ?? latestPrior.splitDurationsSec[i] ?? 50;
        case 'volume':
          return latestPrior.splitVolumesLbs[originalIdx] ?? 0;
        case 'e1rm':
          return latestPrior.maxE1rmLbs ?? 150;
        case 'reps':
          return split.targetReps ?? 15;
        case 'tis':
          return Math.round((latestPrior.tis / Math.max(1, activeSplits.length)) * 10) / 10;
        case 'pace':
          return latestPrior.splitDurationsSec[originalIdx] ?? 240;
      }
    };

    const otherMetric = (): number => {
      switch (config.measure) {
        case 'splitTime':
          return otherWorkout.splitDurationsSec[i % otherWorkout.splitDurationsSec.length] ?? 40;
        case 'volume':
          return otherWorkout.splitVolumesLbs[i % otherWorkout.splitVolumesLbs.length] ?? 650;
        case 'e1rm':
          return 185;
        case 'reps':
          return 10;
        case 'tis':
          return Math.round((otherWorkout.tis / Math.max(1, otherWorkout.splitCount)) * 10) / 10;
        case 'pace':
          return otherWorkout.splitDurationsSec[i % otherWorkout.splitDurationsSec.length] ?? 240;
      }
    };

    if (seriesDefs.some((s) => s.key === 'current')) point.current = currentMetric();
    if (seriesDefs.some((s) => s.key === 'prior')) point.prior = priorMetric();
    if (seriesDefs.some((s) => s.key === 'comparison')) point.comparison = otherMetric();
    if (seriesDefs.some((s) => s.key === 'baseline_4w')) {
      const avg =
        fixture.priorRuns.length > 0
          ? fixture.priorRuns.reduce(
              (acc, r) => acc + (r.splitDurationsSec[originalIdx] ?? 50),
              0,
            ) / fixture.priorRuns.length
          : currentMetric();
      point.baseline_4w =
        config.measure === 'splitTime'
          ? Math.round(avg)
          : Math.round(currentMetric() * 0.94);
    }
    if (seriesDefs.some((s) => s.key === 'goal')) point.goal = config.goalValue;
    return point;
  });

  return { mode: 'split', unit, seriesDefs, rows };
}

export function generateWorkoutDashboardScaffold(
  title: string,
  fixture: ProtoWorkoutFixture,
): ProtoDashboard {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `${fixture.id}-dashboard`;
  const primaryEffort = fixture.initialSplits[0]?.effortSlug ?? 'all';
  const otherNb =
    fixture.notebookSlug === 'benchmarks' ? 'strength-cycle' : 'benchmarks';

  return {
    slug,
    title: title.trim() || `${fixture.shortLabel.split(' ')[0]} Progress`,
    editable: true,
    tokens: {
      block: fixture.blockContentId,
      notebook: fixture.notebookSlug,
      effort: primaryEffort,
      range: '4w',
    },
    widgets: [
      {
        id: `${slug}-summary`,
        title: 'Latest Session Summary',
        question: `How did the latest run of ${fixture.shortLabel.split(' ')[0]} perform?`,
        vizType: 'summary',
        spanCols: 4,
        fixtureId: fixture.id,
        config: {
          ...defaultComparisonConfigForFixture(fixture),
          title: 'Latest Session Summary',
          vizType: 'summary',
          scopes: ['current'],
        },
        isNew: true,
      },
      {
        id: `${slug}-splits-overlay`,
        title: 'Split Comparison vs Prior Run',
        question: 'Where did pacing or output improve across rounds?',
        vizType: 'line',
        spanCols: 2,
        fixtureId: fixture.id,
        config: {
          ...defaultComparisonConfigForFixture(fixture),
          title: 'Split Comparison vs Prior Run',
          vizType: 'line',
          scopes: ['current', 'priorRuns', 'baseline4w'],
        },
        isNew: true,
      },
      {
        id: `${slug}-notebook-compare`,
        title: `${fixture.notebookTitle} vs Cross-Notebook Load`,
        question: 'How does TIS trend against other training notebooks?',
        vizType: 'bar',
        spanCols: 2,
        fixtureId: fixture.id,
        config: {
          ...defaultComparisonConfigForFixture(fixture),
          title: `${fixture.notebookTitle} vs Cross-Notebook Load`,
          measure: 'tis',
          vizType: 'bar',
          scopes: ['currentNotebook', 'otherNotebook'],
          otherNotebookSlug: otherNb,
        },
        isNew: true,
      },
      {
        id: `${slug}-spreadsheet`,
        title: 'Session Splits Breakdown',
        question: 'Full per-split reps, loads, and computed e1RM / power',
        vizType: 'table',
        spanCols: 4,
        fixtureId: fixture.id,
        config: {
          ...defaultComparisonConfigForFixture(fixture),
          title: 'Session Splits Breakdown',
          vizType: 'table',
          scopes: ['current'],
        },
        isNew: true,
      },
    ],
  };
}

export function createInitialDashboards(): ProtoDashboard[] {
  const fran = WORKOUT_FIXTURES.fran;
  return [
    {
      slug: 'my-benchmark-progress',
      title: 'My Benchmark Progress',
      editable: true,
      tokens: {
        block: fran.blockContentId,
        notebook: fran.notebookSlug,
        effort: 'thruster',
        range: '4w',
      },
      widgets: [
        {
          id: 'bench-w1',
          title: 'Fran Split Overlay (Run #3 vs Run #2)',
          question: 'Did round 2 and 3 pacing hold up better than October?',
          vizType: 'line',
          spanCols: 2,
          fixtureId: 'fran',
          config: {
            ...defaultComparisonConfigForFixture(fran),
            title: 'Fran Split Overlay (Run #3 vs Run #2)',
            vizType: 'line',
            scopes: ['current', 'priorRuns', 'goalTarget'],
            goalValue: 48,
          },
        },
        {
          id: 'bench-w2',
          title: 'Weekly TIS Across Notebooks',
          question: 'Benchmarks block load compared to Strength Cycle',
          vizType: 'bar',
          spanCols: 2,
          fixtureId: 'fran',
          config: {
            ...defaultComparisonConfigForFixture(fran),
            title: 'Weekly TIS Across Notebooks',
            measure: 'tis',
            vizType: 'bar',
            scopes: ['currentNotebook', 'otherNotebook'],
            otherNotebookSlug: 'strength-cycle',
          },
        },
        {
          id: 'bench-w3',
          title: 'Latest Session Volume',
          question: 'Total tonnage moved in current benchmark run',
          vizType: 'value',
          spanCols: 2,
          fixtureId: 'fran',
          config: {
            ...defaultComparisonConfigForFixture(fran),
            title: 'Latest Session Volume',
            measure: 'volume',
            vizType: 'value',
            scopes: ['current'],
          },
        },
        {
          id: 'bench-w4',
          title: 'Notebook Adherence & Session TIS',
          question: 'Dimension-safe KPIs (never mixing kg onto ratios)',
          vizType: 'value',
          spanCols: 2,
          fixtureId: 'fran',
          config: {
            ...defaultComparisonConfigForFixture(fran),
            title: 'Session TIS Score',
            measure: 'tis',
            vizType: 'value',
            scopes: ['current'],
          },
        },
      ],
    },
    {
      slug: 'benchmark-pr-board',
      title: 'Benchmark PR Board',
      editable: false,
      tokens: {
        block: 'fran-21-15-9',
        notebook: 'benchmarks',
        effort: 'all',
        range: '12w',
      },
      widgets: [
        {
          id: 'prebuilt-w1',
          title: 'Benchmark Splits vs 4w Baseline',
          question: 'Prebuilt board — clone to vault to pin your own workouts',
          vizType: 'line',
          spanCols: 4,
          fixtureId: 'fran',
          config: {
            ...defaultComparisonConfigForFixture(fran),
            title: 'Benchmark Splits vs 4w Baseline',
            vizType: 'line',
            scopes: ['current', 'baseline4w'],
          },
        },
      ],
    },
  ];
}

export function splitsToCsv(
  fixture: ProtoWorkoutFixture,
  splits: readonly ProtoSplitRow[],
): string {
  const derived = computeSplitDerived(splits);
  const headers = [
    'Workout',
    'Date',
    'Round',
    'Split',
    'Movement',
    'Reps',
    'Load_lb',
    'Duration_sec',
    'Distance_m',
    'Volume_lb',
    'e1RM_lb',
    'Power_lb_s',
    'Pace_s_km',
  ];
  const lines = [headers.join(',')];
  for (const row of derived) {
    const cells = [
      `"${fixture.title.replace(/"/g, '""')}"`,
      fixture.dateIso,
      row.round,
      row.splitIndex,
      `"${row.movement}"`,
      row.actualReps ?? '',
      row.actualLoadLbs ?? '',
      row.actualDurationSec ?? '',
      row.actualDistanceM ?? '',
      row.volumeLbs ?? '',
      row.e1rmLbs ?? '',
      row.powerLbsPerSec ?? '',
      row.paceSecPerKm ?? '',
    ];
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}
