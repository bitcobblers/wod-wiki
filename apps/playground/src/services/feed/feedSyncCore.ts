/**
 * feedSyncCore — the storage/network core of one source's sync: claim →
 * manifest check → version decision → chunk imports → checkpoint commit.
 *
 * This is the unit the seed-sync Web Worker (feedSync.worker.ts) executes
 * off the main thread. Hard boundary: NO localStorage, NO app caches, NO
 * UI-adjacent singletons — every dependency is an IFeedSource, a
 * FeedImportStorage, a plain flag, or a callback. Everything environment-specific
 * (activity reporting, content-cache invalidation, registry hydration,
 * catalog-update snapshotting, check timestamps) happens in the driver
 * that interprets the returned SourceSyncCoreResult.
 */
import { assertManifest, type IFeedSource } from './IFeedSource';
import { FeedImporter, type FeedImportProgress } from './FeedImporter';
import type { FeedImportStorage } from './FeedImportStorage';
import { decideFeedImport, storedFeedIsCurrent } from './feedVersion';
import { SEED_SCHEMA, emptySeedMeta, seedMetaKey, type SeedMetaRecord, type SeedPrecedenceTier } from '@/types/seed';

/** Worst-case sync outcomes, aggregated by the driver (worst-first). */
export type FeedSyncOutcome = 'disabled' | 'current' | 'busy' | 'imported' | 'server-stale' | 'error' | 'update-pending';

/**
 * 'update-pending': a background load check found a newer published
 * manifest for a source whose auto-sync is off — nothing was imported;
 * the update waits for a manual Sync (grouped catalog-updates snapshot).
 */
export type FeedSyncOutcomeReason = FeedSyncOutcome;

/** A claim older than this is assumed abandoned (crashed tab). */
export const SEED_CLAIM_TTL_MS = 45_000;

/** The per-source sync input: identity, transport, and precomputed policy. */
export interface SourceSyncCoreInput {
  id: string;
  label: string;
  source: IFeedSource;
  /** `__FEED_VERSIONS__[id]` — this bundle's own build of the source's manifest. */
  embeddedVersion: number;
  /** Persisted auto-sync choice — computed by the driver (localStorage is main-thread-only). */
  autoSyncOn: boolean;
  /** Precedence tier stamped on the checkpoint (and on the rows it writes). */
  tier?: SeedPrecedenceTier;
  notebookIds?: string[];
  granularRecords?: boolean;
}

export interface SourceSyncCoreDeps {
  storage: FeedImportStorage;
  owner: string;
  now: () => number;
  /** Manual re-sync: skip fast paths and re-apply every chunk. */
  force?: boolean;
  /** Background refresh: consult the remote manifest even when stored === embedded. */
  probeManifests?: boolean;
  /** Load-time check: auto-sync-off sources are check-only (updates land in the grouped snapshot). */
  background: boolean;
}

export interface SourceSyncCoreCallbacks {
  onProgress?: (progress: FeedImportProgress) => void;
  /** The source's canvas chunk committed — first paint can ungate. */
  onFirstPaint?: () => void;
}

export interface SourceSyncCoreResult {
  outcome: FeedSyncOutcome;
  error: string | null;
  /** A published manifest was fetched and validated — record the check time. */
  manifestChecked: boolean;
  /** The source had a checkpoint with rows before this run (update vs first import). */
  hadCheckpoint: boolean;
  /** Chunks actually applied (not just confirmed current) — gates import side effects. */
  applied?: boolean;
  /** Applied manifest version — set when chunks applied. */
  importedVersion?: number;
  /** Import counters — set when chunks applied. */
  added?: number;
  updated?: number;
}

