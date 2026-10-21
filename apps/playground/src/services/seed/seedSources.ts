/**
 * Custom seed sources — community libraries the user registers on
 * /settings/sync. Persisted in localStorage and merged into
 * defaultSeedSources() so every sync path (boot, manual, status) sees them.
 * Custom sources never auto-import at boot (autoImport: false) and carry
 * embeddedVersion 0 — never fast-pathable, the manifest is consulted on
 * every sync. Also home to the built-in community demo feeds (real
 * components of the wod-wiki-community corpus). Type-only dependency on
 * seedSync keeps the runtime graph acyclic (seedSync imports this module's
 * values).
 */
import type { ISeedSource } from './ISeedSource';
import type { SeedManifest } from '@/types/seed';

/** Shape persisted in localStorage — a seed dir URL serving the standard
 *  manifest/chunks layout (see HttpSeedSource). */
export interface CustomSeedSource {
  id: string;
  label: string;
  /** Absolute http(s) URL of the seed dir, trailing slash included. */
  url: string;
  /** Optional published Git repository link (manifest `repositoryUrl`). */
  repositoryUrl?: string;
}

const STORAGE_KEY = 'wodwiki.seedSources';
const HIDDEN_KEY = 'wodwiki.seedSources.hidden';

/**
 * Strict seed-dir URL: absolute http(s), no query/hash, no embedded
 * credentials, trailing slash. Returns null when the input is not a usable
 * seed directory URL — every registry membership check and registration
 * flows through this, so `host/seed` and `HTTPS://Host/seed/` are the same
 * source and `https://user@host/` never registers.
 */
export function normalizeSeedSourceUrl(url: string): string | null {
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
 *  than the seed-dir URL itself. */
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

/** Same-origin seed dir of the bundled core source (HttpSeedSource concatenates file names). */
export const CORE_SEED_URL = `${import.meta.env.BASE_URL}seed/core/`;
/** Community corpus, published by wod-wiki-community's pipeline to its repo Pages. */
export const COMMUNITY_SEED_URL =
  import.meta.env.VITE_COMMUNITY_SEED_URL ?? 'https://bitcobblers.github.io/wod-wiki-community/';

function readAll(): CustomSeedSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((s): CustomSeedSource[] => {
      if (!s || typeof s !== 'object' ||
        typeof (s as CustomSeedSource).id !== 'string' ||
        typeof (s as CustomSeedSource).label !== 'string' ||
        typeof (s as CustomSeedSource).url !== 'string') return [];
      const { repositoryUrl } = s as CustomSeedSource;
      // Persisted metadata is untrusted input: an invalid external link
      // (e.g. `javascript:`) is dropped, never handed to the UI as href.
      const safeLink = typeof repositoryUrl === 'string' ? safeRepositoryUrl(repositoryUrl) : null;
      const clean: CustomSeedSource = { id: (s as CustomSeedSource).id, label: (s as CustomSeedSource).label, url: (s as CustomSeedSource).url };
      return [safeLink ? { ...clean, repositoryUrl: safeLink } : clean];
    });
  } catch {
    return [];
  }
}

/** Registered custom sources, storage order. */
export function customSeedSources(): CustomSeedSource[] {
  return readAll();
}

/** Names the URL→id formula: lowercase, non-alphanumerics collapse to one
 *  dash, trimmed dashes; empty input degenerates to 'source'. */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}

/**
 * Register a community library. The URL must be an absolute http(s) seed
 * directory; it is strictly normalized (see normalizeSeedSourceUrl) and
 * duplicates are rejected on the normalized form. `metadata.repositoryUrl`
 * (the manifest's published Git link) must itself be an absolute http(s)
 * URL. The seed id namespaces the storage checkpoint — renaming later
 * would orphan the imported content, so the id is fixed at registration.
 */
export function addCustomSeedSource(label: string, url: string, metadata?: { repositoryUrl?: string }): CustomSeedSource {
  const normalized = normalizeSeedSourceUrl(url);
  if (!normalized) {
    throw new Error('Enter an absolute http(s) URL of a seed directory.');
  }
  const list = readAll();
  if (list.some((s) => normalizeSeedSourceUrl(s.url) === normalized)) {
    throw new Error('This source is already registered.');
  }
  // A seed dir already served by a built-in source (bundled core or the
  // community corpus) reuses that identity via defaultSeedSources() — it
  // never registers a duplicate custom spec beside it.
  if ([CORE_SEED_URL, COMMUNITY_SEED_URL].some((u) => normalizeSeedSourceUrl(u) === normalized)) {
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
  const taken: Record<string, true> = { ...RESERVED_SEED_SOURCE_IDS };
  for (const s of list) taken[s.id] = true;
  let id = slugify(cleanLabel);
  for (let n = 2; taken[id]; n++) id = `${slugify(cleanLabel)}-${n}`;
  const entry: CustomSeedSource = { id, label: cleanLabel, url: normalized, ...(repositoryUrl ? { repositoryUrl } : {}) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...list, entry]));
  return entry;
}

