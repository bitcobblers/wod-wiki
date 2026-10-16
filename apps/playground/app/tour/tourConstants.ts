/**
 * tourConstants.ts — Presentation constants and types for the homepage tour.
 *
 * Accents reference the app's existing metric tokens (src/index.css) —
 * no ad-hoc palette. Use as `hsl(var(--metric-*))`.
 */

export type TourScreen = 'editor' | 'timer' | 'analytics' | 'metrics' | 'result'

export type TourStageId =
  | 'timer-intro'
  | 'timer-wallclock'
  | 'timer-next'
  | 'timer-cast'
  | 'timer-output'
  | 'timer-dashboard'

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
  /** Alias for the analytics accent used by flat-stack chrome. */
  rounds: TOUR_ACTION,
} as const

/** Window-chrome title shown while each screen is active. */
export const SCREEN_TITLES: Record<TourScreen, string> = {
  editor: 'WOD Editor & Autocomplete',
  timer: 'Clock',
  analytics: 'WQL Analytics',
  metrics: 'Own the Metrics',
  result: 'Run Results',
}

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


