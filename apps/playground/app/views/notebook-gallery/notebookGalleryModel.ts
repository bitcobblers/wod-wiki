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
import { seedSourceById, type NotebookDef, type SeedSource } from '@/services/seed/seedSources';

// ── Types ──────────────────────────────────────────────────────────────────

export type NotebookKind = 'feed' | 'collection';

export interface NotebookSummary {
  /** Registry notebook id (e.g. `community-crossfit-programming`). */
  packageId: string;
  /** Owning seed id — the import/subscription unit; absent for local-only content. */
  seedId?: string;
  /** Corpus directory slug (e.g. `crossfit-programming`). */
  slug: string;
  kind: NotebookKind;
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
}

export type NotebookSort = 'updated' | 'name' | 'size';

export interface NotebookFilter {
  /** Case-insensitive substring over label + description. */
  text?: string;
  /** Restrict to one kind; undefined = all. */
  kind?: NotebookKind;
}

// ── chunkId ↔ grouping mapping ─────────────────────────────────────────────

/**
 * A notebook package's chunk id encodes its corpus root:
 * `feed.<slug>` → markdown/feeds/<slug>, `collection.<slug>` →
 * markdown/collections/<slug>. Anything else (e.g. `dashboards`) is not a
 * notebook and never appears in the gallery.
 */
export function parseNotebookChunkId(chunkId: string): { kind: NotebookKind; slug: string } | null {
  const feed = chunkId.match(/^feed\.(.+)$/);
  if (feed) return { kind: 'feed', slug: feed[1] };
  const collection = chunkId.match(/^collection\.(.+)$/);
  if (collection) return { kind: 'collection', slug: collection[1] };
  return null;
}

// ── Catalog builder ────────────────────────────────────────────────────────

