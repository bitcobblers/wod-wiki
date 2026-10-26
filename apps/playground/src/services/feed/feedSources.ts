/**
 * The feed registry: which feeds exist, what each publishes, and the
 * user-registered custom feeds (persisted in localStorage and merged into
 * defaultFeedSources() so every sync path — boot, manual, status — sees
 * them).
 *
 * A FEED is the import/subscription unit: one published directory, one
 * manifest, one checkpoint, one Subscribe. A NOTEBOOK is a single chunk
 * inside a feed — the library surfaces list them, they are never synced on
 * their own. Custom feeds never auto-import at boot (autoImport absent)
 * and carry embeddedVersion 0 — never fast-pathable, the manifest is
 * consulted on every sync. Type-only dependency on feedSync keeps the
 * runtime graph acyclic (feedSync imports this module's values).
 */
import type { FeedId } from '@bitcobblers/wod-wiki-core';
import type { SeedPrecedenceTier } from '@/types/seed';

/** Shape persisted in localStorage — a feed directory URL serving the
 *  standard manifest/chunks layout (see HttpFeedSource). */
export interface CustomFeedSource {
  id: string;
  label: string;
  /** Absolute http(s) URL of the feed directory, trailing slash included. */
  url: string;
  /** Optional published Git repository link (manifest `repositoryUrl`). */
  repositoryUrl?: string;
}

const STORAGE_KEY = 'wodwiki.seedSources';
const HIDDEN_KEY = 'wodwiki.seedSources.hidden';

/**
 * Strict feed-directory URL: absolute http(s), no query/hash, no embedded
 * credentials, trailing slash. Returns null when the input is not a usable
 * feed directory URL — every registry membership check and registration
 * flows through this, so `host/feed` and `HTTPS://Host/feed/` are the same
 * feed and `https://user@host/` never registers.
 */
export function normalizeFeedUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username || parsed.password || parsed.search || parsed.hash
  ) {
    return null;
  }
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed.toString();
}

/** Published external link: absolute HTTPS, no credentials/query/hash —
 *  rendered as a user-facing href, so it is held to a stricter boundary
 *  than the feed-directory URL itself. */
export function safeRepositoryUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return parsed.toString();
}

/** Same-origin directory of the bundled core feed (HttpFeedSource concatenates file names). */
export const CORE_FEED_URL = `${import.meta.env.BASE_URL}seed/core/`;

/**
 * Same-origin feed directory URL resolved against the document base. The
 * feed sync worker resolves relative URLs against the worker script URL (/assets/), not
 * the page — a relative BASE_URL ('./' in static Storybook builds) would 404
 * there. Resolving against the document keeps both on the same directory.
 * Non-DOM environments (tests, SSR) keep the raw URL.
 */
export function toAbsoluteFeedUrl(url: string, base?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const resolvedBase = base ?? (typeof document !== 'undefined' ? document.baseURI : undefined);
  if (!resolvedBase) return url;
  try {
    return new URL(url, resolvedBase).href;
  } catch {
    return url;
  }
}

function readAll(): CustomFeedSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((s): CustomFeedSource[] => {
      if (!s || typeof s !== 'object' ||
        typeof (s as CustomFeedSource).id !== 'string' ||
        typeof (s as CustomFeedSource).label !== 'string' ||
        typeof (s as CustomFeedSource).url !== 'string') return [];
      const { repositoryUrl } = s as CustomFeedSource;
      // Persisted metadata is untrusted input: an invalid external link
      // (e.g. `javascript:`) is dropped, never handed to the UI as href.
      const safeLink = typeof repositoryUrl === 'string' ? safeRepositoryUrl(repositoryUrl) : null;
      const clean: CustomFeedSource = { id: (s as CustomFeedSource).id, label: (s as CustomFeedSource).label, url: (s as CustomFeedSource).url };
      return [safeLink ? { ...clean, repositoryUrl: safeLink } : clean];
    });
  } catch {
    return [];
  }
}

