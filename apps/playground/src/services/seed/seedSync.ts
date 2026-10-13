/**
 * seedSync — the boot orchestrator (docs/prototypes/seed-data-unification.md
 * § Version check), multi-seed edition. Ties together per seed source:
 * flag gate → skip-fetch fast path → multi-tab claim → manifest fetch →
 * version decision → SeedImporter (canvas chunk first, refreshing content
 * consumers for first paint) → broadcast. Sources run in registry order —
 * the core seed (playground canvas + template) before community libraries —
 * each with an independent checkpoint (`seed:<sourceId>` meta record), so
 * chunk membership and vanished-chunk sweeps never cross sources.
 */
import {
  emptySeedMeta,
  SEED_BROADCAST_CHANNEL,
  SEED_SCHEMA,
  seedMetaKey,
  type SeedMetaRecord,
} from '@/types/seed';
import { SeedImporter, type SeedImportProgress } from './SeedImporter';
import { HttpSeedSource } from './HttpSeedSource';
import { IndexedDBSeedImportStorage, type SeedImportStorage } from './SeedImportStorage';
import { assertManifest, type ISeedSource } from './ISeedSource';
import { decideSeedImport, EMBEDDED_SEED_VERSIONS, storedSeedIsCurrent } from './seedVersion';
import { customSeedSources, CORE_SEED_URL, COMMUNITY_SEED_URL, FeedSeedSource, listSyncPackages } from './seedSources';
import { isSeedSubscribed, setSeedSubscribed } from './seedSubscriptions';
import { beginSyncActivity, reportSyncResult, reportSyncError } from '@/services/syncActivity';
import { invalidateSeedContent } from '@/services/content/seedContent';
import { hydrateAppEffortRegistry, getAppEffortRegistry } from '@/services/effortRegistry';
import { storage, storageBackend, storageService } from '@/services/storage';

export { SEED_BROADCAST_CHANNEL } from '@/types/seed';
export const SEED_IMPORT_FLAG = 'wodwiki.seedImport.enabled';

/** A claim older than this is assumed abandoned (crashed tab). */
export const SEED_CLAIM_TTL_MS = 45_000;

/** Default-on; '0' is the explicit opt-out. */
export function isSeedImportEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SEED_IMPORT_FLAG) !== '0';
  } catch {
    return false;
  }
}

export type SeedSyncOutcome = 'disabled' | 'current' | 'busy' | 'imported' | 'server-stale' | 'error';

/**
 * Live per-source sync progress for the Settings sync surface. One
 * `checking` event opens each attempted source; `finished` closes every
 * attempted source — including error/busy/current/server-stale — after
 * claim release and hydration, so the UI can settle its row. Importer
 * phase events carry only successfully committed counts.
 */
export type SeedSyncProgress = {
  sourceId: string;
  sourceLabel: string;
  /** One-based position in this run's source list. */
  sourceIndex: number;
  totalSources: number;
} & (
  | { phase: 'checking' }
  | SeedImportProgress
  | { phase: 'finished'; outcome: SeedSyncOutcome; error: string | null }
);

/** One registered seed library: transport, identity, and build-stamped version. */
export interface SeedSourceSpec {
  /** Seed-source identity — namespaces the checkpoint (`seed:<id>`) and broadcasts. */
  id: string;
  label: string;
  source: ISeedSource;
  /** `__SEED_VERSIONS__[id]` — this bundle's own build of the source's manifest. */
  embeddedVersion: number;
  /** Boot auto-import gate (default true). Non-auto sources (community/catalog
   *  libraries) never import on launch — default installs get playground
   *  content only; Re-sync Now still re-applies them. */
  autoImport?: boolean;
}

/**
 * The default seed sources, in import order. The core seed carries the
 * playground's own canvas pages + template (this repo's markdown/, first
 * paint, bundled at build time by scripts/sync-seed.ts). The community seed
 * is published by the wod-wiki-community content repo to its own GitHub
 * Pages and syncs over HTTP — it is NOT bundled with the app. Third-party
 * libraries register here the same way.
 */
