/**
 * tourConstants.ts — Presentation constants and types for the homepage tour.
 *
 * Accents reference the app's existing metric tokens (src/index.css) —
 * no ad-hoc palette. Use as `hsl(var(--metric-*))`.
 */

export type TourScreen = 'editor' | 'timer' | 'analytics' | 'metrics'

export type TourStageId =
  | 'editor-metrics'
  | 'editor-run'
  | 'editor-typeahead'
  | 'timer-wallclock'
  | 'timer-next'
  | 'timer-cast'
  | 'metrics-e'
  | 'metrics-m'
  | 'metrics-d'
  | 'metrics-c'
  | 'wql-idea'
  | 'wql-table'
  | 'wql-graphs'
  | 'wql-dashboard'
  | 'wql-live'
  | 'timer'
  | 'analytics'

/**
 * Registry keys for elements the highlight ring can target. Screens
 * register wrapper elements under these keys via RingTargetsContext.
 */
export type RingTargetKey =
  | 'editor.window'
  | 'editor.wodBlock'
  | 'editor.runButton'
  | 'editor.typeahead'
  | 'timer.floor'
  | 'timer.nextButton'
  | 'timer.castButton'
  | 'metrics.efforts'
  | 'metrics.data'
  | 'metrics.compound'
  | 'analytics.vocab'
  | 'analytics.table'
  | 'analytics.graphs'
  | 'analytics.dashboard'

/**
 * Tour decorative accents — collapsed to ONE accessible action accent (the
 * theme primary) for all tour chrome: headings, pips, ring, command chips.
 * Semantic metric colors remain global CSS (--metric-*) and are untouched;
 * data surfaces keep using them.
 */
const TOUR_ACTION = 'hsl(var(--primary))'

export const TOUR_ACCENTS = {
  ink: 'hsl(var(--foreground))',
  editor: TOUR_ACTION,
  timer: TOUR_ACTION,
  analytics: TOUR_ACTION,
  library: TOUR_ACTION,
  /** Alias for the analytics accent used by explore-section chrome. */
  rounds: TOUR_ACTION,
} as const

export interface TourStage {
  id: TourStageId
  screen: TourScreen
  accent?: string
  label?: string
  ringA?: RingTargetKey | null
  tagA?: string
}

export const TOUR_STAGES: TourStage[] = [
  { id: 'editor-metrics', screen: 'editor', accent: TOUR_ACCENTS.editor, label: 'Every Line Collects Metrics', ringA: 'editor.wodBlock', tagA: 'Line Metrics' },
  { id: 'editor-run', screen: 'editor', accent: TOUR_ACCENTS.editor, label: 'Press Run to Start', ringA: 'editor.runButton', tagA: 'Run Button' },
  { id: 'timer-wallclock', screen: 'timer', accent: TOUR_ACCENTS.timer, label: 'What Happens When It Runs', ringA: 'timer.floor', tagA: 'Clock' },
  { id: 'timer-next', screen: 'timer', accent: TOUR_ACCENTS.timer, label: 'Advance Rounds with Next', ringA: 'timer.nextButton', tagA: 'Next Button' },
  { id: 'timer-cast', screen: 'timer', accent: TOUR_ACCENTS.timer, label: 'Cast to the Big Screen', ringA: 'timer.castButton', tagA: 'Cast' },
  { id: 'metrics-e', screen: 'metrics', accent: TOUR_ACCENTS.analytics, label: 'Everything Is an Effort', ringA: 'metrics.efforts', tagA: 'Effort' },
  { id: 'metrics-m', screen: 'metrics', accent: TOUR_ACCENTS.analytics, label: 'Efforts Collect Metrics', ringA: 'metrics.data', tagA: 'Micro Data' },
  { id: 'metrics-c', screen: 'metrics', accent: TOUR_ACCENTS.analytics, label: 'Compounding Facts', ringA: 'metrics.compound', tagA: 'Analytics Facts' },
  { id: 'wql-idea', screen: 'analytics', accent: TOUR_ACCENTS.analytics, label: 'Query what you just did', ringA: 'analytics.vocab', tagA: 'WQL elements' },
  { id: 'wql-table', screen: 'analytics', accent: TOUR_ACCENTS.analytics, label: 'Read it as a list', ringA: 'analytics.table', tagA: 'Table list' },
  { id: 'wql-graphs', screen: 'analytics', accent: TOUR_ACCENTS.analytics, label: 'See it as trends', ringA: 'analytics.graphs', tagA: 'Graphs' },
  { id: 'wql-dashboard', screen: 'analytics', accent: TOUR_ACCENTS.analytics, label: 'Compose a dashboard', ringA: 'analytics.dashboard', tagA: 'Dashboard' },
  { id: 'wql-live', screen: 'analytics', accent: TOUR_ACCENTS.analytics, label: "It's your data" },
]
/** Window-chrome title shown while each screen is active. */
export const SCREEN_TITLES: Record<TourScreen, string> = {
  editor: 'WOD Editor & Autocomplete',
  timer: 'Clock',
  analytics: 'WQL Analytics',
  metrics: 'Own the Metrics',
}

/** Runway height — legacy single-runway constant, retained for mobile layouts. */
export const TOUR_RUNWAY_HEIGHT = '1300vh'

/**
 * Chapter id → its consolidated guide route (markdown/canvas/guide/**,
 * eight chapters). Home-page chapter ids must match these keys — see the
 * `chapter` blocks in markdown/canvas/canvas home README and the guide pages.
 */
export const CHAPTER_GUIDE_ROUTES: Record<string, string> = {
  start: '/guide/start',
  protocols: '/guide/protocols',
  structure: '/guide/structure',
  metrics: '/guide/metrics',
  clock: '/guide/clock',
  wql: '/guide/wql',
  dashboards: '/guide/dashboards',
  sessions: '/guide/sessions',
  // Home-page chapter ids (markdown/canvas/home/README.md `chapter` blocks)
  // predate the consolidated routes; aliasing keeps quest/progress identity
  // stable while still landing each chapter on its guide page.
  basics: '/guide/start',
  'custom-metrics': '/guide/metrics',
  dialects: '/guide/sessions#intent',
  complex: '/guide/sessions#full-session',
}

/** Entry chapter — the map's fallback for an unknown chapter id. */
export const CHAPTER_GUIDE_DEFAULT_ROUTE = '/guide/start'


