/**
 * Shared realistic Entry & Feed fixtures for Playground Library, Stream,
 * Table, Calendar, and Navigation stories.
 *
 * Covers every distinct Entry kind and note catalog flavor so each component
 * renders its real domain badges, icons, metrics, and actions.
 */
import type { Entry } from '@app/lib/entryMapper';
import type { FeedSummary } from '@app/views/notebook-gallery/notebookGalleryModel';
import type { MoveNotebookTarget } from '@app/views/library/LibraryRow';

export const SAMPLE_NOTEBOOK_TARGETS: MoveNotebookTarget[] = [
  { id: 'notebook/journal', name: 'Workout Journal', icon: '📓' },
  { id: 'notebook/strength-cycle', name: 'Strength Block Q4', icon: '🏋️' },
  { id: 'notebook/kettlebell-lab', name: 'Kettlebell Lab', icon: '🔔' },
];

/**
 * Current-month date helper so CalendarAgendaView & CalendarPlannerView
 * always populate the active month on initial render.
 */
function currentMonthDate(dayOfMonth: number): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(Math.min(28, Math.max(1, dayOfMonth))).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const TODAY_DATE_KEY = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
})();

/** 1. Journal Note — personal dated workout note (`kind: 'note'`, `sourceNotebook: 'journal'`) */
export const JOURNAL_NOTE_ENTRY: Entry = {
  id: 'note-journal-fran',
  kind: 'note',
  sourceNotebook: 'journal',
  sourceNote: 'note-journal-fran',
  notebookId: 'notebook/journal',
  editable: true,
  title: 'Morning Benchmark — Fran',
  date: TODAY_DATE_KEY,
  subtitle: 'Journal · 21-15-9 Couplet',
  detail: 'Unbroken thrusters on round 1; split pull-ups 12/9 on round 2.',
  tags: ['benchmark', 'couplet', 'crossfit'],
  excerpt: [
    'Warm-up: 500m Row + shoulder mobility.',
    'Unbroken thrusters on round 1; split pull-ups 12/9 on round 2.',
  ],
  blockContentId: 'bc-fran-21-15-9',
  wodBlock: {
    blockId: 'blk-fran',
    blockVersion: 1,
    blockContentId: 'bc-fran-21-15-9',
    content: '(21-15-9)\n  Thrusters @95lb\n  Pull-ups',
  },
};

/** 2. Feed / Notebook Workout Note (`kind: 'note'`, `sourceNotebook: 'crossfit-girls'`) */
export const NOTEBOOK_WORKOUT_ENTRY: Entry = {
  id: 'seed-crossfit-girls-helen',
  kind: 'note',
  sourceNotebook: 'crossfit-girls',
  sourceNote: 'helen',
  sourceId: 'notebook:crossfit-girls',
  sourcePath: 'markdown/notebooks/crossfit-girls/helen.md',
  notebookId: 'notebook/crossfit-girls',
  editable: false,
  title: 'Helen',
  date: currentMonthDate(4),
  subtitle: 'CrossFit Girls · 3 Rounds For Time',
  detail: '400m Run, 21 Kettlebell Swings 24kg, 12 Pull-ups',
  tags: ['benchmark', 'girls', 'running', 'kettlebell'],
  excerpt: ['Classic 3-round monostructural, kettlebell, and gymnastics triplet.'],
  blockContentId: 'bc-helen-3r',
  wodBlock: {
    blockId: 'blk-helen',
    blockVersion: 1,
    blockContentId: 'bc-helen-3r',
    content: '3 Rounds\n  400m Run\n  21 Kettlebell Swings @24kg\n  12 Pull-ups',
  },
};

/** 3. Notebook Landing Entry (`sourceNote: ''` triggers Details + Feed chips) */
export const NOTEBOOK_LANDING_ENTRY: Entry = {
  id: 'seed-notebook-crossfit-heroes',
  kind: 'note',
  sourceNotebook: 'crossfit-heroes',
  sourceNote: '',
  sourceId: 'notebook:crossfit-heroes',
  notebookId: 'notebook/crossfit-heroes',
  editable: false,
  title: 'CrossFit Hero Workouts',
  date: currentMonthDate(8),
  subtitle: '28 workouts · Community Feed',
  detail: 'Hero benchmark workouts honoring service members — Murph, DT, Badger, Nate, and more.',
  tags: ['heroes', 'benchmark'],
};