export function defaultSeedSources(): SeedSourceSpec[] {
  return [
    {
      id: 'core',
      label: 'Core (playground)',
      source: new HttpSeedSource(CORE_SEED_URL),
      embeddedVersion: EMBEDDED_SEED_VERSIONS['core'] ?? 0,
    },
    {
      id: 'community',
      label: 'Community',
      // Published by wod-wiki-community's main pipeline to its repo Pages;
      // embeddedVersion stays 0 (never bundled) so every sync consults the
      // remote manifest — GitHub Pages sends no build-stamp compatibility.
      // VITE_COMMUNITY_SEED_URL overrides the host for local/staging e2e.
      source: new HttpSeedSource(COMMUNITY_SEED_URL),
      embeddedVersion: 0,
      autoImport: false,
    },
    // Built-in package sources (Common category packages): each is a
    // filtered view of the community corpus syncing only its own
    // chunk — a package sync never downloads the whole library.
    ...listSyncPackages().map((pkg): SeedSourceSpec => ({
      id: pkg.id,
      label: pkg.label,
      source: new FeedSeedSource(new HttpSeedSource(COMMUNITY_SEED_URL), pkg.chunkId),
      embeddedVersion: 0,
      autoImport: false,
    })),
    // User-registered libraries (/settings/sync). Never auto-import; their
    // manifests are not build-stamped, so embeddedVersion 0 keeps them
    // off the skip-fetch fast path — every sync consults the manifest.
    ...customSeedSources().map((c): SeedSourceSpec => ({
      id: c.id,
      label: c.label,
      source: new HttpSeedSource(c.url),
      embeddedVersion: EMBEDDED_SEED_VERSIONS[c.id] ?? 0,
      autoImport: false,
    })),
  ];
}

export interface SeedSyncDeps {
  sources?: SeedSourceSpec[];
  storage?: SeedImportStorage;
  /** Claim owner id; defaults to a fresh random per call. */
  owner?: string;
  now?: () => number;
  broadcast?: (message: unknown) => void;
  /** Flag override for tests; defaults to the localStorage flag. */
  isEnabled?: () => boolean;
  /**
   * Manual re-sync (Settings → Data): skip the stored===embedded fast path
   * and the version-equality check so every chunk re-applies (ownership
   * rules still gate every row).
   */
  force?: boolean;
  /**
   * Background refresh (return visits): consult the remote manifest even
   * when the bundled embedded version matches the stored checkpoint.
   */
  probeManifests?: boolean;
  /** Live progress stream (Settings → Sync): checking → chunk phases → finished per source. */
  onProgress?: (progress: SeedSyncProgress) => void;
  /**
   * Fires when this source's canvas chunk commits (first paint). The boot
   * orchestrator uses it to ungate the readiness skeleton while the rest
   * of the library is still importing.
   */
  onFirstPaint?: () => void;
}

function defaultBroadcast(message: unknown): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // Cross-tab notification is best-effort.
  }
}