/** Registered custom sources, storage order. */
export function customFeedSources(): CustomFeedSource[] {
  return readAll();
}

/** Names the URL→id formula: lowercase, non-alphanumerics collapse to one
 *  dash, trimmed dashes; empty input degenerates to 'source'. */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}

/**
 * Register a community library. The URL must be an absolute http(s) feed
 * directory; it is strictly normalized (see normalizeFeedUrl) and
 * duplicates are rejected on the normalized form. `metadata.repositoryUrl`
 * (the manifest's published Git link) must itself be an absolute http(s)
 * URL. The feed id namespaces the storage checkpoint — renaming later
 * would orphan the imported content, so the id is fixed at registration.
 */
export function addCustomFeedSource(label: string, url: string, metadata?: { repositoryUrl?: string }): CustomFeedSource {
  const normalized = normalizeFeedUrl(url);
  if (!normalized) {
    throw new Error('Enter an absolute http(s) URL of a feed directory.');
  }
  const list = readAll();
  if (list.some((s) => normalizeFeedUrl(s.url) === normalized)) {
    throw new Error('This source is already registered.');
  }
  // A directory a built-in feed already serves (the bundled core, or one of
  // the split corpus repos) is that feed — a custom entry beside it would
  // duplicate its identity and checkpoint.
  if (builtInFeedUrls().includes(normalized)) {
    throw new Error('This source is already registered.');
  }
  const rawRepositoryUrl = metadata?.repositoryUrl?.trim();
  let repositoryUrl: string | undefined;
  if (rawRepositoryUrl) {
    repositoryUrl = safeRepositoryUrl(rawRepositoryUrl) ?? undefined;
    if (!repositoryUrl) {
      throw new Error('Enter an absolute https repository URL without credentials.');
    }
  }
  const cleanLabel = label.trim() || (() => { try { return new URL(normalized).hostname; } catch { return 'Source'; } })();
  // Static string-keyed uniqueness table — the source ids already issued,
  // plus the built-in feed ids below (a custom slug collision would hijack
  // a feed's checkpoint namespace, so reserved ids get a suffix instead).
  const taken: Record<string, true> = { ...RESERVED_FEED_SOURCE_IDS };
  for (const s of list) taken[s.id] = true;
  let id = slugify(cleanLabel);
  for (let n = 2; taken[id]; n++) id = `${slugify(cleanLabel)}-${n}`;
  const entry: CustomFeedSource = { id, label: cleanLabel, url: normalized, ...(repositoryUrl ? { repositoryUrl } : {}) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...list, entry]));
  return entry;
}

/** Unregister a source. The storage checkpoint and imported notes stay —
 *  removing a source only removes it from sync runs and the status list. */
export function removeCustomFeedSource(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readAll().filter(s => s.id !== id)));
}

/** Built-in feed ids a Delete can hide from the sync/catalog surfaces (core is
 *  protected and never hideable; custom feeds leave via the registry). */
export function builtInFeedSourceIds(): string[] {
  return FEED_SOURCES.map((s) => s.id);
}

function readHidden(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? 'null');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Hide a built-in source row (Delete of a built-in catalog whose config
 *  lives in code, not localStorage). Idempotent; custom ids are ignored. */
export function hideFeedSourceRow(id: string): void {
  // A pre-feed-unit notebook id hides the feed that publishes it.
  const feedId = feedIdForLegacyId(id);
  const hidden = readHidden();
  if (builtInFeedSourceIds().includes(feedId) && !hidden.includes(feedId)) {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden, feedId]));
  }
}

/**
 * Built-in ids hidden by an explicit Delete, folded onto the feed unit: a
 * build that synced one notebook at a time (pre-feed-unit) hid a notebook id,
 * which now hides the feed that publishes it — notebooks are no longer
 * independent sync units, so there is nothing narrower to hide.
 */
export function hiddenFeedSourceIds(): string[] {
  return [...new Set(readHidden().map(feedIdForLegacyId))];
}

