/**
 * notebookGalleryModel — pure model behind the notebook cards (home section
 * and, later, a dedicated gallery surface).
 *
 * Joins two planes of truth:
 *  - the notebook registry (`listNotebooks` — the chunks the registered seeds
 *    publish, each with a curated description), and
 *  - the locally synced seed corpus (`buildGroupings` over the seed file map
 *    — real item counts, date ranges, README-derived descriptions/covers).
 *
 * The registry always wins for identity and description (it is the review
 * surface — it renders even when nothing is imported yet); the local corpus
 * enriches stats and can override the cover image when the README declares
 * one. Pure functions only — React and storage live in the section.
 */

import { buildGroupings, type Grouping } from '@/repositories/groupings';
import { feedSourceById, type NotebookDef, type FeedSource } from '@/services/feed/feedSources';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NotebookSummary {
  /** Registry notebook id (e.g. `community-crossfit-programming`). */
  packageId: string;
  /** Owning feed id — the import/subscription unit; absent for local-only content. */
  feedId?: string;
  /** Corpus directory slug (e.g. `crossfit-programming`). */
  slug: string;
  label: string;
  /** Review description — registry copy wins, README-derived fallback. */
  description?: string;
  /** Cover image URL (README `image:` front matter), when provided. */
  image?: string;
  /** Category chips (README `category` front matter). */
  categories: string[];
  /** Package source label (e.g. `Common`, or the custom source name). */
  sourceLabel: string;
  repositoryUrl?: string;
  /** Route to the notebook's detail surface. */
  href: string;
  /** Item count from the local corpus (0 when not imported). */
  itemCount: number;
  /** Newest item date key (feeds only). */
  latestDate?: string;
  /** Oldest item date key (feeds only). */
  firstDate?: string;
  /** README prose, for a future detail-page About section. */
  readme?: string;
  /** True when the package's chunk is present in the local corpus. */
  installed: boolean;
  chunkId?: string;
  subscribed?: boolean;
}

export type NotebookSort = 'updated' | 'name' | 'size';

export interface NotebookFilter {
  /** Case-insensitive substring over label + description. */
  text?: string;
  /** Filter by specific feed id; undefined = all feeds. */
  feedId?: string;
  /** Filter by subscribed state: true = subscribed only; false = all. */
  subscribedOnly?: boolean;
}

// ── chunkId ↔ grouping mapping ─────────────────────────────────────────────

/**
 * A notebook package's chunk id encodes its corpus root:
 * `feed.<slug>` → markdown/feeds/<slug>, `collection.<slug>` →
 * markdown/collections/<slug>. Anything else is not a feed corpus notebook.
 */
export function parseNotebookChunkId(chunkId: string): { slug: string } | null {
  const feed = chunkId.match(/^feed\.(.+)$/);
  if (feed) return { slug: feed[1] };
  const collection = chunkId.match(/^collection\.(.+)$/);
  if (collection) return { slug: collection[1] };
  return null;
}

// ── Catalog builder ────────────────────────────────────────────────────────

function summarizeGrouping(root: 'feed' | 'collection', grouping: Grouping): NotebookSummary {
  const dates = grouping.items
    .map(item => item.date)
    .filter((date): date is string => !!date)
    .sort();
  return {
    packageId: `local-${root}-${grouping.id}`,
    slug: grouping.id,
    label: grouping.name,
    description: grouping.description,
    image: grouping.image,
    categories: grouping.categories,
    sourceLabel: 'Local',
    href: root === 'feed' ? `/feed/${encodeURIComponent(grouping.id)}` : `/notebook/${encodeURIComponent(grouping.id)}`,
    itemCount: grouping.items.length,
    ...(dates.length > 0
      ? { latestDate: dates[dates.length - 1], firstDate: dates[0] }
      : {}),
    ...(grouping.readme !== undefined ? { readme: grouping.readme } : {}),
    installed: true,
  };
}

/**
 * Merge the registry with the local corpus. Registry notebooks are present
 * even when their chunk has not been imported (installed=false → the card
 * renders a review state; the feed header carries the import action). Local
 * groupings with no registry entry (custom feeds synced whole) appear as
 * Local notebooks.
 */
