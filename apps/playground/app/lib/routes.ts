/**
 * Playground Route Definitions — canonical paths, builders, and redirect matrix.
 *
 * This is the single source of truth for all browser-level routes in the
 * playground app.  Route patterns, path builders, and legacy aliases live
 * here so nothing else hard-codes a path literal.
 *
 */


// ---------------------------------------------------------------------------
// React-Router path patterns (used by <Route path="...">)
// ---------------------------------------------------------------------------

export const ROUTE_PATTERNS = {
  home: '/',
  playgroundRoot: '/playground',
  playground: '/playground/:id',
  notePlaygroundAlias: '/note/playground/:name',
  note: '/note/:category/:name',
  journal: '/journal',
  journalEntry: '/journal/:identity',
  journalNote: '/journal/:date/:uuid',
  noteById: '/notes/:noteId',
  plan: '/plan',
  aiFirst: '/ai-first',
  feeds: '/feeds',
  feed: '/feed',
  feedDetail: '/feeds/:feedSlug',
  feedItem: '/feeds/:feedSlug/:feedDate/:feedItem',
  catalogs: '/catalogs',
  subscribe: '/subscribe',
  collections: '/collections',
  collectionDetail: '/collections/:slug',
  collectionWorkout: '/collections/:collection/:workout',
  /** /c/:slug — the canonical collection landing (single-letter item prefix). */
  collection: '/c/:slug',
  /** /c/:collection/:workout — named editor by page slug; a date target scopes the collection. */
  collectionTarget: '/c/:collection/:workout',
  /** /e/:slug — effort detail (single-letter item prefix). */
  effortSlug: '/e/:slug',
  /** /equipment — the equipment list (note stream). */
  equipment: '/equipment',
  /** /equipment/:slug — equipment detail (create rides slug 'new' + ?mode=create). */
  equipmentSlug: '/equipment/:slug',
  /** /sessions list, /results/:sessionId detail, /session/:date — the sessions family. */
  sessions: '/sessions',
  /** /results/:sessionId — one session's execution detail (canonical). */
  sessionDetail: '/results/:sessionId',
  sessionDate: '/session/:date',
  /** /tags — the tag catalogue: what each tag contributes. */
  tags: '/tags',
  /** /dashboards — dashboard list / WQL explorer landing. */
  dashboards: '/dashboards',
  /** /d/:slug — a dashboard addressed by its page slug. */
  dashboardSlug: '/d/:slug',
  /** /p/* — the generic render for any note-built page (slug = declared route minus leading slash and optional guide/ prefix). */
  pages: '/p/*',
  /** /playgrounds — list of all created playground entries. */
  playgrounds: '/playgrounds',
  tracker: '/tracker/:runtimeId',
  run: '/run/:runtimeId',
  load: '/load',
  loadJournal: '/load/journal',
  loadJournalDate: '/load/journal/:date',
  efforts: '/efforts',
  effort: '/effort/:slug',
  analytics: '/analytics',
  analyticsExplorer: '/analytics/explorer',
  dashboard: '/dashboard',
  dashboardView: '/dashboard/:slug',
  settings: '/settings',
  settingsAppearance: '/settings/appearance',
  settingsProfile: '/settings/profile',
  settingsStorage: '/settings/storage',
  settingsSync: '/settings/sync',
  settingsSystem: '/settings/system',
  settingsQueries: '/settings/queries',
  settingsTags: '/settings/tags',
  settingsSoundProfiles: '/settings/sound-profiles',
  /** Retired — split into /settings/database + /settings/sync; redirects to storage. */
  settingsData: '/settings/data',
  /** Retired — /settings/database renamed to /settings/storage; redirects. */
  settingsDatabase: '/settings/database',
} as const;

// ---------------------------------------------------------------------------
// Canonical path builders
// ---------------------------------------------------------------------------

/** /playground/:id */
export function playgroundPath(id: string): string {
  return `/playground/${encodeURIComponent(id)}`;
}

/** /journal/:date/ */
export function journalDatePath(date: string): string {
  return `/journal/${encodeURIComponent(date)}/`;
}

/**
 * Sub-selection of a single note within a date page — RETIRED.
 * Note selection opens the canonical editor via {@link noteByIdPath};
 * `/journal/:date?note=` and `/journal/:date/:noteId` redirect there.
 */

/** Legacy single-segment journal route (date, UUID alias, or slug alias). */
export function journalEntryPath(identity: string): string {
  return `/journal/${encodeURIComponent(identity)}`;
}

/** /notes/:noteId — the canonical single-note route (any note kind). */
export function noteByIdPath(noteId: string): string {
  return `/notes/${encodeURIComponent(noteId)}`;
}

/** /c/:slug/:date — a date-scoped view of a collection, journal-style. */
export function collectionDatePath(slug: string, date: string): string {
  return `/c/${encodeURIComponent(slug)}/${encodeURIComponent(date)}`;
}