/** A registered feed: one published directory — a `wod build` output hosted
 *  on a repo's GitHub Pages. This is the SYNC and SUBSCRIPTION unit:
 *  subscribing imports every notebook the feed publishes, in one checkpoint
 *  (`seed:<id>`) at one published version. */
export interface FeedSource {
  /** The feed's id — the registry's single identity for this source. It
   *  namespaces the import checkpoint (`seed:<id>`), the subscription, and
   *  the built-in list. */
  id: FeedId;
  label: string;
  /** Published feed directory (absolute, trailing slash). */
  url: string;
  /** Published Git repository link. */
  repositoryUrl?: string;
  description?: string;
  /** Import at boot instead of waiting for an explicit Subscribe. */
  autoImport?: boolean;
  /** Checkpoint precedence tier: the built-in corpus ranks under user libraries. */
  tier: SeedPrecedenceTier;
}

/** One notebook a feed publishes — exactly one manifest chunk
 *  (`notebook.<slug>`, `efforts`, …). Notebook ids are
 *  permanent: they key note links, the library surfaces, and the legacy
 *  pre-feed-unit checkpoints (`seed:community-<slug>`). */
export interface NotebookDef {
  id: string;
  /** The owning feed — the import/subscription unit. */
  feedId: FeedId;
  chunkId: string;
  label: string;
  category: string;
  description: string;
}

/**
 * The app's own feed — the bundled core corpus (canvas pages, the page
 * template, the effort/equipment/dashboards reference chunks). It is a
 * registered feed like any other: an id and an import checkpoint
 * (`seed:core`).
 */
export const CORE_FEED_SOURCE: FeedSource = {
  id: 'core',
  label: 'Core',
  url: CORE_FEED_URL,
  description: 'The app\'s own corpus — guides, the page template, and the reference chunks.',
  tier: 'core',
};

const CORPUS_REPO_HOST = 'https://bitcobblers.github.io';

function feedSource(id: string, label: string, name: string, description: string, autoImport = false): FeedSource {
  return {
    id,
    label,
    url: `${CORPUS_REPO_HOST}/${name}/`,
    repositoryUrl: `https://github.com/bitcobblers/${name}`,
    description,
    tier: 'community',
    ...(autoImport ? { autoImport: true } : {}),
  };
}

/**
 * The built-in feeds: one repo per theme, each publishing its own directory
 * to GitHub Pages and syncing as an independent source (own manifest,
 * version, checkpoint, subscription). Repos live under the bitcobblers org
 * (transferred from the interim SergeiGolos account; Pages moved with them).
 */
export const FEED_SOURCES: FeedSource[] = [
  feedSource('seed-crossfit', 'CrossFit', 'wod-wiki-seed-crossfit', 'CrossFit benchmark collections (Games, Girls, Heroes) and weekly programming.'),
  feedSource('seed-hyrox', 'HYROX', 'wod-wiki-seed-hyrox', 'HYROX race preparation and simulation workouts.'),
  feedSource('seed-kettlebell', 'Kettlebell Coaches', 'wod-wiki-seed-kettlebell', 'Kettlebell coach collections and the Dan John 40-Day Program feed.'),
  feedSource('seed-swimming', 'Swimming', 'wod-wiki-seed-swimming', 'Swimming programs from pre-highschool through college, masters, Olympic, and triathlete.'),
  feedSource('seed-track', 'Track & Field', 'wod-wiki-seed-track', 'High-school track programs — 400m (Raffensperger) and sprints (Arrowhead).'),
  feedSource('seed-zombie-fit', 'ZombieFit', 'wod-wiki-seed-zombie-fit', 'The ZombieFit parkour archive — daily WODs since 2009.'),
  feedSource('seed-golos-method', 'Golos Method', 'wod-wiki-seed-golos-method', 'Daily minimalist strength and conditioning.'),
  feedSource('yt-dan-john', 'Dan John', 'wod-wiki-youtube-dan-john', 'Dan John kettlebell workouts.'),
  feedSource('yt-mark-wildman', 'Mark Wildman', 'wod-wiki-youtube-mark-wildman', 'Mark Wildman athletic kettlebell and club training.'),
  feedSource('yt-strongfirst', 'StrongFirst', 'wod-wiki-youtube-strongfirst', 'StrongFirst hardstyle kettlebell workouts.'),
  feedSource('yt-the-stone-circle', 'The Stone Circle', 'wod-wiki-youtube-the-stone-circle', 'Sandbag power-endurance and density training.'),
  feedSource('example-movement', 'Movement Examples', 'wod-wiki-example-movement', 'Unconventional and parkour-style training examples.'),
  feedSource('example-yoga', 'Yoga Examples', 'wod-wiki-example-yoga', 'Yoga session examples.'),
  feedSource('r-workoutroutines', 'r/WorkoutRoutines', 'wod-wiki-r-workoutroutines', 'Community feed from the r/WorkoutRoutines subreddit.'),
];