function summarizeGrouping(kind: NotebookKind, grouping: Grouping): NotebookSummary {
  const dates = grouping.items
    .map(item => item.date)
    .filter((date): date is string => !!date)
    .sort();
  return {
    packageId: `local-${kind}-${grouping.id}`,
    slug: grouping.id,
    kind,
    label: grouping.name,
    description: grouping.description,
    image: grouping.image,
    categories: grouping.categories,
    sourceLabel: 'Local',
    href: kind === 'feed' ? `/feeds/${encodeURIComponent(grouping.id)}` : `/collections/${encodeURIComponent(grouping.id)}`,
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
 * renders a review state; the seed header carries the import action). Local
 * groupings with no registry entry (custom sources synced whole) appear as
 * Local notebooks.
 */
export function buildNotebookCatalog(notebooks: readonly NotebookDef[], files: Record<string, string> | null): NotebookSummary[] {
  const local: NotebookSummary[] = [];
  const bySlugKind = new Map<string, Grouping>();
  if (files) {
    for (const kind of ['feed', 'collection'] as const) {
      for (const grouping of buildGroupings(kind === 'feed' ? 'feeds' : 'collections', files)) {
        bySlugKind.set(`${kind}:${grouping.id}`, grouping);
        local.push(summarizeGrouping(kind, grouping));
      }
    }
  }

  const registry = notebooks
    .map((notebook): NotebookSummary | null => {
      const parsed = parseNotebookChunkId(notebook.chunkId);
      if (!parsed) return null;
      const grouping = bySlugKind.get(`${parsed.kind}:${parsed.slug}`);
      const seed = seedSourceById(notebook.seedId);
      const dates = (grouping?.items ?? [])
        .map(item => item.date)
        .filter((date): date is string => !!date)
        .sort();
      return {
        packageId: notebook.id,
        seedId: notebook.seedId,
        slug: parsed.slug,
        kind: parsed.kind,
        label: notebook.label,
        // Registry copy wins for the review blurb; README paragraph as fallback.
        description: notebook.description || grouping?.description,
        image: grouping?.image,
        categories: grouping?.categories ?? [],
        sourceLabel: seed?.label ?? notebook.seedId,
        ...(seed?.repositoryUrl ? { repositoryUrl: seed.repositoryUrl } : {}),
        href:
          parsed.kind === 'feed'
            ? `/feeds/${encodeURIComponent(parsed.slug)}`
            : `/collections/${encodeURIComponent(parsed.slug)}`,
        itemCount: grouping?.items.length ?? 0,
        ...(dates.length > 0
          ? { latestDate: dates[dates.length - 1], firstDate: dates[0] }
          : {}),
        ...(grouping?.readme !== undefined ? { readme: grouping.readme } : {}),
        installed: !!grouping,
      };
    })
    .filter((summary): summary is NotebookSummary => summary !== null);

  const registryKeys = new Set(registry.map(summary => `${summary.kind}:${summary.slug}`));
  return [...registry, ...local.filter(summary => !registryKeys.has(`${summary.kind}:${summary.slug}`))];
}

// ── Seed grouping ──────────────────────────────────────────────────────────

/** One seed with the notebooks it publishes — the library section's unit:
 *  the seed imports and subscribes as a whole, its notebooks are what a
 *  Subscribe brings. */
export interface NotebookGroup {
  /** Absent for locally discovered content no registered seed claims. */
  seed?: SeedSource;
  label: string;
  description?: string;
  url?: string;
  repositoryUrl?: string;
  notebooks: NotebookSummary[];
}

/** Group a catalog by the seed that publishes each notebook, registry order
 *  first; locally discovered notebooks (no registry entry) come last. Seeds
 *  with nothing left after filtering drop out. */
export function groupNotebooksBySeed(
  catalog: readonly NotebookSummary[],
  seeds: readonly SeedSource[],
): NotebookGroup[] {
  const bySeed: Record<string, NotebookSummary[]> = {};
  const local: NotebookSummary[] = [];
  for (const notebook of catalog) {
    if (notebook.seedId) (bySeed[notebook.seedId] ??= []).push(notebook);
    else local.push(notebook);
  }
  const groups: NotebookGroup[] = [];
  for (const seed of seeds) {
    const notebooks = bySeed[seed.id];
    if (!notebooks?.length) continue;
    groups.push({
      seed,
      label: seed.label,
      ...(seed.description ? { description: seed.description } : {}),
      url: seed.url,
      ...(seed.repositoryUrl ? { repositoryUrl: seed.repositoryUrl } : {}),
      notebooks,
    });
  }
  if (local.length > 0) groups.push({ label: 'Local', notebooks: local });
  return groups;
}

// ── Seed cards ─────────────────────────────────────────────────────────────

/** One card in the library section: a SEED — the thing you subscribe to and
 *  the thing one Subscribe imports. Its notebooks are what it brings, listed
 *  on the card. */
export interface SeedSummary {
  /** Absent for locally discovered content no registered seed claims. */
  seedId?: string;
  /** Stable cover identity (the seed id). */
  slug: string;
  label: string;
  description?: string;
  /** Published seed directory. */
  url?: string;
  repositoryUrl?: string;
  /** The notebooks this seed publishes, in registry order. */
  notebooks: NotebookSummary[];
  /** Rows present locally across its notebooks (0 before an import). */
  itemCount: number;
  /** Every published notebook is present locally. */
  installed: boolean;
  /** Newest item date across its notebooks (feeds only). */
  latestDate?: string;
  /** Where an installed seed leads — the library listing. */
  href: string;
}

export interface SeedFilter {
  /** Case-insensitive substring over the seed AND its notebooks. */
  text?: string;
  /** Restrict to seeds publishing a notebook of this kind; undefined = all. */
  kind?: NotebookKind;
}

/** Cards for the library section: one per seed, built from the notebook
 *  catalog (a seed with nothing to show drops out). */
export function buildSeedCatalog(
  notebooks: readonly NotebookDef[],
  files: Record<string, string> | null,
  seeds: readonly SeedSource[],
): SeedSummary[] {
  return groupNotebooksBySeed(buildNotebookCatalog(notebooks, files), seeds).map((group): SeedSummary => {
    const dates = group.notebooks
      .map((notebook) => notebook.latestDate)
      .filter((date): date is string => !!date)
      .sort();
    return {
      seedId: group.seed?.id,
      slug: group.seed?.id ?? 'local',
      label: group.label,
      ...(group.description ? { description: group.description } : {}),
      ...(group.url ? { url: group.url } : {}),
      ...(group.repositoryUrl ? { repositoryUrl: group.repositoryUrl } : {}),
      notebooks: group.notebooks,
      itemCount: group.notebooks.reduce((sum, notebook) => sum + notebook.itemCount, 0),
      installed: group.notebooks.every((notebook) => notebook.installed),
      ...(dates.length > 0 ? { latestDate: dates[dates.length - 1] } : {}),
      href: '/catalogs',
    };
  });
}

/** Text matches the seed or any of its notebooks; the kind facet keeps seeds
 *  that publish a notebook of that kind. */
export function filterSeeds(catalog: readonly SeedSummary[], filter: SeedFilter): SeedSummary[] {
  const text = filter.text?.trim().toLowerCase();
  return catalog.filter((seed) => {
    if (filter.kind && !seed.notebooks.some((notebook) => notebook.kind === filter.kind)) return false;
    if (!text) return true;
    return (
      seed.label.toLowerCase().includes(text) ||
      (seed.description?.toLowerCase().includes(text) ?? false) ||
      seed.notebooks.some(
        (notebook) =>
          notebook.label.toLowerCase().includes(text) ||
          (notebook.description?.toLowerCase().includes(text) ?? false),
      )
    );
  });
}

export function sortSeeds(catalog: readonly SeedSummary[], sort: NotebookSort): SeedSummary[] {
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
  return catalog.filter(summary => {
    if (filter.kind && summary.kind !== filter.kind) return false;
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
