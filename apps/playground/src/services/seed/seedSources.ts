/**
 * The seed registry: which seeds exist, what each publishes, and the
 * user-registered custom sources (persisted in localStorage and merged into
 * defaultSeedSources() so every sync path — boot, manual, status — sees
 * them).
 *
 * A SEED is the import/subscription unit: one published seed directory, one
 * manifest, one checkpoint, one Subscribe. A NOTEBOOK is a single chunk
 * inside a seed — the library surfaces list them, they are never synced on
 * their own. Custom sources never auto-import at boot (autoImport absent)
 * and carry embeddedVersion 0 — never fast-pathable, the manifest is
 * consulted on every sync. Type-only dependency on seedSync keeps the
 * runtime graph acyclic (seedSync imports this module's values).
 */
import type { SeedPrecedenceTier } from '@/types/seed';

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

/**
 * Same-origin seed dir URL resolved against the document base. The seed sync
 * worker resolves relative URLs against the worker script URL (/assets/), not
 * the page — a relative BASE_URL ('./' in static Storybook builds) would 404
 * there. Resolving against the document keeps both on the same directory.
 * Non-DOM environments (tests, SSR) keep the raw URL.
 */
export function toAbsoluteSeedUrl(url: string, base?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const resolvedBase = base ?? (typeof document !== 'undefined' ? document.baseURI : undefined);
  if (!resolvedBase) return url;
  try {
    return new URL(url, resolvedBase).href;
  } catch {
    return url;
  }
}

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
  // A seed dir a built-in source already serves (the bundled core, or one of
  // the split seed repos) is that source — a custom entry beside it would
  // duplicate its identity and checkpoint.
  if (builtInSeedUrls().includes(normalized)) {
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

/** Built-in seed ids a Delete can hide from the sync/catalog surfaces (core is
 *  protected and never hideable; custom sources leave via the registry). */
export function builtInSeedSourceIds(): string[] {
  return SEED_SOURCES.map((s) => s.id);
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
  // A pre-seed-unit notebook id hides the seed that publishes it.
  const seedId = seedIdForLegacyId(id);
  const hidden = readHidden();
  if (builtInSeedSourceIds().includes(seedId) && !hidden.includes(seedId)) {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden, seedId]));
  }
}

/**
 * Built-in ids hidden by an explicit Delete, folded onto the seed unit: a
 * build that synced one notebook at a time (pre-seed-unit) hid a notebook id,
 * which now hides the seed that publishes it — notebooks are no longer
 * independent sync units, so there is nothing narrower to hide.
 */
export function hiddenSeedSourceIds(): string[] {
  return [...new Set(readHidden().map(seedIdForLegacyId))];
}

/** A seed source: one published seed directory — a `wod build` output hosted
 *  on a repo's GitHub Pages. This is the SYNC and SUBSCRIPTION unit:
 *  subscribing imports every notebook the seed publishes, in one checkpoint
 *  (`seed:<id>`) at one published version. */
export interface SeedSource {
  id: string;
  label: string;
  /** Published seed directory (absolute, trailing slash). */
  url: string;
  /** Published Git repository link. */
  repositoryUrl?: string;
  description?: string;
  /** Import at boot instead of waiting for an explicit Subscribe. */
  autoImport?: boolean;
  /** Checkpoint precedence tier: the built-in corpus ranks under user libraries. */
  tier: SeedPrecedenceTier;
}

/** One notebook a seed publishes — exactly one manifest chunk
 *  (`collection.<slug>`, `feed.<slug>`, `efforts`, …). Notebook ids are
 *  permanent: they key note links, the library surfaces, and the legacy
 *  pre-seed-unit checkpoints (`seed:community-<slug>`). */
export interface NotebookDef {
  id: string;
  /** Owning seed — the import/subscription unit. */
  seedId: string;
  chunkId: string;
  label: string;
  category: string;
  description: string;
}

const SEED_REPO_HOST = 'https://bitcobblers.github.io';

function seedSource(id: string, label: string, name: string, description: string, autoImport = false): SeedSource {
  return {
    id,
    label,
    url: `${SEED_REPO_HOST}/${name}/`,
    repositoryUrl: `https://github.com/bitcobblers/${name}`,
    description,
    tier: 'community',
    ...(autoImport ? { autoImport: true } : {}),
  };
}

