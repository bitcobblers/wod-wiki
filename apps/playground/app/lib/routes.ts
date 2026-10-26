/**
 * Playground Route Definitions — canonical paths and builders.
 *
 * This is the single source of truth for all browser-level routes in the
 * playground app. Route patterns and path builders live here so nothing
 * else hard-codes a path literal.
 *
 * The URL scheme (ticket 09): every URL says which concept it addresses and
 * whether it is one thing or many, distinguished by depth —
 *
 *   Library (one segment):  /notebooks /notes /journal /pages /tags /feeds
 *                           /efforts /equipment /dashboards
 *   One thing (deeper):     /notebook/:slug /note/:noteId /day/:date
 *                           /page/:slug /t/:type/:tag /feed/:slug
 *                           /effort/:slug /equipment/:slug /dashboard/:slug
 *
 * Retired paths (/c/*, /collections, /catalogs, /p/*, /e/*, /d/*,
 * /notes/:noteId, /note/:category/:name, /journal/:identity, /feed,
 * /dashboard, /analytics*) no longer resolve — there is no redirect matrix
 * and no compatibility alias.
 */

// ---------------------------------------------------------------------------
// React-Router path patterns (used by <Route path="...">)
// ---------------------------------------------------------------------------

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
  /** /feed/:slug/:feedDate/:feedItem — one feed post. */
  feedItem: '/feed/:slug/:feedDate/:feedItem',
  /** /notebooks — the notebook library. */
  notebooks: '/notebooks',
  /** /notebook/:slug — one notebook. */
  notebook: '/notebook/:slug',
  /** /notebook/:slug/:target — a notebook member: note UUID → the note,
   *  date → a day-scoped notebook view, else the named item editor. */
  notebookTarget: '/notebook/:slug/:target',
  subscribe: '/subscribe',
  /** /pages — the page library. */
  pages: '/pages',
  /** /page/:slug — one note-built page (canvas route or named page). */
  page: '/page/:slug',
  /** /tags — the tag catalogue. */
  tags: '/tags',
  /** /t/:type/:tag — one tag of one type. */
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
  /** Retired — split into /settings/database + /settings/sync; redirects to storage. */
  settingsData: '/settings/data',
  /** Retired — /settings/database renamed to /settings/storage; redirects. */
  settingsDatabase: '/settings/database',
  /** Retired — per-surface query config moved onto the pages themselves;
   *  redirects to the library. */
  settingsQueries: '/settings/queries',
} as const;

// ---------------------------------------------------------------------------
// Canonical path builders — one builder per concept
// ---------------------------------------------------------------------------

/** /playground/:id */
export function playgroundPath(id: string): string {
  return `/playground/${encodeURIComponent(id)}`;
}

/** /day/:date */
export function dayPath(date: string): string {
  return `/day/${encodeURIComponent(date)}`;
}

/** /day/:date?autoStart=<runtimeId> */
export function dayAutoStartPath(date: string, runtimeId: string): string {
  return `/day/${encodeURIComponent(date)}?autoStart=${encodeURIComponent(runtimeId)}`;
}

/** /note/:noteId — the canonical single-note route (any note kind). */
export function notePath(noteId: string): string {
  return `/note/${encodeURIComponent(noteId)}`;
}

/** /notebook/:slug — the canonical notebook landing. */
export function notebookPath(slug: string): string {
  return `/notebook/${encodeURIComponent(slug)}`;
}

/** /notebook/:slug/:date — a date-scoped view of a notebook, journal-style. */
export function notebookDatePath(slug: string, date: string): string {
  return `/notebook/${encodeURIComponent(slug)}/${encodeURIComponent(date)}`;
}

/** /notebook/:slug/:item — the named notebook item editor. */
export function notebookItemPath(slug: string, item: string): string {
  return `/notebook/${encodeURIComponent(slug)}/${encodeURIComponent(item)}`;
}

/** /feed/:slug */
export function feedPath(feedSlug: string): string {
  return `/feed/${encodeURIComponent(feedSlug)}`;
}

/** /feed/:slug/:feedDate/:feedItem */
export function feedItemPath(feedSlug: string, feedDate: string, feedItem: string): string {
  return `/feed/${encodeURIComponent(feedSlug)}/${encodeURIComponent(feedDate)}/${encodeURIComponent(feedItem)}`;
}

/** /run/:runtimeId (canonical runtime seam for WOD-505) */
export function runPath(runtimeId: string): string {
  return `/run/${encodeURIComponent(runtimeId)}`;
}

export interface PlaygroundLoadUrlOptions {
  zip: string;
}

/** /load?zip=<encoded> */
export function buildPlaygroundLoadUrl({ zip }: PlaygroundLoadUrlOptions): string {
  return `/load?zip=${encodeURIComponent(zip)}`;
}

/** /sessions — the sessions listing. */
export function sessionsPath(): string {
  return '/sessions';
}

/** /results/:sessionId — one session's execution detail (canonical). */
export function sessionDetailPath(sessionId: string): string {
  return `/results/${encodeURIComponent(sessionId)}`;
}

/** /session/:date — the sessions from a given date. */
export function sessionDatePath(date: string): string {
  return `/session/${encodeURIComponent(date)}`;
}

/** /page/:slug — one note-built page. */
export function pagePath(slug: string): string {
  return `/page/${encodeURIComponent(slug)}`;
}

/** /playgrounds — the list of all created playground entries. */
export function playgroundsPath(): string {
  return '/playgrounds';
}

export function effortsPath(): string {
  return '/efforts';
}