/** Built-in feed directories — a custom feed may not shadow one. */
export function builtInFeedUrls(): string[] {
  return [CORE_FEED_URL, ...FEED_SOURCES.map((s) => s.url)];
}

/**
 * The registered feed with this id — the registry's single lookup. It finds
 * the built-in feeds and the user-registered ones alike.
 */
export function feedSourceById(feedId: FeedId): FeedSource | undefined {
  return registeredSources().find((s) => s.id === feedId);
}

function feedById(id: string): FeedSource {
  const feed = feedSourceById(id);
  if (!feed) throw new Error(`unknown feed source: ${id}`);
  return feed;
}

function notebook(feedId: string, slug: string, chunkId: string, label: string, category: string, description: string): NotebookDef {
  feedById(feedId);
  return { id: `community-${slug}`, feedId, chunkId, label, category, description };
}

/**
 * Every notebook the built-in feeds publish, one entry per manifest chunk.
 * Notebook ids are permanent (library links, legacy checkpoints); chunk ids
 * mirror the corpus layout (`notebook.<slug>`) and never
 * change. Which feed publishes a notebook is a registry entry — the feed is
 * what imports and subscribes.
 */
export const NOTEBOOKS: NotebookDef[] = [
  // CrossFit
  notebook('seed-crossfit', 'crossfit-games', 'notebook.crossfit-games', 'CrossFit Games', 'workouts', 'CrossFit Games workouts — Open, Regionals, and Games programming, formatted for Wod Wiki.'),
  notebook('seed-crossfit', 'crossfit-girls', 'notebook.crossfit-girls', 'CrossFit Girls', 'workouts', 'Classic benchmark workouts — Fran, Helen, Grace, Diane, and more, formatted for Wod Wiki.'),
  notebook('seed-crossfit', 'crossfit-heroes', 'notebook.crossfit-heroes', 'CrossFit Heroes', 'workouts', 'Hero benchmark workouts honoring service members — Murph, DT, Badger, and more.'),
  notebook('seed-crossfit', 'crossfit-programming', 'notebook.crossfit-programming', 'CrossFit Programming', 'programs', 'Weekly CrossFit programming — daily strength, conditioning, and skill sessions on a rotation with a weekly benchmark.'),
  // HYROX
  notebook('seed-hyrox', 'hyrox', 'notebook.hyrox', 'HYROX', 'workouts', 'HYROX race preparation — running, sled work, ergs, and functional stations in race format.'),
  // Kettlebell coaches
  notebook('seed-kettlebell', 'geoff-neupert', 'notebook.geoff-neupert', 'Geoff Neupert', 'workouts', 'Geoff Neupert kettlebell workouts — strength and conditioning from a Master SFG coach.'),
  notebook('seed-kettlebell', 'girevoy-sport', 'notebook.girevoy-sport', 'Girevoy Sport', 'workouts', 'Competitive kettlebell sport — jerk, snatch, and long-cycle programming.'),
  notebook('seed-kettlebell', 'joe-daniels', 'notebook.joe-daniels', 'Joe Daniels (Swing This)', 'workouts', 'Joe Daniels kettlebell workouts — kettlebell sport and hardstyle fusion.'),
  notebook('seed-kettlebell', 'keith-weber', 'notebook.keith-weber', 'Keith Weber', 'workouts', 'Keith Weber kettlebell workouts — high-intensity kettlebell cardio.'),
  notebook('seed-kettlebell', 'steve-cotter', 'notebook.steve-cotter', 'Steve Cotter', 'workouts', 'Steve Cotter kettlebell workouts — comprehensive kettlebell education.'),
  notebook('seed-kettlebell', 'dan-john-40-day', 'notebook.dan-john-40-day', 'Dan John 40-Day Program', 'programs', "Dan John's 40-day barbell program — five lifts, five sets of five, five days a week for 40 sessions."),
  // YouTube-sourced coach libraries
  notebook('yt-dan-john', 'dan-john', 'notebook.dan-john', 'Dan John Kettlebell', 'workouts', 'Dan John kettlebell workouts — simple, effective programming with clear objectives.'),
  notebook('yt-mark-wildman', 'mark-wildman', 'notebook.mark-wildman', 'Mark Wildman', 'workouts', 'Mark Wildman workouts — athletic kettlebell and club training.'),
  notebook('yt-strongfirst', 'strongfirst', 'notebook.strongfirst', 'StrongFirst', 'workouts', 'StrongFirst workouts — hardstyle kettlebell strength and skill.'),
  notebook('yt-the-stone-circle', 'the-stone-circle', 'notebook.the-stone-circle', 'The Stone Circle', 'workouts', 'Sandbag power endurance and density training — progressive EMOM protocols.'),
  // Swimming
  notebook('seed-swimming', 'swimming-college', 'notebook.swimming-college', 'Swimming: College', 'workouts', 'College swimming training sessions.'),
  notebook('seed-swimming', 'swimming-highschool', 'notebook.swimming-highschool', 'Swimming: High School', 'workouts', 'High-school swimming training sessions.'),
  notebook('seed-swimming', 'swimming-masters', 'notebook.swimming-masters', 'Swimming: Masters', 'workouts', 'Masters swimming training sessions.'),
  notebook('seed-swimming', 'swimming-olympic', 'notebook.swimming-olympic', 'Swimming: Olympic', 'workouts', 'Olympic-caliber swimming training sessions.'),
  notebook('seed-swimming', 'swimming-post-college', 'notebook.swimming-post-college', 'Swimming: Post-College', 'workouts', 'Post-college swimming training sessions.'),
  notebook('seed-swimming', 'swimming-pre-highschool', 'notebook.swimming-pre-highschool', 'Swimming: Pre-Highschool', 'workouts', 'Pre-highschool swimming training sessions.'),
  notebook('seed-swimming', 'swimming-triathlete', 'notebook.swimming-triathlete', 'Swimming: Triathlete', 'workouts', 'Triathlete swim training sessions.'),
  // Track
  notebook('seed-track', 'hs-track-400m', 'notebook.hs-track-400m', 'HS Track 400m', 'workouts', 'High-school 400m program after Raffensperger — speed, tempo, and strength phases.'),
  notebook('seed-track', 'hs-track-sprints', 'notebook.hs-track-sprints', 'HS Track Sprints', 'workouts', 'High-school sprints program after Arrowhead — acceleration, maximum velocity, and speed endurance.'),
  // Movement / lifestyle
  notebook('seed-zombie-fit', 'zombiefit', 'notebook.zombiefit', 'ZombieFit', 'workouts', 'The ZombieFit archive — parkour-inspired fitness WODs, 2009–2013.'),
  notebook('seed-golos-method', 'the-golos-method', 'notebook.the-golos-method', 'The Golos Method', 'workouts', 'Daily minimalist strength and conditioning — dense, repeatable sessions.'),
  notebook('example-movement', 'unconventional', 'notebook.unconventional', 'Unconventional', 'workouts', 'Unconventional training — maces, clubs, sandbags, and parkour movement.'),
  notebook('example-yoga', 'yoga', 'notebook.yoga', 'Yoga', 'workouts', 'Yoga sessions for mobility and recovery.'),
  // Reddit programs
  notebook('r-workoutroutines', 'workoutroutines-reddit', 'notebook.workoutroutines-reddit', 'r/WorkoutRoutines', 'programs', 'Community workouts from the r/WorkoutRoutines subreddit.'),
];