/** 4. Playground Scratchpad Note (`kind: 'note'`, `sourceNotebook: 'playground'`) */
export const PLAYGROUND_NOTE_ENTRY: Entry = {
  id: 'playground-emom-draft',
  kind: 'note',
  sourceNotebook: 'playground',
  sourceNote: 'emom-draft',
  notebookId: 'notebook/playground',
  editable: true,
  title: '10-Minute Tactical Snatch EMOM Draft',
  date: null,
  subtitle: 'Playground Scratchpad',
  detail: 'Testing 24kg kettlebell density progression before scheduling.',
  tags: ['kettlebell', 'emom'],
  wodBlock: {
    blockId: 'blk-emom',
    blockVersion: 1,
    blockContentId: 'bc-snatch-emom',
    content: '(10) :60 EMOM\n  6 KB Snatch Left @24kg\n  6 KB Snatch Right @24kg',
  },
};

/** 5. Guide / Documentation Note (`kind: 'note'`, `sourceNotebook: 'guides'`) */
export const GUIDE_NOTE_ENTRY: Entry = {
  id: 'guide-protocols',
  kind: 'note',
  sourceNotebook: 'guides',
  sourceNote: 'protocols',
  pageSlug: 'guide/protocols',
  editable: false,
  title: 'Timer Protocols & Interval Syntax',
  date: null,
  subtitle: 'Documentation Guide',
  detail: 'Reference guide for EMOM, AMRAP, Tabata, and forced-rest intervals.',
  tags: ['guide', 'syntax'],
};

/** 6. Actionable Block Hit (`kind: 'note'` with `entry.block` payload from `:block` query) */
export const BLOCK_HIT_ENTRY: Entry = {
  id: 'note-strength-monday#blk-squat',
  kind: 'note',
  sourceNotebook: 'journal',
  sourceNote: 'note-strength-monday',
  notebookId: 'notebook/journal',
  editable: true,
  title: 'Monday Heavy Squat & Posterior Chain',
  date: currentMonthDate(11),
  subtitle: 'Block #1 in Journal',
  tags: ['strength', 'squat'],
  blockContentId: 'bc-5x5-squat',
  block: {
    blockId: 'blk-squat',
    dataType: 'time',
    preview: [
      '(5)',
      '  5 Back Squat @315lb',
      '  *:120 Rest',
    ],
  },
  wodBlock: {
    blockId: 'blk-squat',
    blockVersion: 2,
    blockContentId: 'bc-5x5-squat',
    content: '(5)\n  5 Back Squat @315lb\n  *:120 Rest',
  },
};

/** 7. Executed Workout Result (`kind: 'result'`) */
export const RESULT_ENTRY: Entry = {
  id: 'result-sess-fran-01',
  kind: 'result',
  sourceNotebook: 'journal',
  sourceNote: 'note-journal-fran',
  title: 'Morning Benchmark — Fran',
  date: TODAY_DATE_KEY,
  subtitle: '03:45 · 90 reps · 4,275 lb volume',
  detail: 'Completed 3 of 3 rounds · TIS 68',
  blockContentId: 'bc-fran-21-15-9',
  execution: {
    resultId: 'sess-fran-01',
    noteId: 'note-journal-fran',
    timestamp: Date.now() - 3600_000,
    outputType: 'completion',
    effortSlug: 'thruster',
    elapsedMs: 225_000,
    reps: 90,
    loadLbs: 4275,
    tis: 68,
    segmentCount: 6,
  },
};

/** 8. Telemetry Segment Row (`kind: 'segment'`) */
export const SEGMENT_ENTRY: Entry = {
  id: 'seg-fran-round-1-thrusters',
  kind: 'segment',
  sourceNotebook: 'journal',
  sourceNote: 'note-journal-fran',
  title: 'Round 1 · 21 Thrusters @ 95 lb',
  date: TODAY_DATE_KEY,
  subtitle: 'Split 00:48 · Round 1 of 3',
  detail: 'Thrusters',
  execution: {
    resultId: 'sess-fran-01',
    noteId: 'note-journal-fran',
    timestamp: Date.now() - 3550_000,
    outputType: 'segment',
    effortSlug: 'thruster',
    elapsedMs: 48_000,
    reps: 21,
    loadLbs: 1995,
  },
};

/** 9. Movement Effort Definition (`kind: 'effort'`) */
export const EFFORT_ENTRY: Entry = {
  id: 'effort-thruster',
  kind: 'effort',
  sourceNotebook: 'efforts',
  sourceNote: 'thruster',
  title: 'Thruster',
  date: null,
  subtitle: 'weightlifting · MET 8.0 · high intensity',
  detail: 'Aliases: barbell-thruster, squat-to-press · Source: bundled',
  effort: {
    slug: 'thruster',
    label: 'Thruster',
    discipline: 'weightlifting',
    met: 8.0,
    intensityTier: 'high',
    aliases: ['barbell-thruster', 'squat-to-press'],
    registrySource: 'bundled',
  },
};