/** /journal/:id?autoStart=<runtimeId> */
export function journalEntryAutoStartPath(id: string, runtimeId: string): string {
  return `/journal/${encodeURIComponent(id)}?autoStart=${encodeURIComponent(runtimeId)}`;
}

/** /feeds/:feedSlug */
export function feedDetailPath(feedSlug: string): string {
  return `/feeds/${encodeURIComponent(feedSlug)}`;
}

/** /feeds/:feedSlug/:feedDate/:feedItem */
export function feedItemPath(feedSlug: string, feedDate: string, feedItem: string): string {
  return `/feeds/${encodeURIComponent(feedSlug)}/${encodeURIComponent(feedDate)}/${encodeURIComponent(feedItem)}`;
}

/** /c/:slug — the canonical collection landing. */
export function collectionPath(slug: string): string {
  return `/c/${encodeURIComponent(slug)}`;
}

/** /c/:collection/:workout — the named workout editor by page slug. */
export function workoutPath(collection: string, workout: string): string {
  return `/c/${encodeURIComponent(collection)}/${encodeURIComponent(workout)}`;
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

/** /p/:slug — the generic render for a note-built page. */
export function pagePath(slug: string): string {
  return `/p/${slug}`;
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

/** /analytics/explorer with an optional pre-filled WQL query and range.
 * The explorer lives at /dashboards; this builder keeps deep links (?q=)
 * working by pointing at the new home. */
export function analyticsExplorerPath(options?: { q?: string; weeks?: number }): string {
  const params = new URLSearchParams();
  if (options?.q) params.set('q', options.q);
  if (options?.weeks) params.set('weeks', String(options.weeks));
  const qs = params.toString();
  return `/dashboards${qs ? `?${qs}` : ''}`;
}

/** /dashboards — the dashboard list (the WQL explorer landing). */
export function dashboardPath(): string {
  return '/dashboards';
}

/** /dashboard/:slug — a saved or prebuilt dashboard, addressed by id. */
export function dashboardViewPath(slug: string): string {
  return `/dashboard/${encodeURIComponent(slug)}`;
}

/** /d/:slug — a dashboard addressed by its page slug. */
export function dashboardSlugPath(slug: string): string {
  return `/d/${encodeURIComponent(slug)}`;
}

/** /e/:slug with optional modifiers and page controls */
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
  return query ? `/e/${encodeURIComponent(slug)}?${query}` : `/e/${encodeURIComponent(slug)}`;
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
export function settingsPath(section?: 'appearance' | 'profile' | 'data' | 'system' | 'queries'): string {
  return section ? `/settings/${section}` : '/settings/appearance';
}
// Legacy-alias → canonical redirect matrix
// ---------------------------------------------------------------------------

export interface RedirectRule {
  /** Return captured params (or true for empty) when the pathname matches. */
  match: (pathname: string) => Record<string, string> | false;
  /** Build the destination from captured params. */
  to: (params: Record<string, string>) => string;
}

/**
 * Ordered list of legacy aliases that should redirect to their canonical
 * shape.  Checked in order; first match wins.
 */
export const ROUTE_REDIRECTS: RedirectRule[] = [
  // /note/playground/:name  →  /playground/:name
  {
    match: (p) => {
      const m = p.match(/^\/note\/playground\/([^/]+)$/);
      if (!m) return false;
      return { name: decodeURIComponent(m[1]!) };
    },
    to: ({ name }) => playgroundPath(name),
  },
  // /workout/:category/:name  →  /c/:category/:name
  {
    match: (p) => {
      const m = p.match(/^\/workout\/([^/]+)\/([^/]+)$/);
      if (!m) return false;
      return { collection: decodeURIComponent(m[1]!), workout: decodeURIComponent(m[2]!) };
    },
    to: ({ collection, workout }) => workoutPath(collection, workout),
  },
  // /feed  →  /feeds
  {
    match: (p) => {
      if (p !== '/feed' && p !== '/feed/') return false;
      return {};
    },
    to: () => '/feeds',
  },
  // /collections  →  /feeds (the renamed collections listing). Item paths
  // (/collections/:slug[/:target]) keep their CollectionItemRedirect routes.
  {
    match: (p) => {
      if (p !== '/collections' && p !== '/collections/') return false;
      return {};
    },
    to: () => '/feeds',
  },
  // /getting-started  →  / (retired: content folded into home)
  {
    match: (p) => {
      if (p !== '/getting-started') return false;
      return {};
    },
    to: () => '/',
  },
  // /chapters/basics  →  /guide/start (First Workout absorbed the basics chapter)
  {
    match: (p) => {
      if (p !== '/chapters/basics') return false;
      return {};
    },
    to: () => '/guide/start',
  },
  // /chapters/sequences  →  /guide/start (split content consolidated there)
  {
    match: (p) => {
      if (p !== '/chapters/sequences') return false;
      return {};
    },
    to: () => '/guide/start',
  },
  // /chapters/protocols  →  /guide/protocols
  {
    match: (p) => {
      if (p !== '/chapters/protocols') return false;
      return {};
    },
    to: () => '/guide/protocols',
  },
  // /challenge  →  / (retired: quick-start challenge chain now lives on home)
  {
    match: (p) => {
      if (p !== '/challenge') return false;
      return {};
    },
    to: () => '/',
  },
  // /note/:noteId (single segment, not playground) → /notes/:noteId
  {
    match: (p) => {
      const m = p.match(/^\/note\/(?!playground(?:$|\/))([^/]+)$/);
      if (!m || m[1] === 'playground') return false;
      return { noteId: decodeURIComponent(m[1]!) };
    },
    to: ({ noteId }) => noteByIdPath(noteId),
  },
  // /note/:category/:name  →  /c/:category/:name (legacy workout alias)
  {
    match: (p) => {
      const m = p.match(/^\/note\/(?!playground\/)([^/]+)\/([^/]+)$/);
      if (!m) return false;
      return { category: decodeURIComponent(m[1]!), name: decodeURIComponent(m[2]!) };
    },
    to: ({ category, name }) => workoutPath(category, name),
  },
  // /tracker/:runtimeId  →  /run/:runtimeId
  {
    match: (p) => {
      const m = p.match(/^\/tracker\/([^/]+)$/);
      if (!m) return false;
      return { runtimeId: decodeURIComponent(m[1]!) };
    },
    to: ({ runtimeId }) => runPath(runtimeId),
  },
  // /plan  →  /journal?mode=plan
  // Preserve as an alias so external links, command palettes, and bookmarks
  // resolve cleanly; /journal itself redirects on to the unified Library.
  {
    match: (p) => {
      if (p !== '/plan') return false
      return {}
    },
    to: () => '/journal?mode=plan',
  },
];

/**
 * Resolve a pathname against the redirect matrix.
 *
 * @returns The canonical destination string, or `null` when no alias matches.
 */
export function resolveRedirect(pathname: string): string | null {
  for (const rule of ROUTE_REDIRECTS) {
    const params = rule.match(pathname);
    if (params !== false) {
      return rule.to(params);
    }
  }


  return null;

}

// ---------------------------------------------------------------------------
// Route-category helpers (used by navigation UI)
// ---------------------------------------------------------------------------

/** Detect whether a location pathname belongs to the playground note family. */
export function isPlaygroundNotePath(pathname: string): boolean {
  return pathname.startsWith('/playground/') || pathname.startsWith('/note/playground/');
}

/** Detect whether a location pathname belongs to the journal entry family. */
export function isJournalEntryPath(pathname: string): boolean {
  return pathname.startsWith('/journal/') && pathname !== '/journal' && pathname !== '/journal/';
}

/** Detect whether a location pathname belongs to the tracker/run family. */
export function isTrackerPath(pathname: string): boolean {
  return pathname.startsWith('/tracker/') || pathname.startsWith('/run/');
}

/** Detect whether a location pathname belongs to the collection workout family. */
export function isCollectionWorkoutPath(pathname: string): boolean {
  if (pathname.startsWith('/c/')) return pathname.split('/').length >= 4 && pathname.split('/')[3] !== '';
  return pathname.startsWith('/collections/') && pathname.split('/').length >= 4 && pathname.split('/')[3] !== '';
}

/** Detect whether a location pathname belongs to the efforts family. */
export function isEffortsPath(pathname: string): boolean {
  return pathname === '/efforts' || pathname.startsWith('/effort/') || pathname.startsWith('/e/');
}

/** Detect whether a location pathname belongs to the equipment family (list + detail). */
export function isEquipmentPath(pathname: string): boolean {
  return pathname === '/equipment' || pathname.startsWith('/equipment/');
}

/** Detect whether a location pathname belongs to the effort family. */
export function isEffortPath(pathname: string): boolean {
  return pathname.startsWith('/effort/') || pathname.startsWith('/e/') || pathname === '/efforts';
}

/** Detect whether a location pathname belongs to the ai-first family. */
export function isAiFirstPath(pathname: string): boolean {
  return pathname === '/ai-first' || pathname.startsWith('/ai-first/');
}

/**
 * Capture the three segments of `/feeds/:feedSlug/:feedDate/:feedItem`.
 * Returns `[feedSlug, feedDate, feedItem]` (raw, URL-encoded) or `null` if
 * the pathname is not a feed-item path. `AppContent` uses this because
 * `useParams` only captures generic `{category, name, id}`.
 */
export function matchFeedItem(pathname: string): [string, string, string] | null {
  const m = pathname.match(/^\/feeds\/([^/]+)\/([^/]+)\/([^/]+)$/);
  return m ? [m[1]!, m[2]!, m[3]!] : null;
}

/**
 * Capture the slug of `/feeds/:feedSlug`. Returns the slug or `null` if
 * the pathname is not a feed-detail path. Does not match feed-item paths
 * (those are 3-segment, this is 1-segment) — caller checks `matchFeedItem`
 * first if both may match.
 */
export function matchFeedDetail(pathname: string): string | null {
  const m = pathname.match(/^\/feeds\/([^/]+)$/);
  return m ? m[1]! : null;
}