/**
 * The built-in seeds: one repo per theme, each publishing its own seed dir to
 * GitHub Pages and syncing as an independent source (own manifest, version,
 * checkpoint, subscription). Repos live under the bitcobblers org
 * (transferred from the interim SergeiGolos account; Pages moved with them).
 */
export const SEED_SOURCES: SeedSource[] = [
  seedSource('seed-crossfit', 'CrossFit', 'wod-wiki-seed-crossfit', 'CrossFit benchmark collections (Games, Girls, Heroes) and weekly programming.'),
  seedSource('seed-hyrox', 'HYROX', 'wod-wiki-seed-hyrox', 'HYROX race preparation and simulation workouts.'),
  seedSource('seed-kettlebell', 'Kettlebell Coaches', 'wod-wiki-seed-kettlebell', 'Kettlebell coach collections and the Dan John 40-Day Program feed.'),
  seedSource('seed-swimming', 'Swimming', 'wod-wiki-seed-swimming', 'Swimming programs from pre-highschool through college, masters, Olympic, and triathlete.'),
  seedSource('seed-track', 'Track & Field', 'wod-wiki-seed-track', 'High-school track programs — 400m (Raffensperger) and sprints (Arrowhead).'),
  seedSource('seed-zombie-fit', 'ZombieFit', 'wod-wiki-seed-zombie-fit', 'The ZombieFit parkour archive — daily WODs since 2009.'),
  seedSource('seed-golos-method', 'Golos Method', 'wod-wiki-seed-golos-method', 'Daily minimalist strength and conditioning.'),
  seedSource('yt-dan-john', 'Dan John', 'wod-wiki-youtube-dan-john', 'Dan John kettlebell workouts.'),
  seedSource('yt-mark-wildman', 'Mark Wildman', 'wod-wiki-youtube-mark-wildman', 'Mark Wildman athletic kettlebell and club training.'),
  seedSource('yt-strongfirst', 'StrongFirst', 'wod-wiki-youtube-strongfirst', 'StrongFirst hardstyle kettlebell workouts.'),
  seedSource('yt-the-stone-circle', 'The Stone Circle', 'wod-wiki-youtube-the-stone-circle', 'Sandbag power-endurance and density training.'),
  seedSource('example-movement', 'Movement Examples', 'wod-wiki-example-movement', 'Unconventional and parkour-style training examples.'),
  seedSource('example-yoga', 'Yoga Examples', 'wod-wiki-example-yoga', 'Yoga session examples.'),
  seedSource('r-workoutroutines', 'r/WorkoutRoutines', 'wod-wiki-r-workoutroutines', 'Community feed from the r/WorkoutRoutines subreddit.'),
];

/** Built-in seed directories — a custom source may not shadow one. */
export function builtInSeedUrls(): string[] {
  return [CORE_SEED_URL, ...SEED_SOURCES.map((s) => s.url)];
}

export function seedSourceById(id: string): SeedSource | undefined {
  return SEED_SOURCES.find((s) => s.id === id);
}

function seedById(id: string): SeedSource {
  const seed = seedSourceById(id);
  if (!seed) throw new Error(`unknown seed source: ${id}`);
  return seed;
}

function notebook(seedId: string, slug: string, chunkId: string, label: string, category: string, description: string): NotebookDef {
  seedById(seedId);
  return { id: `community-${slug}`, seedId, chunkId, label, category, description };
}

/**
 * Every notebook the built-in seeds publish, one entry per manifest chunk.
 * Notebook ids are permanent (library links, legacy checkpoints); chunk ids
 * mirror the corpus layout (collection.<slug> / feed.<slug>) and never
 * change. Which seed publishes a notebook is a registry entry — the seed is
 * what imports and subscribes.
 */