/** 10. Analytics Dashboard Note (`kind: 'dashboard'`) */
export const DASHBOARD_ENTRY: Entry = {
  id: 'dash-quarterly-review',
  kind: 'dashboard',
  sourceNotebook: 'dashboards',
  sourceNote: 'quarterly-review',
  sourcePath: 'markdown/dashboards/quarterly-review.md',
  title: 'Quarterly Volume & Modality Balance',
  date: currentMonthDate(15),
  subtitle: 'Dashboard · 4 WQL Widgets',
  detail: 'Tracks weekly tonnage, discipline distribution, and top benchmark PRs.',
  tags: ['analytics', 'volume'],
};

/** 11. Equipment Reference (`kind: 'equipment'`) */
export const EQUIPMENT_ENTRY: Entry = {
  id: 'equip-kettlebell',
  kind: 'equipment',
  sourceNotebook: 'equipment',
  sourceNote: 'kettlebell',
  title: 'Competition Kettlebell',
  date: null,
  subtitle: 'Equipment · Cast Iron / Steel · 8kg–48kg',
  detail: 'Used for ballistic swings, snatches, cleans, and overhead presses.',
  tags: ['ballistics', 'implements'],
};

/** 12. Typed Tag Reference (`kind: 'tag'`) */
export const TAG_ENTRY: Entry = {
  id: 'tag-discipline-gymnastics',
  kind: 'tag',
  sourceNotebook: 'tags',
  sourceNote: 'discipline/gymnastics',
  title: '#discipline:gymnastics',
  date: null,
  subtitle: 'Typed Tag · 42 linked notes',
  detail: 'Bodyweight control, rings, pull-up bar, and inverted skills.',
  tags: ['gymnastics'],
};

/** Complete catalog of all 12 distinct Entry flavors in the application. */
export const ALL_ENTRY_FLAVORS: Entry[] = [
  JOURNAL_NOTE_ENTRY,
  NOTEBOOK_WORKOUT_ENTRY,
  NOTEBOOK_LANDING_ENTRY,
  PLAYGROUND_NOTE_ENTRY,
  GUIDE_NOTE_ENTRY,
  BLOCK_HIT_ENTRY,
  RESULT_ENTRY,
  SEGMENT_ENTRY,
  EFFORT_ENTRY,
  DASHBOARD_ENTRY,
  EQUIPMENT_ENTRY,
  TAG_ENTRY,
];

/** Dated entries spread across the current month for Calendar Agenda & Planner views. */
export const CALENDAR_MONTH_ENTRIES: Entry[] = [
  {
    ...JOURNAL_NOTE_ENTRY,
    id: 'cal-1',
    date: currentMonthDate(2),
    title: 'Back Squat 5x5 + Core Tabata',
    sourceNotebook: 'journal',
  },
  {
    ...NOTEBOOK_WORKOUT_ENTRY,
    id: 'cal-2',
    date: currentMonthDate(4),
    title: 'Helen — 3 Rounds For Time',
  },
  {
    ...RESULT_ENTRY,
    id: 'cal-3',
    date: currentMonthDate(4),
    title: 'Helen Result · 08:42 Rx',
  },
  {
    ...BLOCK_HIT_ENTRY,
    id: 'cal-4',
    date: currentMonthDate(9),
    title: 'EMOM 10: Kettlebell Clean & Jerk',
    sourceNotebook: 'the-golos-method',
  },
  {
    ...JOURNAL_NOTE_ENTRY,
    id: 'cal-5',
    date: currentMonthDate(12),
    title: '200m Swim IM Pace Transitions',
    sourceNotebook: 'swimming-masters',
  },
  {
    ...JOURNAL_NOTE_ENTRY,
    id: 'cal-6',
    date: TODAY_DATE_KEY,
    title: 'Morning Benchmark — Fran',
  },
  {
    ...RESULT_ENTRY,
    id: 'cal-7',
    date: TODAY_DATE_KEY,
    title: 'Fran Session Result · 03:45',
  },
  {
    ...DASHBOARD_ENTRY,
    id: 'cal-8',
    date: currentMonthDate(18),
    title: 'Mid-Cycle Volume Check-In',
  },
  {
    ...NOTEBOOK_WORKOUT_ENTRY,
    id: 'cal-9',
    date: currentMonthDate(22),
    title: 'Murph Hero WOD Prep',
    sourceNotebook: 'crossfit-heroes',
  },
  PLAYGROUND_NOTE_ENTRY, // undated shelf item
];