/** Unregister a source. The storage checkpoint and imported notes stay —
 *  removing a source only removes it from sync runs and the status list. */
export function removeCustomSeedSource(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readAll().filter(s => s.id !== id)));
}

/** Built-in ids a Delete can hide from the sync/catalog surfaces (core is
 *  protected and never hideable; custom sources leave via the registry). */
export function builtInSeedSourceIds(): string[] {
  return ['community', ...SYNC_PACKAGES.map((p) => p.id)];
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
export function hideSeedSourceRow(id: string): void {
  const hidden = readHidden();
  if (builtInSeedSourceIds().includes(id) && !hidden.includes(id)) {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden, id]));
  }
}

/** Built-in source ids hidden by an explicit Delete. */
export function hiddenSeedSourceIds(): string[] {
  return readHidden();
}

/** The wod-wiki-community content repository — source of every community feed. */
export const COMMUNITY_REPOSITORY_URL = 'https://github.com/bitcobblers/wod-wiki-community';

/** A package source is where the files are hosted (e.g. Common or custom mirrors). */
export interface PackageSource {
  id: string;
  label: string;
  url: string;
  repositoryUrl?: string;
  description?: string;
}

/** An individual package — a category/directory unit within a package source. */
export interface SyncPackage {
  id: string;
  chunkId: string;
  label: string;
  category: string;
  description: string;
  sourceId: string;
  sourceLabel: string;
  repositoryUrl?: string;
  /** The published seed dir this package syncs from (its own repo's Pages). */
  seedUrl: string;
  /** Boot auto-import gate override; absent → false (manual subscribe). */
  autoImport?: boolean;
}

/**
 * The split corpus: one repo per theme, each publishing its own seed dir to
 * GitHub Pages and syncing as an independent source (own manifest/version/
 * checkpoint). Repos live under SergeiGolos until moved to bitcobblers —
 * the move is a host flip here, nothing else.
 */
export interface SeedRepoDef {
  id: string;
  label: string;
  seedUrl: string;
  repositoryUrl: string;
  description: string;
}

const SEED_REPO_HOST = 'https://sergeigolos.github.io';
function seedRepo(id: string, label: string, name: string, description: string): SeedRepoDef {
  return {
    id,
    label,
    seedUrl: `${SEED_REPO_HOST}/${name}/`,
    repositoryUrl: `https://github.com/SergeiGolos/${name}`,
    description,
  };
}

export const SEED_REPOS: SeedRepoDef[] = [
  seedRepo('seed-core', 'Core Registry', 'wod-wiki-seed-core', 'Shared effort and equipment registries plus prebuilt WQL dashboards.'),
  seedRepo('seed-crossfit', 'CrossFit', 'wod-wiki-seed-crossfit', 'CrossFit benchmark collections (Games, Girls, Heroes) and weekly programming.'),
  seedRepo('seed-hyrox', 'HYROX', 'wod-wiki-seed-hyrox', 'HYROX race preparation and simulation workouts.'),
  seedRepo('seed-kettlebell', 'Kettlebell Coaches', 'wod-wiki-seed-kettlebell', 'Kettlebell coach collections and the Dan John 40-Day Program feed.'),
  seedRepo('seed-swimming', 'Swimming', 'wod-wiki-seed-swimming', 'Swimming programs from pre-highschool through college, masters, Olympic, and triathlete.'),
  seedRepo('seed-track', 'Track & Field', 'wod-wiki-seed-track', 'High-school track programs — 400m (Raffensperger) and sprints (Arrowhead).'),
  seedRepo('seed-zombie-fit', 'ZombieFit', 'wod-wiki-seed-zombie-fit', 'The ZombieFit parkour archive — daily WODs since 2009.'),
  seedRepo('seed-golos-method', 'Golos Method', 'wod-wiki-seed-golos-method', 'Daily minimalist strength and conditioning.'),
  seedRepo('yt-dan-john', 'Dan John', 'wod-wiki-youtube-dan-john', 'Dan John kettlebell workouts.'),
  seedRepo('yt-mark-wildman', 'Mark Wildman', 'wod-wiki-youtube-mark-wildman', 'Mark Wildman athletic kettlebell and club training.'),
  seedRepo('yt-strongfirst', 'StrongFirst', 'wod-wiki-youtube-strongfirst', 'StrongFirst hardstyle kettlebell workouts.'),
  seedRepo('yt-the-stone-circle', 'The Stone Circle', 'wod-wiki-youtube-the-stone-circle', 'Sandbag power-endurance and density training.'),
  seedRepo('example-movement', 'Movement Examples', 'wod-wiki-example-movement', 'Unconventional and parkour-style training examples.'),
  seedRepo('example-yoga', 'Yoga Examples', 'wod-wiki-example-yoga', 'Yoga session examples.'),
  seedRepo('r-workoutroutines', 'r/WorkoutRoutines', 'wod-wiki-r-workoutroutines', 'Community feed from the r/WorkoutRoutines subreddit.'),
];

