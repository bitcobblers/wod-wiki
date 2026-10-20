/**
 * notebookGalleryModel — pure model behind the notebook cards (home section
 * and, later, a dedicated gallery surface).
 *
 * Joins two planes of truth:
 *  - the package registry (`listSyncPackages` — built-in + custom package
 *    sources, each with a curated description), and
 *  - the locally synced seed corpus (`buildGroupings` over the seed file map
 *    — real item counts, date ranges, README-derived descriptions/covers).
 *
 * The registry always wins for identity and description (it is the review
 * surface — it renders even when nothing is imported yet); the local corpus
 * enriches stats and can override the cover image when the README declares
 * one. Pure functions only — React and storage live in the section.
 */

import { buildGroupings, type Grouping } from '@/repositories/groupings';
import type { SyncPackage } from '@/services/seed/seedSources';

// ── Types ──────────────────────────────────────────────────────────────────

export type NotebookKind = 'feed' | 'collection';

export interface NotebookSummary {
  /** Registry package id (e.g. `community-crossfit-programming`). */
  packageId: string;
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
 * Merge the registry with the local corpus. Registry packages are present
 * even when their chunk has not been imported (installed=false → the card
 * renders a review state with an import action). Local groupings with no
 * registry entry (custom sources synced whole) appear as Local notebooks.
 */
export function buildNotebookCatalog(packages: readonly SyncPackage[], files: Record<string, string> | null): NotebookSummary[] {
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

  const registry = packages
    .map((pkg): NotebookSummary | null => {
      const parsed = parseNotebookChunkId(pkg.chunkId);
      if (!parsed) return null;
      const grouping = bySlugKind.get(`${parsed.kind}:${parsed.slug}`);
      const dates = (grouping?.items ?? [])
        .map(item => item.date)
        .filter((date): date is string => !!date)
        .sort();
      return {
        packageId: pkg.id,
        slug: parsed.slug,
        kind: parsed.kind,
        label: pkg.label,
        // Registry copy wins for the review blurb; README paragraph as fallback.
        description: pkg.description || grouping?.description,
        image: grouping?.image,
        categories: grouping?.categories ?? [],
        sourceLabel: pkg.sourceLabel,
        ...(pkg.repositoryUrl ? { repositoryUrl: pkg.repositoryUrl } : {}),
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