/**
 * Every registered feed: the app's own core feed, the built-in theme
 * feeds, then the user-registered libraries (a feed directory on any host).
 */
function registeredSources(): FeedSource[] {
  return [
    CORE_FEED_SOURCE,
    ...FEED_SOURCES,
    ...customFeedSources().map((c): FeedSource => ({
      id: c.id,
      label: c.label,
      url: c.url,
      description: `Custom feed synced from ${c.url}`,
      tier: 'imported',
      ...(c.repositoryUrl ? { repositoryUrl: c.repositoryUrl } : {}),
    })),
  ];
}

/**
 * Every registered LIBRARY feed: the built-in repos, then user-registered
 * libraries (a feed directory on any host). The app's own core feed is
 * registered too (see `feedSourceById`) but is not a library entry — it
 * publishes no library notebook of its own.
 */
export function listFeedSources(): FeedSource[] {
  return registeredSources().filter((source) => source.id !== CORE_FEED_SOURCE.id);
}

/** Every notebook the registered feeds publish. A custom feed's contents are
 *  unknown until its manifest is read, so it appears as one entry — enough
 *  for the library surfaces to list what it contributes. */
export function listNotebooks(): NotebookDef[] {
  return [
    ...NOTEBOOKS,
    ...customFeedSources().map((src): NotebookDef => ({
      id: src.id,
      feedId: src.id,
      chunkId: src.id,
      label: src.label,
      category: 'custom',
      description: `Custom feed synced from ${src.url}`,
    })),
  ];
}