function byId(id: string): SeedRepoDef {
  const repo = SEED_REPOS.find((r) => r.id === id);
  if (!repo) throw new Error(`unknown seed repo: ${id}`);
  return repo;
}

function pkg(repoId: string, slug: string, chunkId: string, label: string, category: string, description: string, autoImport?: boolean): SyncPackage {
  const src = byId(repoId);
  return {
    id: `community-${slug}`,
    chunkId,
    label,
    category,
    description,
    sourceId: src.id,
    sourceLabel: src.label,
    repositoryUrl: src.repositoryUrl,
    seedUrl: src.seedUrl,
    ...(autoImport ? { autoImport } : {}),
  };
}

/**
 * Built-in packages, one per published notebook. Package ids are permanent:
 * they key the sync checkpoint (`seed:<id>`) and any stored subscription, so
 * a notebook moving between repos keeps its id and only its seedUrl changes.
 * Chunk ids mirror the corpus layout (collection.<slug> / feed.<slug>) and
 * never change either.
 */
export const SYNC_PACKAGES: SyncPackage[] = [
  // Core registry (reference data — imports at boot like the bundled core,
  // workouts resolve efforts/equipment against it).
  pkg('seed-core', 'efforts', 'efforts', 'Effort Registry', 'efforts', 'The shared effort registry — movement definitions workouts resolve against.', true),
  pkg('seed-core', 'equipment', 'equipment', 'Equipment Registry', 'equipment', 'The shared equipment registry resolved against workout programming.', true),
  pkg('seed-core', 'dashboards', 'dashboards', 'Common Dashboards', 'dashboards', 'Prebuilt WQL analytics dashboards tracking training volume, intensity distribution, and movement frequency.'),
  // CrossFit
  pkg('seed-crossfit', 'crossfit-games', 'collection.crossfit-games', 'CrossFit Games', 'collections', 'CrossFit Games workouts — Open, Regionals, and Games programming, formatted for Wod Wiki.'),
  pkg('seed-crossfit', 'crossfit-girls', 'collection.crossfit-girls', 'CrossFit Girls', 'collections', 'Classic benchmark workouts — Fran, Helen, Grace, Diane, and more, formatted for Wod Wiki.'),
  pkg('seed-crossfit', 'crossfit-heroes', 'collection.crossfit-heroes', 'CrossFit Heroes', 'collections', 'Hero benchmark workouts honoring service members — Murph, DT, Badger, and more.'),
  pkg('seed-crossfit', 'crossfit-programming', 'feed.crossfit-programming', 'CrossFit Programming', 'feeds', 'Weekly CrossFit programming — daily strength, conditioning, and skill sessions on a rotation with a weekly benchmark.'),
  // HYROX
  pkg('seed-hyrox', 'hyrox', 'collection.hyrox', 'HYROX', 'collections', 'HYROX race preparation — running, sled work, ergs, and functional stations in race format.'),
  // Kettlebell coaches
  pkg('seed-kettlebell', 'geoff-neupert', 'collection.geoff-neupert', 'Geoff Neupert', 'collections', 'Geoff Neupert kettlebell workouts — strength and conditioning from a Master SFG coach.'),
  pkg('seed-kettlebell', 'girevoy-sport', 'collection.girevoy-sport', 'Girevoy Sport', 'collections', 'Competitive kettlebell sport — jerk, snatch, and long-cycle programming.'),
  pkg('seed-kettlebell', 'joe-daniels', 'collection.joe-daniels', 'Joe Daniels (Swing This)', 'collections', 'Joe Daniels kettlebell workouts — kettlebell sport and hardstyle fusion.'),
  pkg('seed-kettlebell', 'keith-weber', 'collection.keith-weber', 'Keith Weber', 'collections', 'Keith Weber kettlebell workouts — high-intensity kettlebell cardio.'),
  pkg('seed-kettlebell', 'steve-cotter', 'collection.steve-cotter', 'Steve Cotter', 'collections', 'Steve Cotter kettlebell workouts — comprehensive kettlebell education.'),
  pkg('seed-kettlebell', 'dan-john-40-day', 'feed.dan-john-40-day', 'Dan John 40-Day Program', 'feeds', "Dan John's 40-day barbell program — five lifts, five sets of five, five days a week for 40 sessions."),
  // YouTube-sourced coach libraries
  pkg('yt-dan-john', 'dan-john', 'collection.dan-john', 'Dan John Kettlebell', 'collections', 'Dan John kettlebell workouts — simple, effective programming with clear objectives.'),
  pkg('yt-mark-wildman', 'mark-wildman', 'collection.mark-wildman', 'Mark Wildman', 'collections', 'Mark Wildman workouts — athletic kettlebell and club training.'),
  pkg('yt-strongfirst', 'strongfirst', 'collection.strongfirst', 'StrongFirst', 'collections', 'StrongFirst workouts — hardstyle kettlebell strength and skill.'),
  pkg('yt-the-stone-circle', 'the-stone-circle', 'collection.the-stone-circle', 'The Stone Circle', 'collections', 'Sandbag power endurance and density training — progressive EMOM protocols.'),
  // Swimming
  pkg('seed-swimming', 'swimming-college', 'collection.swimming-college', 'Swimming: College', 'collections', 'College swimming training sessions.'),
  pkg('seed-swimming', 'swimming-highschool', 'collection.swimming-highschool', 'Swimming: High School', 'collections', 'High-school swimming training sessions.'),
  pkg('seed-swimming', 'swimming-masters', 'collection.swimming-masters', 'Swimming: Masters', 'collections', 'Masters swimming training sessions.'),
  pkg('seed-swimming', 'swimming-olympic', 'collection.swimming-olympic', 'Swimming: Olympic', 'collections', 'Olympic-caliber swimming training sessions.'),
  pkg('seed-swimming', 'swimming-post-college', 'collection.swimming-post-college', 'Swimming: Post-College', 'collections', 'Post-college swimming training sessions.'),
  pkg('seed-swimming', 'swimming-pre-highschool', 'collection.swimming-pre-highschool', 'Swimming: Pre-Highschool', 'collections', 'Pre-highschool swimming training sessions.'),
  pkg('seed-swimming', 'swimming-triathlete', 'collection.swimming-triathlete', 'Swimming: Triathlete', 'collections', 'Triathlete swim training sessions.'),
  // Track
  pkg('seed-track', 'hs-track-400m', 'collection.hs-track-400m', 'HS Track 400m', 'collections', 'High-school 400m program after Raffensperger — speed, tempo, and strength phases.'),
  pkg('seed-track', 'hs-track-sprints', 'collection.hs-track-sprints', 'HS Track Sprints', 'collections', 'High-school sprints program after Arrowhead — acceleration, maximum velocity, and speed endurance.'),
  // Movement / lifestyle
  pkg('seed-zombie-fit', 'zombiefit', 'collection.zombiefit', 'ZombieFit', 'collections', 'The ZombieFit archive — parkour-inspired fitness WODs, 2009–2013.'),
  pkg('seed-golos-method', 'the-golos-method', 'collection.the-golos-method', 'The Golos Method', 'collections', 'Daily minimalist strength and conditioning — dense, repeatable sessions.'),
  pkg('example-movement', 'unconventional', 'collection.unconventional', 'Unconventional', 'collections', 'Unconventional training — maces, clubs, sandbags, and parkour movement.'),
  pkg('example-yoga', 'yoga', 'collection.yoga', 'Yoga', 'collections', 'Yoga sessions for mobility and recovery.'),
  // Reddit feeds
  pkg('r-workoutroutines', 'workoutroutines-reddit', 'feed.workoutroutines-reddit', 'r/WorkoutRoutines', 'feeds', 'Community workouts from the r/WorkoutRoutines subreddit.'),
];