export function buildNotebookCatalog(notebooks: readonly NotebookDef[], files: Record<string, string> | null, isSubscribed?: (feedId: string, chunkId: string) => boolean): NotebookSummary[] {
  const local: NotebookSummary[] = [];
  const bySlugKind = new Map<string, Grouping>();
  if (files) {
    for (const root of ['feed', 'collection'] as const) {
      for (const grouping of buildGroupings(root === 'feed' ? 'feeds' : 'collections', files)) {
        bySlugKind.set(`${root}:${grouping.id}`, grouping);
        local.push(summarizeGrouping(root, grouping));
      }
    }
  }

  const registry = notebooks
    .map((notebook): NotebookSummary | null => {
      const parsed = parseNotebookChunkId(notebook.chunkId);
      if (!parsed) return null;
      const root = notebook.chunkId.startsWith('feed.') ? 'feed' : 'collection';
      const grouping = bySlugKind.get(`${root}:${parsed.slug}`);
      const feed = feedSourceById(notebook.feedId);
      const dates = (grouping?.items ?? [])
        .map(item => item.date)
        .filter((date): date is string => !!date)
        .sort();
      return {
        packageId: notebook.id,
        feedId: notebook.feedId,
        chunkId: notebook.chunkId,
        slug: parsed.slug,
        label: notebook.label,
        // Registry copy wins for the review blurb; README paragraph as fallback.
        description: notebook.description || grouping?.description,
        image: grouping?.image,
        categories: grouping?.categories ?? [],
        sourceLabel: feed?.label ?? notebook.feedId,
        ...(feed?.repositoryUrl ? { repositoryUrl: feed.repositoryUrl } : {}),
        href:
          notebook.chunkId.startsWith('feed.')
            ? `/feed/${encodeURIComponent(parsed.slug)}`
            : `/notebook/${encodeURIComponent(parsed.slug)}`,
        itemCount: grouping?.items.length ?? 0,
        ...(dates.length > 0
          ? { latestDate: dates[dates.length - 1], firstDate: dates[0] }
          : {}),
        ...(grouping?.readme !== undefined ? { readme: grouping.readme } : {}),
        installed: !!grouping,
        subscribed: isSubscribed ? isSubscribed(notebook.feedId, notebook.chunkId) : true,
      };
    })
    .filter((summary): summary is NotebookSummary => summary !== null);

  const registryKeys = new Set(registry.map(summary => summary.slug));
  return [...registry, ...local.filter(summary => !registryKeys.has(summary.slug)), ...coreNotebookCatalog(files)];
}

// ── App-owned core notebooks ───────────────────────────────────────────────

/** The core feed's reference notebooks (ticket 05): delivered with the app's
 *  own seed, not published by a library feed. Item counts read straight off
 *  the corpus file map (`markdown/<slug>/…`). */
const CORE_NOTEBOOKS: ReadonlyArray<{
  slug: string; label: string; description: string; href: string; chunkId: string;
}> = [
  { slug: 'efforts', label: 'Efforts', description: 'The effort library — every effort the parser and analytics resolve, across the canonical disciplines.', href: '/efforts', chunkId: 'efforts' },
  { slug: 'equipment', label: 'Equipment', description: 'The equipment library — gear definitions the language resolves.', href: '/equipment', chunkId: 'equipment' },
  { slug: 'dashboards', label: 'Dashboards', description: 'Prebuilt WQL dashboards — query compositions ready to open.', href: '/dashboards', chunkId: 'dashboards' },
];

function coreNotebookCatalog(files: Record<string, string> | null): NotebookSummary[] {
  return CORE_NOTEBOOKS.map((notebook) => {
    const prefix = `markdown/${notebook.slug}/`;
    const paths = files
      ? Object.keys(files).filter((p) => p.startsWith(prefix) && p.endsWith('.md') && !p.endsWith('/README.md'))
      : [];
    return {
      packageId: `core-${notebook.slug}`,
      feedId: 'core',
      chunkId: notebook.chunkId,
      slug: notebook.slug,
      label: notebook.label,
      description: notebook.description,
      categories: [],
      sourceLabel: 'Core',
      href: notebook.href,
      itemCount: paths.length,
      installed: files ? paths.length > 0 : false,
      subscribed: true,
    };
  });
}

