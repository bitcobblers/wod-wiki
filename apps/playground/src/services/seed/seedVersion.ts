/**
 * Seed versioning — the pure stale-while-revalidate decision plus the
 * build-injected embedded versions (docs/prototypes/seed-data-unification.md
 * § Version check).
 *
 * `__SEED_VERSIONS__` is a Vite `define` constant stamped from
 * `public/seed/<sourceId>/manifest.json` at build time — one entry per seed
 * source. Under bun test (no Vite) the typeof guard yields {} — which is
 * also the pre-first-import state.
 */
import type { SeedMetaRecord } from '@/types/seed';
import { SEED_SCHEMA } from '@/types/seed';

export const EMBEDDED_SEED_VERSIONS: Record<string, number> =
  typeof __SEED_VERSIONS__ === 'object' && __SEED_VERSIONS__ !== null ? __SEED_VERSIONS__ : {};

export type SeedVersionDecision = 'import' | 'current' | 'server-stale';

/**
 * Compare a fetched manifest against the stored checkpoint. Versions are
 * per-source: each seed's manifest version only ever compares against its
 * own checkpoint. Never consults `embeddedVersions` — the skip-fetch
 * optimization (stored === embedded → no network) lives in the orchestrator.
 */
export function decideSeedImport(
  storedVersion: number | undefined,
  remoteVersion: number,
): SeedVersionDecision {
  if (storedVersion === undefined || storedVersion <= 0) return 'import';
  if (remoteVersion > storedVersion) return 'import';
  if (remoteVersion === storedVersion) return 'current';
  return 'server-stale';
}

/** True when the boot check can skip the manifest fetch for one source. A stored
 *  checkpoint from ANY other schema — older or newer — never skips: this bundle
 *  can only apply its own schema, and the importer's re-apply is the migration
 *  that re-attributes already-seeded rows, even unchanged. */
export function storedSeedIsCurrent(meta: SeedMetaRecord | undefined, embeddedVersion: number): boolean {
  if (meta?.schema !== undefined && meta.schema !== SEED_SCHEMA) return false;
  return meta?.seedVersion != null && meta.seedVersion > 0 && meta.seedVersion === embeddedVersion;
}
