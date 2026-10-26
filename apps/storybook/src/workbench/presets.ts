/**
 * Workout Markdown Presets & Fixtures
 * Curated from real workout files across the repository:
 *  - `markdown/feeds/crossfit-programming/`
 *  - `markdown/notebooks/the-golos-method/`
 *  - `markdown/notebooks/swimming-highschool/`
 *  - `packages/lang/tests/fixtures/parser/`
 */

export const PRESETS = [
  'sum:totalVolume{} by {week}',
  'avg:tis{}',
  'sum:sessionLoad{} by {discipline}',
  'sum:distance{} by {week}',
];

export const DEFAULT_WQL = PRESETS[0];

export const DEFAULT_SCRIPT = [
  '(21-15-9)',
  '  Thrusters @95lb',
  '  Pull-ups',
].join('\n');

/** Fran: Classic CrossFit descending couplet with Thrusters and Pull-ups. */
export const FRAN_NOTE = [
  '# Benchmark — Fran',
  '',
  'A live note, just like the playground note page. The fence below is live',
  'Whiteboard Script — edit it, watch the code statements re-parse, then run',
  'it against the wall clock.',
  '',
  '```time',
  ...DEFAULT_SCRIPT.split('\n'),
  '```',
  '',
  'Prose after the fence is plain markdown.',
].join('\n');

export const DEFAULT_NOTE = FRAN_NOTE;

/** Tabata & EMOM: Multi-block conditioning with interval timers and cool-down. */
export const TABATA_EMOM_NOTE = [
  '# High-Intensity Intervals — Tabata & EMOM',
  '',
  'A multi-block conditioning session testing anaerobic endurance and recovery.',
  'Select any block below to inspect its statements and run its timers.',
  '',
  '## Warm-up & Core Tabata',
  '```time',
  '(8)',
  '  :20 Hollow Hold',
  '  *:10 Rest',
  '```',
  '',
  '## Main Metcon — 10-Minute EMOM',
  '```time',
  '(10) :60 EMOM',
  '  + 2 Burpees',
  '  + 5 Push-ups',
  '  + 7 Air Squats',
  '```',
  '',
  '## Cool-down',
  '```time',
  '3:00 Easy Row',
  '```',
].join('\n');

/** The Golos Method: Ballistic kettlebell power-endurance with intervals and test cap. */
export const GOLOS_KETTLEBELL_NOTE = [
  '# The Golos Method — Kettlebell Power Endurance',
  '',
  'Ballistic strength and power-endurance session. Focus on hip snap, rack stabilization, and soft catches.',
  '',
  '## Phase 1 — Clean & Press Technique',
  '```time',
  '(5)',
  '  5 KB Clean & Press Left 24kg',
  '  5 KB Clean & Press Right 24kg',
  '  *:45 Rest',
  '```',
  '',
  '## Phase 2 — Tactical Snatch EMOM',
  '```time',
  '(10) 1:00 EMOM',
  '  4|6 KB Snatch 24kg',
  '```',
  '',
  '## Phase 3 — Snatch Test Cap',
  '```time',
  '5:00 ? KB Snatch 24kg',
  '```',
].join('\n');

/** Murph Hero WOD: High volume bodyweight work bracketed by 1-mile runs. */
export const MURPH_NOTE = [
  '# Wednesday Hero WOD — Murph',
  '',
  'In memory of Navy Lieutenant Michael Murphy. Partition the pull-ups, push-ups, and squats as needed.',
  '',
  '```time',
  '1 Mile Run',
  '100 Pull-ups',
  '200 Push-ups',
  '300 Air Squats',
  '1 Mile Run',
  '```',
  '',
  'Wear a 20 lb / 9 kg vest if available.',
].join('\n');

/** Strength & Triplet: Percentage-based back squat cycle with accessory triplet circuit. */
export const STRENGTH_METCON_NOTE = [
  '# Strength & Conditioning — Monday Heavy',
  '',
  'Comprehensive training day with strength progression followed by an accessory triplet circuit.',
  '',
  '## Phase 1 — Back Squat 5x5',
  '```time',
  '(5)',
  '  5 Back Squat 80%',
  '```',
  '',
  '## Phase 2 — Triplet Accessory Circuit',
  '```time',
  '(3)',
  '  10 Romanian Deadlift 60%',
  '  15 GHD Sit-Ups',
  '  20 Box Step-Up 24/20',
  '  *:60 Rest',
  '```',
].join('\n');

/** Swimming IM: Stroke endurance session with warmup, interval sets, and cooldown. */
export const SWIMMING_IM_NOTE = [
  '# Swimming — 200m IM Race Prep',
  '',
  'Stroke endurance and transition session developing pace across all four competitive disciplines.',
  '',
  '## Warmup IM',
  '```time',
  '(3)',
  '  150m IM',
  '  *:30 Rest',
  '```',
  '',
  '## Stroke Focus & Main Set',
  '```time',
  '(4)',
  '  50m Butterfly',
  '  50m Freestyle',
  '  *:30 Rest',
  '```',
  '',
  '## Cooldown',
  '```time',
  '200m Cooldown',
  '```',
].join('\n');

export interface WorkoutPreset {
  id: string;
  name: string;
  category: string;
  badge?: string;
  description: string;
  markdown: string;
}

export const WORKOUT_PRESETS: WorkoutPreset[] = [
  {
    id: 'fran',
    name: 'Fran (21-15-9)',
    category: 'Benchmark',
    badge: 'Couplet',
    description: 'Classic CrossFit descending couplet with Thrusters and Pull-ups.',
    markdown: FRAN_NOTE,
  },
  {
    id: 'intervals',
    name: 'Tabata & EMOM',
    category: 'Conditioning',
    badge: 'Intervals',
    description: 'Multi-block session combining 8-round Tabata hollow holds, 10-minute EMOM circuit, and row cool-down.',
    markdown: TABATA_EMOM_NOTE,
  },
  {
    id: 'golos',
    name: 'Golos Method KB',
    category: 'Ballistics',
    badge: 'Kettlebell',
    description: 'Ballistic power endurance from The Golos Method: Clean & Press intervals, Snatch EMOM, and 5-minute Snatch test.',
    markdown: GOLOS_KETTLEBELL_NOTE,
  },
  {
    id: 'murph',
    name: 'Murph (Hero WOD)',
    category: 'Hero WOD',
    badge: 'Endurance',
    description: 'High-volume hero workout with 1-mile running brackets, 100 pull-ups, 200 push-ups, and 300 squats.',
    markdown: MURPH_NOTE,
  },
  {
    id: 'strength-metcon',
    name: 'Strength & Triplet',
    category: 'Strength',
    badge: 'Multi-Phase',
    description: 'Strength day combining a 5x5 Back Squat percentage cycle with an accessory triplet circuit.',
    markdown: STRENGTH_METCON_NOTE,
  },
  {
    id: 'swimming',
    name: 'Swimming IM Prep',
    category: 'Endurance',
    badge: 'Swim',
    description: 'Comprehensive 200m IM preparation session with warm-up, stroke focus intervals, and cooldown.',
    markdown: SWIMMING_IM_NOTE,
  },
];