export const NOTEBOOKS: NotebookDef[] = [
  // CrossFit
  notebook('seed-crossfit', 'crossfit-games', 'collection.crossfit-games', 'CrossFit Games', 'collections', 'CrossFit Games workouts — Open, Regionals, and Games programming, formatted for Wod Wiki.'),
  notebook('seed-crossfit', 'crossfit-girls', 'collection.crossfit-girls', 'CrossFit Girls', 'collections', 'Classic benchmark workouts — Fran, Helen, Grace, Diane, and more, formatted for Wod Wiki.'),
  notebook('seed-crossfit', 'crossfit-heroes', 'collection.crossfit-heroes', 'CrossFit Heroes', 'collections', 'Hero benchmark workouts honoring service members — Murph, DT, Badger, and more.'),
  notebook('seed-crossfit', 'crossfit-programming', 'feed.crossfit-programming', 'CrossFit Programming', 'feeds', 'Weekly CrossFit programming — daily strength, conditioning, and skill sessions on a rotation with a weekly benchmark.'),
  // HYROX
  notebook('seed-hyrox', 'hyrox', 'collection.hyrox', 'HYROX', 'collections', 'HYROX race preparation — running, sled work, ergs, and functional stations in race format.'),
  // Kettlebell coaches
  notebook('seed-kettlebell', 'geoff-neupert', 'collection.geoff-neupert', 'Geoff Neupert', 'collections', 'Geoff Neupert kettlebell workouts — strength and conditioning from a Master SFG coach.'),
  notebook('seed-kettlebell', 'girevoy-sport', 'collection.girevoy-sport', 'Girevoy Sport', 'collections', 'Competitive kettlebell sport — jerk, snatch, and long-cycle programming.'),
  notebook('seed-kettlebell', 'joe-daniels', 'collection.joe-daniels', 'Joe Daniels (Swing This)', 'collections', 'Joe Daniels kettlebell workouts — kettlebell sport and hardstyle fusion.'),
  notebook('seed-kettlebell', 'keith-weber', 'collection.keith-weber', 'Keith Weber', 'collections', 'Keith Weber kettlebell workouts — high-intensity kettlebell cardio.'),
  notebook('seed-kettlebell', 'steve-cotter', 'collection.steve-cotter', 'Steve Cotter', 'collections', 'Steve Cotter kettlebell workouts — comprehensive kettlebell education.'),
  notebook('seed-kettlebell', 'dan-john-40-day', 'feed.dan-john-40-day', 'Dan John 40-Day Program', 'feeds', "Dan John's 40-day barbell program — five lifts, five sets of five, five days a week for 40 sessions."),
  // YouTube-sourced coach libraries
  notebook('yt-dan-john', 'dan-john', 'collection.dan-john', 'Dan John Kettlebell', 'collections', 'Dan John kettlebell workouts — simple, effective programming with clear objectives.'),
  notebook('yt-mark-wildman', 'mark-wildman', 'collection.mark-wildman', 'Mark Wildman', 'collections', 'Mark Wildman workouts — athletic kettlebell and club training.'),
  notebook('yt-strongfirst', 'strongfirst', 'collection.strongfirst', 'StrongFirst', 'collections', 'StrongFirst workouts — hardstyle kettlebell strength and skill.'),
  notebook('yt-the-stone-circle', 'the-stone-circle', 'collection.the-stone-circle', 'The Stone Circle', 'collections', 'Sandbag power endurance and density training — progressive EMOM protocols.'),
  // Swimming
  notebook('seed-swimming', 'swimming-college', 'collection.swimming-college', 'Swimming: College', 'collections', 'College swimming training sessions.'),
  notebook('seed-swimming', 'swimming-highschool', 'collection.swimming-highschool', 'Swimming: High School', 'collections', 'High-school swimming training sessions.'),
  notebook('seed-swimming', 'swimming-masters', 'collection.swimming-masters', 'Swimming: Masters', 'collections', 'Masters swimming training sessions.'),
  notebook('seed-swimming', 'swimming-olympic', 'collection.swimming-olympic', 'Swimming: Olympic', 'collections', 'Olympic-caliber swimming training sessions.'),
  notebook('seed-swimming', 'swimming-post-college', 'collection.swimming-post-college', 'Swimming: Post-College', 'collections', 'Post-college swimming training sessions.'),
  notebook('seed-swimming', 'swimming-pre-highschool', 'collection.swimming-pre-highschool', 'Swimming: Pre-Highschool', 'collections', 'Pre-highschool swimming training sessions.'),
  notebook('seed-swimming', 'swimming-triathlete', 'collection.swimming-triathlete', 'Swimming: Triathlete', 'collections', 'Triathlete swim training sessions.'),
  // Track
  notebook('seed-track', 'hs-track-400m', 'collection.hs-track-400m', 'HS Track 400m', 'collections', 'High-school 400m program after Raffensperger — speed, tempo, and strength phases.'),
  notebook('seed-track', 'hs-track-sprints', 'collection.hs-track-sprints', 'HS Track Sprints', 'collections', 'High-school sprints program after Arrowhead — acceleration, maximum velocity, and speed endurance.'),
  // Movement / lifestyle
  notebook('seed-zombie-fit', 'zombiefit', 'collection.zombiefit', 'ZombieFit', 'collections', 'The ZombieFit archive — parkour-inspired fitness WODs, 2009–2013.'),
  notebook('seed-golos-method', 'the-golos-method', 'collection.the-golos-method', 'The Golos Method', 'collections', 'Daily minimalist strength and conditioning — dense, repeatable sessions.'),
  notebook('example-movement', 'unconventional', 'collection.unconventional', 'Unconventional', 'collections', 'Unconventional training — maces, clubs, sandbags, and parkour movement.'),
  notebook('example-yoga', 'yoga', 'collection.yoga', 'Yoga', 'collections', 'Yoga sessions for mobility and recovery.'),
  // Reddit feeds
  notebook('r-workoutroutines', 'workoutroutines-reddit', 'feed.workoutroutines-reddit', 'r/WorkoutRoutines', 'feeds', 'Community workouts from the r/WorkoutRoutines subreddit.'),
];