/** The notebooks one feed publishes. */
export function notebooksOfFeed(feedId: FeedId): NotebookDef[] {
  return listNotebooks().filter((notebook) => notebook.feedId === feedId);
}

export function notebookById(id: string): NotebookDef | undefined {
  return listNotebooks().find((notebook) => notebook.id === id);
}

/**
 * Pre-feed-unit builds synced one notebook at a time: their checkpoints
 * (`seed:community-<slug>`), subscriptions and hidden rows are keyed by
 * notebook id. Those ids fold onto the feed that publishes the notebook;
 * anything else is already a feed id and passes through.
 */
export function feedIdForLegacyId(id: string): string {
  return NOTEBOOKS.find((notebook) => notebook.id === id)?.feedId ?? id;
}

/** A demo feed promoted on the home Community feeds section. */
export interface DemoFeedSource {
  id: string;
  label: string;
  url: string;
  description: string;
  repositoryUrl: string;
}

/** The demo feeds the home community-feeds cards try in one click. */
export function demoFeedSources(): DemoFeedSource[] {
  return ['seed-crossfit', 'seed-kettlebell'].flatMap((id) => {
    const feed = feedSourceById(id);
    if (!feed) return [];
    return [{
      id: feed.id,
      label: feed.label,
      url: feed.url,
      description: feed.description ?? '',
      repositoryUrl: feed.repositoryUrl ?? '',
    }];
  });
}

/** Ids owned by the built-ins — addCustomFeedSource must never issue them.
 *  `seed-core` is the retired remote Core Registry — its id stays reserved
 *  so it can never be re-registered; its checkpoint migrates into `core`. */
const RESERVED_FEED_SOURCE_IDS: Record<string, true> = Object.fromEntries([
  ['core', true] as const,
  // Legacy namespaces: old checkpoint families, never new feeds.
  ['community', true] as const,
  ['common', true] as const,
  ['seed-core', true] as const,
  ...FEED_SOURCES.map((feed) => [feed.id, true] as const),
  ...NOTEBOOKS.map((notebook) => [notebook.id, true] as const),
]);
