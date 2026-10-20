/**
 * WOD Feeds — public adapter over the seeded corpus
 * (docs/prototypes/seed-data-unification.md § Module 3).
 *
 * A feed is a Grouping whose items carry dates, from
 * markdown/feeds/{feed-slug}/YYYY-MM-DD/{file}.md. Items are sorted by date
 * descending (most recent first); feeds are sorted by name ascending.
 * Reads go through the seed-content seam (IndexedDB-backed); results are
 * memoized per corpus snapshot and refresh when a new seed lands.
 */

import { ensureSeedContent, type SeedContentFiles } from '@/services/content/seedContent';
import { buildGroupings, type Grouping } from './groupings';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScriptFeedItem {
  /** Filename without extension, e.g. "monday-strength" */
  id: string;
  /** Display name derived from filename */
  name: string;
  /** Raw markdown content */
  content: string;
  /** Publication date key: YYYY-MM-DD (parent directory name) */
  feedDate: string;
  /** Canonical markdown path key */
  path: string;
}

export interface ScriptFeed {
  /** Directory name, e.g. "crossfit-programming" */
  id: string;
  /** Display name, e.g. "CrossFit Programming" */
  name: string;
  /** The content of README.md if it exists */
  readme?: string;
  /** Category slugs parsed from the README front matter `category` field */
  categories: string[];
  /** Short package description (front matter `description:` or README first paragraph) */
  description?: string;
  /** Cover image URL (front matter `image:`), when the package provides one */
  image?: string;
  /** All feed items sorted by feedDate descending (most recent first) */
  items: ScriptFeedItem[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Pure derivation over a corpus snapshot — the hook-level entry point. */
export function buildScriptFeeds(files: SeedContentFiles): ScriptFeed[] {
  return buildGroupings('feeds', files)
    .map((grouping: Grouping) => ({
      id: grouping.id,
      name: grouping.name,
      readme: grouping.readme,
      categories: grouping.categories,
      description: grouping.description,
      image: grouping.image,
      items: grouping.items
        .map(({ id, name, content, path, date }) => ({
          id,
          name,
          content,
          feedDate: date ?? '',
          path,
        }))
        // Most recent dates first
        .sort((a, b) => b.feedDate.localeCompare(a.feedDate)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

let cacheFor: SeedContentFiles | null = null;
let cached: ScriptFeed[] = [];

/**
 * Get all WOD feeds from the seeded corpus. Memoized per corpus snapshot;
 * resolves after the seed content is loaded.
 */
export async function getScriptFeeds(): Promise<ScriptFeed[]> {
  const files = await ensureSeedContent();
  if (cacheFor !== files) {
    cacheFor = files;
    cached = buildScriptFeeds(files);
  }
  return cached;
}

/** Get a single feed by ID. */
export async function getScriptFeed(id: string): Promise<ScriptFeed | undefined> {
  return (await getScriptFeeds()).find(f => f.id === id);
}

/** Get a specific item within a feed by date + item id. */
export async function getScriptFeedItem(
  feedId: string,
  feedDate: string,
  itemId: string,
): Promise<ScriptFeedItem | undefined> {
  return (await getScriptFeed(feedId))?.items.find(
    i => i.feedDate === feedDate && i.id === itemId,
  );
}

/** Unique date keys present in a feed, most recent first. */
export function getFeedDateKeys(feed: ScriptFeed): string[] {
  return Array.from(new Set(feed.items.map(i => i.feedDate))).sort().reverse();
}
