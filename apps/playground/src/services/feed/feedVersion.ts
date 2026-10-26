/**
 * Seed versioning — the pure stale-while-revalidate decision plus the
 * build-injected embedded versions (docs/prototypes/seed-data-unification.md
 * § Version check).
 *
 * `__FEED_VERSIONS__` is a Vite `define` constant stamped from
 * `public/seed/<sourceId>/manifest.json` at build time — one entry per seed
 * source. Under bun test (no Vite) the typeof guard yields {} — which is
 * also the pre-first-import state.
 */
import type { SeedMetaRecord } from '@/types/seed';
import { SEED_SCHEMA } from '@/types/seed';

export const EMBEDDED_FEED_VERSIONS: Record<string, number> =
  typeof __FEED_VERSIONS__ === 'object' && __FEED_VERSIONS__ !== null ? __FEED_VERSIONS__ : {};

export type FeedVersionDecision = 'import' | 'current' | 'server-stale';

/**
 * Compare a fetched manifest against the stored checkpoint. Versions are
 * per-source: each seed's manifest version only ever compares against its
 * own checkpoint. Never consults `embeddedVersions` — the skip-fetch
 * optimization (stored === embedded → no network) lives in the orchestrator.
 */
export function decideFeedImport(
  storedVersion: number | undefined,
  remoteVersion: number,
): FeedVersionDecision {
  if (storedVersion === undefined || storedVersion <= 0) return 'import';
  if (remoteVersion > storedVersion) return 'import';
  if (remoteVersion === storedVersion) return 'current';
  return 'server-stale';
}

/** Only the current schema and matching embedded version can skip fetching. */
export function storedFeedIsCurrent(meta: SeedMetaRecord | undefined, embeddedVersion: number): boolean {
  if (meta?.schema !== undefined && meta.schema !== SEED_SCHEMA) return false;
  return meta?.seedVersion != null && meta.seedVersion > 0 && meta.seedVersion === embeddedVersion;
}