// ── Feed grouping ──────────────────────────────────────────────────────────

/** One feed with the notebooks it publishes — the library section's unit:
 *  the feed imports and subscribes as a whole, its notebooks are what a
 *  Subscribe brings. */
export interface NotebookGroup {
  /** Absent for locally discovered content no registered feed claims. */
  feed?: FeedSource;
  label: string;
  description?: string;
  url?: string;
  repositoryUrl?: string;
  notebooks: NotebookSummary[];
}

/** Group a catalog by the feed that publishes each notebook, registry order
 *  first; locally discovered notebooks (no registry entry) come last. Feeds
 *  with nothing left after filtering drop out. */
export function groupNotebooksByFeed(
  catalog: readonly NotebookSummary[],
  feeds: readonly FeedSource[],
): NotebookGroup[] {
  const byFeed: Record<string, NotebookSummary[]> = {};
  const local: NotebookSummary[] = [];
  const listed = new Set(feeds.map((feed) => feed.id));
  for (const notebook of catalog) {
    if (notebook.feedId && listed.has(notebook.feedId)) (byFeed[notebook.feedId] ??= []).push(notebook);
    else local.push(notebook);
  }
  const groups: NotebookGroup[] = [];
  for (const feed of feeds) {
    const notebooks = byFeed[feed.id];
    if (!notebooks?.length) continue;
    groups.push({
      feed,
      label: feed.label,
      ...(feed.description ? { description: feed.description } : {}),
      url: feed.url,
      ...(feed.repositoryUrl ? { repositoryUrl: feed.repositoryUrl } : {}),
      notebooks,
    });
  }
  if (local.length > 0) groups.push({ label: 'Local', notebooks: local });
  return groups;
}

// ── Feed cards ─────────────────────────────────────────────────────────────

/** One card in the library section: a FEED — the thing you subscribe to and
 *  the thing one Subscribe imports. Its notebooks are what it brings, listed
 *  on the card. */
export interface FeedSummary {
  /** Absent for locally discovered content no registered feed claims. */
  feedId?: string;
  /** Stable cover identity (the feed id). */
  slug: string;
  label: string;
  description?: string;
  /** Published feed directory. */
  url?: string;
  repositoryUrl?: string;
  /** The notebooks this feed publishes, in registry order. */
  notebooks: NotebookSummary[];
  /** Rows present locally across its notebooks (0 before an import). */
  itemCount: number;
  /** Every published notebook is present locally. */
  installed: boolean;
  subscribed?: boolean;
  /** Newest item date across its notebooks (feeds only). */
  latestDate?: string;
  /** Where an installed feed leads — the library listing. */
  href: string;
}

export interface FeedFilter {
  /** Case-insensitive substring over the feed AND its notebooks. */
  text?: string;
  /** Filter by specific feed id; undefined = all feeds. */
  feedId?: string;
  /** Filter by subscribed state: true = subscribed only; false = all. */
  subscribedOnly?: boolean;
}

/** Cards for the library section: one per feed, built from the notebook
 *  catalog (a feed with nothing to show drops out). */
export function buildFeedCatalog(
  notebooks: readonly NotebookDef[],
  files: Record<string, string> | null,
  feeds: readonly FeedSource[],
  isSubscribed?: (feedId: string, chunkId: string) => boolean,
): FeedSummary[] {
  return groupNotebooksByFeed(buildNotebookCatalog(notebooks, files, isSubscribed), feeds).map((group): FeedSummary => {
    const dates = group.notebooks
      .map((notebook) => notebook.latestDate)
      .filter((date): date is string => !!date)
      .sort();
    return {
      feedId: group.feed?.id,
      slug: group.feed?.id ?? 'local',
      label: group.label,
      ...(group.description ? { description: group.description } : {}),
      ...(group.url ? { url: group.url } : {}),
      ...(group.repositoryUrl ? { repositoryUrl: group.repositoryUrl } : {}),
      notebooks: group.notebooks,
      itemCount: group.notebooks.reduce((sum, notebook) => sum + notebook.itemCount, 0),
      installed: group.notebooks.every((notebook) => notebook.installed),
      subscribed: group.notebooks.some((notebook) => notebook.subscribed),
      ...(dates.length > 0 ? { latestDate: dates[dates.length - 1] } : {}),
      href: '/notebooks',
    };
  });
}