/** Package sources = the split seed repos (+ user-registered customs). */
export function listPackageSources(): PackageSource[] {
  return [
    ...SEED_REPOS.map((r) => ({ id: r.id, label: r.label, url: r.seedUrl, repositoryUrl: r.repositoryUrl, description: r.description })),
    ...customSeedSources().map((c) => ({
      id: c.id,
      label: c.label,
      url: c.url,
      description: `Custom package source synced from ${c.url}`,
    })),
  ];
}

/** Returns all syncable packages across package sources. */
export function listSyncPackages(): SyncPackage[] {
  const list = [...SYNC_PACKAGES];
  for (const src of customSeedSources()) {
    list.push({
      id: src.id,
      chunkId: src.id,
      label: src.label,
      category: 'custom',
      sourceId: src.id,
      sourceLabel: src.label,
      description: `Custom package synced from ${src.url}`,
      seedUrl: src.url,
    });
  }
  return list;
}

/** A built-in community feed surfaced on the home Community feeds section. */
export interface DemoSeedSource {
  id: string;
  label: string;
  url: string;
  description: string;
  repositoryUrl: string;
}

/** One component of the published community corpus: the manifest's
 *  `feed.<name>` chunk plus the metadata the home card renders. */
export interface CommunityFeedDef {
  id: string;
  chunkId: string;
  label: string;
  description: string;
}