/** User-display-safe error text: credential fragments and hosts only, capped. */
export function safeSyncErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw
    .replace(/(authToken["'=:\s]+)[^&\s,"']+/gi, '$1…')
    .replace(/(Bearer\s+)[\w.-]+/gi, '$1…')
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}/…`;
      } catch {
        return '…';
      }
    });
  return cleaned.slice(0, 300);
}

function freshClaimIsOther(meta: SeedMetaRecord | undefined, owner: string, now: number): boolean {
  const claim = meta?.claim;
  return !!claim && claim.owner !== owner && now - claim.at < SEED_CLAIM_TTL_MS;
}

export async function runSourceSyncCore(
  input: SourceSyncCoreInput,
  deps: SourceSyncCoreDeps,
  callbacks: SourceSyncCoreCallbacks = {},
): Promise<SourceSyncCoreResult> {
  const { storage, owner } = deps;
  const now = deps.now;
  const metaKey = seedMetaKey(input.id);
  const result: SourceSyncCoreResult = { outcome: 'current', error: null, manifestChecked: false, hadCheckpoint: false };
  try {
    const stored = await storage.getSeedMeta(metaKey);
    result.hadCheckpoint = (stored?.seedVersion ?? 0) > 0;

    // Skip-fetch fast path: this bundle's own seed is already stored
    // (return-visit background refresh passes probeManifests to bypass).
    if (!deps.force && !deps.probeManifests && storedFeedIsCurrent(stored, input.embeddedVersion)) {
      result.outcome = 'current';
      return result;
    }
    if (freshClaimIsOther(stored, owner, now())) {
      result.outcome = 'busy';
      return result;
    }

    const manifest = assertManifest(await input.source.fetchManifest());
    result.manifestChecked = true;
    const decision = deps.force ? 'import' : decideFeedImport(stored?.seedVersion, manifest.version);
    if (decision === 'server-stale') {
      result.outcome = 'server-stale';
      return result;
    }
    if (stored && stored.schema !== SEED_SCHEMA) throw new Error('Incompatible seed checkpoint; recreate storage');
    // Background check-only: auto-sync off → never fetch chunks or write
    // import checkpoints. A detected update lands in the grouped snapshot
    // and waits for a manual Sync; installed content stays untouched.
    if (deps.background && !input.autoSyncOn) {
      result.outcome = decision === 'import' ? 'update-pending' : 'current';
      return result;
    }
    if (!deps.force && decision === 'current' && stored?.schema === SEED_SCHEMA && stored.builtAt === manifest.builtAt) {
      result.outcome = 'current';
      return result;
    }

    // Claim before the (potentially long) chunk imports.
    const claimed: SeedMetaRecord = {
      ...(stored ?? emptySeedMeta(metaKey)),
      ...(input.tier ? { tier: input.tier } : {}),
      claim: { owner, at: now() },
    };
    await storage.putSeedMeta(claimed, stored ?? null);
    try {
      // addedNotes/updatedNotes are counted inside applySeedChunk's
      // transaction — the commit boundary — so concurrent local edits can
      // never skew them and no extra note reads happen outside the import.
      const applied = await new FeedImporter(storage, input.source, input.id, now).applyAll({
        forceAll: deps.force === true,
        onFirstPaintApplied: () => callbacks.onFirstPaint?.(),
        onProgress: callbacks.onProgress,
        notebookIds: input.notebookIds,
        granularRecords: input.granularRecords,
      });
      // Reaching the apply stage at all means the version decision chose an
      // import (or force/builtAt mismatch) — the run counts as 'imported'
      // even when applyAll confirmed everything current (plan empty).
      result.outcome = 'imported';
      if (applied.status === 'imported') {
        result.applied = true;
        result.importedVersion = manifest.version;
        result.added = applied.addedNotes;
        result.updated = applied.updatedNotes;
      }
    } finally {
      const after = await storage.getSeedMeta(metaKey);
      if (after?.claim?.owner === owner) {
        await storage.putSeedMeta({ ...after, claim: null }, after);
      }
    }
    return result;
  } catch (err) {
    console.warn(`[feedSync] ${input.id} seed sync failed`, err);
    result.outcome = 'error';
    result.error = safeSyncErrorMessage(err);
    return result;
  }
}