/** Text matches the feed or any of its notebooks. */
export function filterFeeds(catalog: readonly FeedSummary[], filter: FeedFilter): FeedSummary[] {
  const text = filter.text?.trim().toLowerCase();
  return catalog.filter((feed) => {
    if (filter.feedId && feed.feedId !== filter.feedId) return false;
    if (filter.subscribedOnly && !feed.notebooks.some((notebook) => notebook.subscribed)) return false;
    if (!text) return true;
    return (
      feed.label.toLowerCase().includes(text) ||
      (feed.description?.toLowerCase().includes(text) ?? false) ||
      feed.notebooks.some(
        (notebook) =>
          notebook.label.toLowerCase().includes(text) ||
          (notebook.description?.toLowerCase().includes(text) ?? false),
      )
    );
  });
}

export function sortFeeds(catalog: readonly FeedSummary[], sort: NotebookSort): FeedSummary[] {
  const copy = [...catalog];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.label.localeCompare(b.label));
    case 'size':
      return copy.sort((a, b) => b.itemCount - a.itemCount || a.label.localeCompare(b.label));
    case 'updated':
    default:
      // Imported seeds first (by newest item), then by name.
      return copy.sort((a, b) => {
        if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate);
        if (a.latestDate) return -1;
        if (b.latestDate) return 1;
        return a.label.localeCompare(b.label);
      });
  }
}

// ── Filter + sort ──────────────────────────────────────────────────────────

export function filterNotebooks(catalog: readonly NotebookSummary[], filter: NotebookFilter): NotebookSummary[] {
  const text = filter.text?.trim().toLowerCase();
  return catalog.filter((summary) => {
    if (filter.feedId && summary.feedId !== filter.feedId) return false;
    if (filter.subscribedOnly && !summary.subscribed) return false;
    if (!text) return true;
    return (
      summary.label.toLowerCase().includes(text) ||
      (summary.description?.toLowerCase().includes(text) ?? false)
    );
  });
}

export function sortNotebooks(catalog: readonly NotebookSummary[], sort: NotebookSort): NotebookSummary[] {
  const copy = [...catalog];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.label.localeCompare(b.label));
    case 'size':
      return copy.sort((a, b) => b.itemCount - a.itemCount || a.label.localeCompare(b.label));
    case 'updated':
    default:
      // Imported notebooks first (by newest item), then the registry
      // (alphabetical) — an uninstalled package has nothing to date yet.
      return copy.sort((a, b) => {
        if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate);
        if (a.latestDate) return -1;
        if (b.latestDate) return 1;
        return a.label.localeCompare(b.label);
      });
  }
}

// ── Monogram covers ────────────────────────────────────────────────────────

/**
 * Deterministic cover tint for notebooks without an `image:`. The slug hash
 * picks one muted solid tile (no gradients — flat color + giant initial),
 * so a given notebook keeps its identity across sessions and themes.
 */
export const MONOGRAM_TINTS = [
  'bg-rose-500/12 text-rose-600 dark:text-rose-400',
  'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  'bg-cyan-500/12 text-cyan-600 dark:text-cyan-400',
] as const;

export function monogramTint(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return MONOGRAM_TINTS[Math.abs(hash) % MONOGRAM_TINTS.length];
}

/** Display monogram for a notebook label — first alphanumeric, uppercased. */
export function monogramLetter(label: string): string {
  const match = label.match(/[a-z0-9]/i);
  return (match?.[0] ?? '•').toUpperCase();
}

// ── Display formatting ─────────────────────────────────────────────────────

/** Format a YYYY-MM-DD key for display; null when missing/invalid. */
export function formatNotebookDate(key: string | undefined): string | null {
  if (!key) return null;
  const date = new Date(`${key}T00:00:00`);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