/** /equipment/:slug */
export function equipmentPath(slug: string): string {
  return `/equipment/${encodeURIComponent(slug)}`;
}

/** /dashboards?q=… — the dashboard list / WQL explorer with an optional
 * pre-filled query and range. */
export function analyticsExplorerPath(options?: { q?: string; weeks?: number }): string {
  const params = new URLSearchParams();
  if (options?.q) params.set('q', options.q);
  if (options?.weeks) params.set('weeks', String(options.weeks));
  const qs = params.toString();
  return `/dashboards${qs ? `?${qs}` : ''}`;
}

/** /dashboards — the dashboard list (the WQL explorer landing). */
export function dashboardsPath(): string {
  return '/dashboards';
}

/** /dashboard/:slug — a saved or prebuilt dashboard, addressed by slug or id. */
export function dashboardViewPath(slug: string): string {
  return `/dashboard/${encodeURIComponent(slug)}`;
}

/** /effort/:slug with optional modifiers and page controls */
export function effortPath(
  slug: string,
  modifiers?: Record<string, string>,
  options?: { mode?: string; tab?: string },
): string {
  const params = new URLSearchParams();
  if (modifiers) {
    for (const [k, v] of Object.entries(modifiers)) {
      params.set(k, v);
    }
  }
  if (options?.mode) params.set('mode', options.mode);
  if (options?.tab) params.set('tab', options.tab);
  const query = params.toString();
  return query ? `/effort/${encodeURIComponent(slug)}?${query}` : `/effort/${encodeURIComponent(slug)}`;
}

// ---------------------------------------------------------------------------
// Effort route utilities
// ---------------------------------------------------------------------------

/**
 * Parse effort route query params into resolver modifiers.
 *
 * Reserved params (not fed to resolver): mode, tab, q, origin
 * All other params are treated as attribute metric modifiers.
 */
export function parseEffortRouteModifiers(searchParams: URLSearchParams): Record<string, string> {
  const reserved = new Set(['mode', 'tab', 'q', 'origin']);
  const modifiers: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (!reserved.has(key)) {
      modifiers[key] = value;
    }
  }
  return modifiers;
}

/**
 * Parse page-control params from effort route query string.
 *
 * Returns reserved params: mode, tab, q, origin
 */
export function parseEffortRouteOptions(searchParams: URLSearchParams): {
  mode?: string;
  tab?: string;
  q?: string;
  origin?: string;
} {
  return {
    mode: searchParams.get('mode') ?? undefined,
    tab: searchParams.get('tab') ?? undefined,
    q: searchParams.get('q') ?? undefined,
    origin: searchParams.get('origin') ?? undefined,
  };
}

/** /settings or /settings/:section */
export function settingsPath(section?: 'appearance' | 'profile' | 'data' | 'system'): string {
  return section ? `/settings/${section}` : '/settings/appearance';
}

// ---------------------------------------------------------------------------
// Route-category helpers (used by navigation UI)
// ---------------------------------------------------------------------------

/** Detect whether a location pathname belongs to the playground note family. */
export function isPlaygroundNotePath(pathname: string): boolean {
  return pathname.startsWith('/playground/');
}

/** Detect whether a location pathname belongs to the day family. */
export function isDayPath(pathname: string): boolean {
  return pathname.startsWith('/day/');
}

/** Detect whether a location pathname belongs to the tracker/run family. */
export function isTrackerPath(pathname: string): boolean {
  return pathname.startsWith('/tracker/') || pathname.startsWith('/run/');
}

/** Detect whether a location pathname belongs to the notebook item family. */
export function isNotebookItemPath(pathname: string): boolean {
  return pathname.startsWith('/notebook/') && pathname.split('/').length >= 4 && pathname.split('/')[3] !== '';
}

/** Detect whether a location pathname belongs to the efforts family. */
export function isEffortsPath(pathname: string): boolean {
  return pathname === '/efforts' || pathname.startsWith('/effort/');
}

/** Detect whether a location pathname belongs to the equipment family (list + detail). */
export function isEquipmentPath(pathname: string): boolean {
  return pathname === '/equipment' || pathname.startsWith('/equipment/');
}

/** Detect whether a location pathname belongs to the effort family. */
export function isEffortPath(pathname: string): boolean {
  return pathname.startsWith('/effort/') || pathname === '/efforts';
}

/** Detect whether a location pathname belongs to the ai-first family. */
export function isAiFirstPath(pathname: string): boolean {
  return pathname === '/ai-first' || pathname.startsWith('/ai-first/');
}

/**
 * Capture the three segments of `/feed/:slug/:feedDate/:feedItem`.
 * Returns `[slug, feedDate, feedItem]` (raw, URL-encoded) or `null` if
 * the pathname is not a feed-item path. `AppContent` uses this because
 * `useParams` only captures generic `{category, name, id}`.
 */
export function matchFeedItem(pathname: string): [string, string, string] | null {
  const m = pathname.match(/^\/feed\/([^/]+)\/([^/]+)\/([^/]+)$/);
  return m ? [m[1]!, m[2]!, m[3]!] : null;
}

/**
 * Capture the slug of `/feed/:slug`. Returns the slug or `null` if
 * the pathname is not a feed-detail path. Does not match feed-item paths
 * (those are 3-segment, this is 1-segment) — caller checks `matchFeedItem`
 * first if both may match.
 */
export function matchFeedDetail(pathname: string): string | null {
  const m = pathname.match(/^\/feed\/([^/]+)$/);
  return m ? m[1]! : null;
}
