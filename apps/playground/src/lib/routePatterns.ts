/**
 * Playground Route Patterns — canonical route constants with zero runtime dependencies.
 *
 * Kept separate from `routes.ts` so CLI/ontology scripts (`index-code-graph.ts`,
 * `generate-agent-manifest.ts`) can import `ROUTE_PATTERNS` without pulling app
 * services or unbuilt workspace packages.
 */

export const ROUTE_PATTERNS = {
  home: '/',
  playgroundRoot: '/playground',
  playground: '/playground/:id',
  /** /note/:noteId — one note (any kind), addressed by UUID. */
  note: '/note/:noteId',
  /** /notes — the note library. */
  notes: '/notes',
  /** /journal — the journal library. */
  journal: '/journal',
  /** /day/:date — one day across notebooks. */
  day: '/day/:date',
  plan: '/plan',
  aiFirst: '/ai-first',
  /** /feeds — the feed library. */
  feeds: '/feeds',
  /** /feed/:slug — one feed source. */
  feed: '/feed/:slug',
  /** /notebooks — the notebook library. */
  notebooks: '/notebooks',
  /** /notebook/:slug — one notebook. */
  notebook: '/notebook/:slug',
  /** /notebook/:slug/:target — a notebook member: note UUID → the note,
   *  date → a day-scoped notebook view, else the named item editor. */
  notebookTarget: '/notebook/:slug/:target',
  /** /notebook/:slug/:itemDate/:item — one dated notebook item. */
  notebookItem: '/notebook/:slug/:itemDate/:item',
  subscribe: '/subscribe',
  /** /pages — the page library. */
  pages: '/pages',
  /** /page/:slug — one note-built page (canvas route or named page). */
  page: '/page/:slug',
  /** /tags — the tag catalogue. */
  tags: '/tags',
  /** /t/:type — one Tag Category Property Note and its child tags list. */
  tagCategory: '/t/:type',
  /** /t/:type/:tag — one Tag Property Note of one category. */
  tag: '/t/:type/:tag',
  /** /sessions list, /results/:sessionId detail, /session/:date — the sessions family. */
  sessions: '/sessions',
  /** /results/:sessionId — one session's execution detail (canonical). */
  sessionDetail: '/results/:sessionId',
  sessionDate: '/session/:date',
  /** /playgrounds — list of all created playground entries. */
  playgrounds: '/playgrounds',
  tracker: '/tracker/:runtimeId',
  run: '/run/:runtimeId',
  load: '/load',
  loadJournal: '/load/journal',
  loadJournalDate: '/load/journal/:date',
  efforts: '/efforts',
  /** /effort/:slug — effort detail (create rides slug 'new' + ?mode=create). */
  effort: '/effort/:slug',
  /** /equipment — the equipment list (note stream). */
  equipment: '/equipment',
  /** /equipment/:slug — equipment detail (create rides slug 'new' + ?mode=create). */
  equipmentSlug: '/equipment/:slug',
  /** /dashboards — dashboard list / WQL explorer landing. */
  dashboards: '/dashboards',
  /** /dashboard/:slug — a dashboard addressed by its page slug or id. */
  dashboardView: '/dashboard/:slug',
  settings: '/settings',
  settingsAppearance: '/settings/appearance',
  settingsProfile: '/settings/profile',
  settingsStorage: '/settings/storage',
  settingsSync: '/settings/sync',
  settingsSystem: '/settings/system',
  settingsTags: '/settings/tags',
  settingsSoundProfiles: '/settings/sound-profiles',
} as const;

/**
 * Retired route patterns retained solely for `<Navigate>` redirects in `App.tsx`.
 * Excluded from `ROUTE_PATTERNS` so discovery manifests (`llms.txt`) only
 * advertise canonical live routes.
 */
export const LEGACY_REDIRECT_PATTERNS = {
  settingsData: '/settings/data',
  settingsDatabase: '/settings/database',
  settingsQueries: '/settings/queries',
} as const;