/** User-display-safe error text: credential fragments and hosts only, capped. */
function safeSyncErrorMessage(err: unknown): string {
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

export async function runSeedSync(deps: SeedSyncDeps = {}): Promise<SeedSyncOutcome> {
  const outcomes: SeedSyncOutcome[] = [];
  const storage = deps.storage ?? new IndexedDBSeedImportStorage();

  if (!(deps.isEnabled ?? isSeedImportEnabled)()) return 'disabled';


  const owner = deps.owner ?? `seed-${(deps.now ?? Date.now)()}-${Math.random().toString(36).slice(2, 8)}`;
  const sources = deps.sources ?? defaultSeedSources();
  for (const [index, spec] of sources.entries()) {
    // A failing source emits its own finished('error'); the run continues.
    const outcome = await runSourceSync(spec, deps, storage, owner, index + 1, sources.length);
    console.debug(`[seedSync] ${spec.id} outcome: ${outcome}`);
    outcomes.push(outcome);
  }
  // Worst-first aggregation: readiness and toasts only need one verdict.
  if (outcomes.includes('error')) return 'error';
  if (outcomes.includes('imported')) return 'imported';
  if (outcomes.includes('server-stale')) return 'server-stale';
  if (outcomes.includes('busy')) return 'busy';
  return 'current';
}

/**
 * Boot-time seed policy (app bootstrap), layered on runSeedSync:
 *  - API builds keep the prior behavior: every registered source syncs;
 *  - fresh browser (no core checkpoint): the core seed only — home ungates
 *    on the committed canvas chunk while the rest of the library imports;
 *    subscribed community libraries join from the next visit (a fresh
 *    browser has no imported checkpoints to subscribe);
 *  - returning browser: core + subscribed sources refresh in the
 *    background, nonblocking, consulting remote manifests even when the
 *    bundled core's embedded version matches the stored checkpoint.
 */
export async function runBootSeedSync(deps: SeedSyncDeps = {}): Promise<SeedSyncOutcome> {
  if (storageBackend === 'api') return runSeedSync(deps);
  const all = deps.sources ?? defaultSeedSources();
  const storage = deps.storage ?? new IndexedDBSeedImportStorage();
  let coreCheckpoint: SeedMetaRecord | undefined;
  try {
    coreCheckpoint = await storage.getSeedMeta(seedMetaKey('core'));
  } catch (err) {
    // Provider unreadable (offline, bad token, malformed config): nothing to
    // probe or import — the Data settings surface owns the error details.
    console.warn('[seedSync] boot provider probe failed', err);
    return 'error';
  }
  if (!coreCheckpoint || coreCheckpoint.seedVersion <= 0) {
    return runSeedSync({ ...deps, sources: all.filter((s) => s.autoImport !== false) });
  }
  const sources = all.filter((s) => s.id === 'core' || isSeedSubscribed(s.id));
  return runSeedSync({ ...deps, sources, probeManifests: true });
}

async function runSourceSync(
  spec: SeedSourceSpec,
  deps: SeedSyncDeps,
  storage: SeedImportStorage,
  owner: string,
  sourceIndex: number,
  totalSources: number,
): Promise<SeedSyncOutcome> {
  const now = deps.now ?? Date.now;
  const broadcast = deps.broadcast ?? defaultBroadcast;
  const metaKey = seedMetaKey(spec.id);
  const onProgress = deps.onProgress;
  // `finished` closes every attempted source — after claim release and
  // first-paint hydration: a run is never complete before its commits.
  const finish = (outcome: SeedSyncOutcome, error: string | null = null): void =>
    onProgress?.({ phase: 'finished', outcome, error, sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources });

  onProgress?.({ phase: 'checking', sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources });
  const endActivity = beginSyncActivity('download', spec.label);
  try {
    const stored = await storage.getSeedMeta(metaKey);

    // Skip-fetch fast path: this bundle's own seed is already stored
    // (return-visit background refresh passes probeManifests to bypass).
    if (!deps.force && !deps.probeManifests && storedSeedIsCurrent(stored, spec.embeddedVersion)) {
      finish('current');
      return 'current';
    }
    if (freshClaimIsOther(stored, owner, now())) {
      finish('busy');
      return 'busy';
    }

    const manifest = assertManifest(await spec.source.fetchManifest());
    const decision = deps.force ? 'import' : decideSeedImport(stored?.seedVersion, manifest.version);
    if (decision === 'server-stale') {
      finish('server-stale');
      return 'server-stale';
    }
    if (stored && stored.schema !== SEED_SCHEMA) throw new Error('Incompatible seed checkpoint; recreate storage');
    if (!deps.force && decision === 'current' && stored?.schema === SEED_SCHEMA && stored.builtAt === manifest.builtAt) {
      finish('current');
      return 'current';
    }

    // Claim before the (potentially long) chunk imports.
    const claimed: SeedMetaRecord = { ...(stored ?? emptySeedMeta(metaKey)), claim: { owner, at: now() } };
    await storage.putSeedMeta(claimed, stored ?? null);
    try {
      // addedNotes/updatedNotes are counted inside applySeedChunk's
      // transaction — the commit boundary — so concurrent local edits can
      // never skew them and no extra note reads happen outside the import.
      const result = await new SeedImporter(storage, spec.source, spec.id, now).applyAll({
        forceAll: deps.force === true,
        // First paint: as soon as the canvas chunk (home page + canvas
        // routes) is committed, refresh content consumers — the home page
        // renders while the rest of the library is still importing. Sources
        // without a canvas chunk never trigger it.
        onFirstPaintApplied: () => {
          invalidateSeedContent();
          deps.onFirstPaint?.();
        },
        // Tag importer chunk phases with this source's identity. No
        // subscriber → no per-event allocation.
        onProgress: onProgress
          ? (progress) => onProgress({ ...progress, sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources })
          : undefined,
      });
      if (result.status === 'imported') {
        broadcast({ kind: 'seed-imported', source: spec.id, version: manifest.version });
        // BroadcastChannel does not echo to the importing context — refresh
        // this tab's content caches and the effort registry directly.
        invalidateSeedContent();
        const registry = getAppEffortRegistry();
        if (registry.isInitialized()) await hydrateAppEffortRegistry(registry);
        reportSyncResult({ source: spec.label, added: result.addedNotes, updated: result.updatedNotes });
      }
    } finally {
      const after = await storage.getSeedMeta(metaKey);
      if (after?.claim?.owner === owner) {
        await storage.putSeedMeta({ ...after, claim: null }, after);
      }
    }
    finish('imported');
    return 'imported';
  } catch (err) {
    console.warn(`[seedSync] ${spec.id} seed sync failed`, err);
    const message = safeSyncErrorMessage(err);
    reportSyncError(message);
    finish('error', message);
    return 'error';
  } finally {
    endActivity();
  }
}

// ── Status (Settings → Data) ───────────────────────────────────────────────

export interface SeedVersionInfo {
  version: number;
  schema: number;
  builtAt: string;
}

export interface SeedSourceStatus {
  id: string;
  label: string;
  /** False for community/catalog sources — they never import at boot. */
  autoImport: boolean;
  /** The import checkpoint in Storage — null before the first import. */
  stored: (SeedVersionInfo & { importedAt: number }) | null;
  /** The published manifest — null when unreachable (offline). */
  remote: SeedVersionInfo | null;
  remoteError: string | null;
  /** Stored checkpoint matches the published manifest. */
  upToDate: boolean;
}

export interface SeedStatus {
  sources: SeedSourceStatus[];
}

/**
 * Sync one source by id (Settings → Sync per-source button). Picks the spec
 * from the registered sources; unknown ids (e.g. a removed custom source)
 * report 'error'. No `force` default: a plain sync imports when the stored
 * checkpoint is missing or behind the manifest.
 */
export async function syncSeedSource(id: string, deps: SeedSyncDeps = {}): Promise<SeedSyncOutcome> {
  const spec = (deps.sources ?? defaultSeedSources()).find(s => s.id === id);
  if (!spec) {
    console.warn(`[seedSync] unknown seed source: ${id}`);
    return 'error';
  }
  const outcome = await runSeedSync({ ...deps, sources: [spec] });
  // A manual sync that restored a healthy checkpoint subscribes the library
  // for background refresh — both a fresh import and an already-current
  // library the user explicitly chose. 'busy'/'error'/'server-stale' never
  // change a persisted choice. (Core is a no-op: always subscribed.)
  if (outcome === 'imported' || outcome === 'current') setSeedSubscribed(id, true);
  return outcome;
}
/**
 * Remove a package and its imported notes from the active library.
 * Deletes all seed-origin notes matching the package's chunk/catalog,
 * clears its seed checkpoint, unsets its subscription, and invalidates caches.
 */
export async function removePackageFromLibrary(packageId: string): Promise<{ deleted: number }> {
  const pkg = listSyncPackages().find((p) => p.id === packageId);
  const chunkId = pkg?.chunkId ?? packageId;
  const chunkSlug = chunkId.replace(/^(?:feed|collection)\./, '');
  const category = pkg?.category;

  const allNotes = await storageService.getAllNotes();
  const toDelete = allNotes.filter((note) => {
    if (note.seedOrigin !== 'seed') return false;
    if (note.seedChunkId === chunkId) return true;
    if (category && note.catalog === category) return true;
    if (note.catalog === chunkSlug) return true;
    if (note.sourceId && (note.sourceId.includes(chunkSlug) || note.sourceId.startsWith(`feed:feeds/${chunkSlug}`))) return true;
    return false;
  });

  for (const note of toDelete) {
    await storageService.deleteNote(note.id);
  }

  try {
    const metaKey = seedMetaKey(packageId);
    await storage.readwrite('meta').delete(metaKey);
  } catch {
    // meta delete is best-effort
  }

  setSeedSubscribed(packageId, false);
  invalidateSeedContent();

  try {
    const channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
    channel.postMessage({ kind: 'seed-removed', source: packageId });
    channel.close();
  } catch {
    // optional broadcast
  }

  return { deleted: toDelete.length };
}

/**
 * Check whether a package is present in the library (subscribed or has notes).
 */
export async function isPackageInLibrary(packageId: string): Promise<boolean> {
  if (isSeedSubscribed(packageId)) return true;
  const pkg = listSyncPackages().find((p) => p.id === packageId);
  const chunkId = pkg?.chunkId ?? packageId;
  const chunkSlug = chunkId.replace(/^(?:feed|collection)\./, '');
  const allNotes = await storageService.getAllNotes();
  return allNotes.some((note) =>
    note.seedOrigin === 'seed' && (
      note.seedChunkId === chunkId ||
      note.catalog === chunkSlug ||
      (note.sourceId && note.sourceId.includes(chunkSlug))
    )
  );
}

export interface SeedCoverage {
  /** At least one boot-auto source (the bundled core) has a checkpoint. */
  coreImported: boolean;
  /** At least one manual library (community / custom) has a checkpoint. */
  libraryImported: boolean;
}

/**
 * Local-only coverage probe for the /catalogs and /feeds empty-library
 * notice: reads the per-source checkpoints without touching the network —
 * the banner must render instantly and work offline.
 */
export async function readSeedCoverage(deps: Pick<SeedSyncDeps, 'sources' | 'storage'> = {}): Promise<SeedCoverage> {
  const storage = deps.storage ?? new IndexedDBSeedImportStorage();
  let coreImported = false;
  let libraryImported = false;
  await Promise.all((deps.sources ?? defaultSeedSources()).map(async (spec) => {
    try {
      const meta = await storage.getSeedMeta(seedMetaKey(spec.id));
      if (!meta || meta.seedVersion <= 0) return;
      if (spec.autoImport === false) libraryImported = true;
      else coreImported = true;
    } catch {
      // Unreadable provider: coverage unknown — reported as not imported.
    }
  }));
  return { coreImported, libraryImported };
}

/** Per-source local + remote seed versions for the Settings status card. */
export async function readSeedStatus(deps: SeedSyncDeps = {}): Promise<SeedStatus> {
  const storage = new IndexedDBSeedImportStorage();
  // Per-feed packages share the community library checkpoint: no per-package
  // meta record exists, so coverage comes from the package's chunk membership.
  const communityMeta = await storage.getSeedMeta(seedMetaKey('community'));
  const syncPackages = listSyncPackages();
  const sources = await Promise.all(
    (deps.sources ?? defaultSeedSources()).map(async (spec) => {
      const metaKey = seedMetaKey(spec.id);
      let stored = await storage.getSeedMeta(metaKey);
      if (!stored && communityMeta) {
        const pkg = syncPackages.find(p => p.id === spec.id);
        if (pkg && communityMeta.chunks[pkg.chunkId]) {
          stored = communityMeta;
        }
      }
      let remote: SeedSourceStatus['remote'] = null;
      let remoteError: string | null = null;
      try {
        const manifest = await spec.source.fetchManifest();
        remote = { version: manifest.version, schema: manifest.schema, builtAt: manifest.builtAt };
      } catch (err) {
        remoteError = err instanceof Error ? err.message : String(err);
      }
      return {
        id: spec.id,
        label: spec.label,
        autoImport: spec.autoImport !== false,
        stored: stored
          ? { version: stored.seedVersion, schema: stored.schema, builtAt: stored.builtAt, importedAt: stored.importedAt }
          : null,
        remote,
        remoteError,
        upToDate:
          stored != null && remote != null && stored.schema === SEED_SCHEMA && stored.seedVersion === remote.version,
      };
    }),
  );
  return { sources };
}