/** Sample Community Feeds for FeedCard showcase. */
export const SAMPLE_FEEDS: FeedSummary[] = [
  {
    slug: 'sport-crossfit',
    feedId: 'sport-crossfit',
    label: 'CrossFit Benchmarks & Programming',
    description: 'Classic Girls, Hero WODs, Open workouts, and daily functional conditioning rotations.',
    href: '/feeds/sport-crossfit',
    repositoryUrl: 'https://github.com/bitcobblers/wod-wiki-sport-crossfit',
    itemCount: 142,
    latestDate: '2026-10-28',
    installed: true,
    subscribed: true,
    notebooks: [
      { packageId: 'community-crossfit-girls', feedId: 'sport-crossfit', slug: 'crossfit-girls', chunkId: 'notebook.crossfit-girls', label: 'CrossFit Girls', categories: ['workouts'], sourceLabel: 'CrossFit', href: '/notebook/crossfit-girls', installed: true, subscribed: true, itemCount: 28 },
      { packageId: 'community-crossfit-heroes', feedId: 'sport-crossfit', slug: 'crossfit-heroes', chunkId: 'notebook.crossfit-heroes', label: 'CrossFit Heroes', categories: ['workouts'], sourceLabel: 'CrossFit', href: '/notebook/crossfit-heroes', installed: true, subscribed: true, itemCount: 34 },
      { packageId: 'community-crossfit-games', feedId: 'sport-crossfit', slug: 'crossfit-games', chunkId: 'notebook.crossfit-games', label: 'CrossFit Games', categories: ['workouts'], sourceLabel: 'CrossFit', href: '/notebook/crossfit-games', installed: true, subscribed: false, itemCount: 50 },
      { packageId: 'community-crossfit-prog', feedId: 'sport-crossfit', slug: 'crossfit-programming', chunkId: 'notebook.crossfit-programming', label: 'Daily Programming', categories: ['programs'], sourceLabel: 'CrossFit', href: '/notebook/crossfit-programming', installed: true, subscribed: true, itemCount: 30 },
    ],
  },
  {
    slug: 'legends-of-kettlebell',
    feedId: 'legends-of-kettlebell',
    label: 'Kettlebell Coaches Archive',
    description: 'Hardstyle, Girevoy sport, and minimalist kettlebell programs from Master SFG coaches.',
    href: '/feeds/legends-of-kettlebell',
    repositoryUrl: 'https://github.com/bitcobblers/wod-wiki-legends-of-kettlebell',
    itemCount: 86,
    latestDate: '2026-10-19',
    installed: false,
    subscribed: true,
    notebooks: [
      { packageId: 'community-dan-john', feedId: 'legends-of-kettlebell', slug: 'dan-john-40-day', chunkId: 'notebook.dan-john-40-day', label: 'Dan John 40-Day', categories: ['programs'], sourceLabel: 'Kettlebell', href: '/notebook/dan-john-40-day', installed: false, subscribed: true, itemCount: 40 },
      { packageId: 'community-neupert', feedId: 'legends-of-kettlebell', slug: 'geoff-neupert', chunkId: 'notebook.geoff-neupert', label: 'Geoff Neupert', categories: ['workouts'], sourceLabel: 'Kettlebell', href: '/notebook/geoff-neupert', installed: false, subscribed: true, itemCount: 24 },
      { packageId: 'community-girevoy', feedId: 'legends-of-kettlebell', slug: 'girevoy-sport', chunkId: 'notebook.girevoy-sport', label: 'Girevoy Sport', categories: ['workouts'], sourceLabel: 'Kettlebell', href: '/notebook/girevoy-sport', installed: false, subscribed: true, itemCount: 22 },
    ],
  },
  {
    slug: 'sport-swimming',
    feedId: 'sport-swimming',
    label: 'Competitive Swimming Library',
    description: 'Structured yardage and meter sessions from high-school through Masters and Olympic prep.',
    href: '/feeds/sport-swimming',
    repositoryUrl: 'https://github.com/bitcobblers/wod-wiki-sport-swimming',
    itemCount: 64,
    latestDate: '2026-10-12',
    installed: true,
    subscribed: true,
    notebooks: [
      { packageId: 'community-swim-masters', feedId: 'sport-swimming', slug: 'swimming-masters', chunkId: 'notebook.swimming-masters', label: 'Masters Swim', categories: ['workouts'], sourceLabel: 'Swimming', href: '/notebook/swimming-masters', installed: true, subscribed: true, itemCount: 32 },
      { packageId: 'community-swim-tri', feedId: 'sport-swimming', slug: 'swimming-triathlete', chunkId: 'notebook.swimming-triathlete', label: 'Triathlete Open Water', categories: ['workouts'], sourceLabel: 'Swimming', href: '/notebook/swimming-triathlete', installed: true, subscribed: true, itemCount: 32 },
    ],
  },
];