/**
 * The two demo feeds — real components of the split corpus (each published
 * by its own repo: `feed.crossfit-programming` in wod-wiki-seed-crossfit,
 * `feed.dan-john-40-day` in wod-wiki-seed-kettlebell). FeedSeedSource
 * filters the manifest so each button downloads only its own chunk.
 */
export const COMMUNITY_FEEDS: CommunityFeedDef[] = [
  {
    id: 'community-crossfit-programming',
    chunkId: 'feed.crossfit-programming',
    label: 'CrossFit Programming',
    description: 'Weekly CrossFit programming — daily strength, conditioning, and skill sessions on a push/pull/hinge/squat rotation with a benchmark or chipper each week (60–75 min per session).',
  },
  {
    id: 'community-dan-john-40-day',
    chunkId: 'feed.dan-john-40-day',
    label: 'Dan John 40-Day Program',
    description: "Dan John's 40-day barbell program (from *Can You Go?*, 2014) — five lifts, five sets of five, five days a week for 40 sessions.",
  },
];

/** Ids owned by the built-in feeds — addCustomSeedSource must never issue them. */
const RESERVED_SEED_SOURCE_IDS: Record<string, true> = Object.fromEntries([
  ['core', true] as const,
  ['community', true] as const,
  ['common', true] as const,
  ...COMMUNITY_FEEDS.map((feed) => [feed.id, true] as const),
  ...SYNC_PACKAGES.map((pkg) => [pkg.id, true] as const),
]);

/**
 * A filtered view of a published seed directory exposing only ONE
 * `feed.<name>` manifest chunk, so a feed sync downloads just that
 * component instead of the whole community corpus. Note identity is
 * path-derived (seedNoteId) and the `feed:` sourceId family is shared
 * with a full community import, so a feed and the library-wide community
 * source never double-own a row — only their checkpoints
 * (`seed:<sourceId>`) are disjoint.
 */
export class FeedSeedSource implements ISeedSource {
  constructor(
    private readonly inner: ISeedSource,
    /** Exact manifest chunk id, e.g. 'feed.crossfit-programming'. */
    readonly chunkId: string,
  ) {}

  async fetchManifest(): Promise<SeedManifest> {
    const manifest = await this.inner.fetchManifest();
    return { ...manifest, chunks: manifest.chunks.filter((chunk) => chunk.id === this.chunkId) };
  }

  fetchChunk(path: string) {
    return this.inner.fetchChunk(path);
  }
}

/** The home Community feeds cards — same shape the home component renders. */
export function demoSeedSources(): DemoSeedSource[] {
  return COMMUNITY_FEEDS.map((feed) => {
    const pkg = SYNC_PACKAGES.find((p) => p.id === feed.id);
    return {
      id: feed.id,
      label: feed.label,
      url: pkg?.seedUrl ?? COMMUNITY_SEED_URL,
      description: feed.description,
      repositoryUrl: pkg?.repositoryUrl ?? COMMUNITY_REPOSITORY_URL,
    };
  });
}