/** Every registered seed source: the built-in repos, then user-registered
 *  libraries (a seed directory on any host). */
export function listSeedSources(): SeedSource[] {
  return [
    ...SEED_SOURCES,
    ...customSeedSources().map((c): SeedSource => ({
      id: c.id,
      label: c.label,
      url: c.url,
      description: `Custom seed synced from ${c.url}`,
      tier: 'imported',
      ...(c.repositoryUrl ? { repositoryUrl: c.repositoryUrl } : {}),
    })),
  ];
}

/** Every notebook the registered seeds publish. A custom seed's contents are
 *  unknown until its manifest is read, so it appears as one entry — enough
 *  for the library surfaces to list what it contributes. */
export function listNotebooks(): NotebookDef[] {
  return [
    ...NOTEBOOKS,
    ...customSeedSources().map((src): NotebookDef => ({
      id: src.id,
      seedId: src.id,
      chunkId: src.id,
      label: src.label,
      category: 'custom',
      description: `Custom seed synced from ${src.url}`,
    })),
  ];
}

/** The notebooks one seed publishes. */
export function notebooksOfSeed(seedId: string): NotebookDef[] {
  return listNotebooks().filter((notebook) => notebook.seedId === seedId);
}

export function notebookById(id: string): NotebookDef | undefined {
  return listNotebooks().find((notebook) => notebook.id === id);
}

/**
 * Pre-seed-unit builds synced one notebook at a time: their checkpoints
 * (`seed:community-<slug>`), subscriptions and hidden rows are keyed by
 * notebook id. Those ids fold onto the seed that publishes the notebook;
 * anything else is already a seed id and passes through.
 */
export function seedIdForLegacyId(id: string): string {
  return NOTEBOOKS.find((notebook) => notebook.id === id)?.seedId ?? id;
}

/** A demo seed promoted on the home Community feeds section. */
export interface DemoSeedSource {
  id: string;
  label: string;
  url: string;
  description: string;
  repositoryUrl: string;
}

/** The demo seeds the home community-feeds cards try in one click. */
export function demoSeedSources(): DemoSeedSource[] {
  return ['seed-crossfit', 'seed-kettlebell'].flatMap((id) => {
    const seed = seedSourceById(id);
    if (!seed) return [];
    return [{
      id: seed.id,
      label: seed.label,
      url: seed.url,
      description: seed.description ?? '',
      repositoryUrl: seed.repositoryUrl ?? '',
    }];
  });
}

/** Ids owned by the built-ins — addCustomSeedSource must never issue them. */
const RESERVED_SEED_SOURCE_IDS: Record<string, true> = Object.fromEntries([
  ['core', true] as const,
  // Legacy namespaces: old checkpoint families, never new sources. seed-core
  // is the retired remote Core Registry — its checkpoint migrates into core.
  ['community', true] as const,
  ['common', true] as const,
  ['seed-core', true] as const,
  ...SEED_SOURCES.map((seed) => [seed.id, true] as const),
  ...NOTEBOOKS.map((notebook) => [notebook.id, true] as const),
]);
