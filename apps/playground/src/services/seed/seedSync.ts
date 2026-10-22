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
  SEED_BROADCAST_CHANNEL,
  SEED_SCHEMA,
  seedMetaKey,
  type SeedManifest,
  type SeedMetaRecord,
  type SeedPrecedenceTier,
} from '@/types/seed';
import type { SeedImportProgress } from './SeedImporter';
import { HttpSeedSource } from './HttpSeedSource';
import type { SeedImportStorage } from './SeedImportStorage';
import { mainThreadSeedImportStorage } from './seedStorageDefault';
import { assertManifest, type ISeedSource } from './ISeedSource';
import { EMBEDDED_SEED_VERSIONS } from './seedVersion';
import { customSeedSources, CORE_SEED_URL, SEED_SOURCES, notebooksOfSeed, hideSeedSourceRow, hiddenSeedSourceIds, removeCustomSeedSource, safeRepositoryUrl, toAbsoluteSeedUrl } from './seedSources';
import { getSubscribedNotebooks, isSeedAutoSync, isSeedSubscribed, setSeedAutoSync, setSeedSubscribed } from './seedSubscriptions';
import { beginSyncActivity, reportSyncResult, reportSyncError, reportSyncProgress } from '@/services/syncActivity';
import { invalidateSeedContent } from '@/services/content/seedContent';
import { hydrateAppEffortRegistry, getAppEffortRegistry } from '@/services/effortRegistry';
import { hydrateAppEquipmentRegistry, getAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { profileService, storageBackend } from '@/services/storage';
import { getActiveLocalDbName } from '@/services/storage/dataSettings';
import {
  runSourceSyncCore,
  type SeedSyncOutcome,
  type SourceSyncCoreResult,
} from './seedSyncCore';
import type { SeedWorkerToMain } from './seedSync.worker';

export { SEED_BROADCAST_CHANNEL } from '@/types/seed';
export { SEED_CLAIM_TTL_MS } from './seedSyncCore';
export type { SeedSyncOutcome } from './seedSyncCore';
export const SEED_IMPORT_FLAG = 'wodwiki.seedImport.enabled';

/** Default-on; '0' is the explicit opt-out. */
export function isSeedImportEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SEED_IMPORT_FLAG) !== '0';
  } catch {
    return false;
  }
}

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

/** One registered seed: transport, identity, and build-stamped version. */
export interface SeedSourceSpec {
  /** Seed identity — namespaces the checkpoint (`seed:<id>`) and broadcasts. */
  id: string;
  label: string;
  source: ISeedSource;
  /** The seed directory this source syncs from (status/link rendering). */
  url: string;
  /** Published Git repository link, when the source publishes one. */
  repositoryUrl?: string;
  /** `__SEED_VERSIONS__[id]` — this bundle's own build of the source's manifest. */
  embeddedVersion: number;
  /** Boot auto-import gate (default true). Non-auto seeds (user libraries,
  *  theme repos) never import on launch — default installs get playground
  *  content only; Subscribe imports them. */
  autoImport?: boolean;
  /** Checkpoint precedence tier — built-in corpus rows rank under user libraries. */
  tier?: SeedPrecedenceTier;
  /** One-line seed description (status cards). */
  description?: string;
}

/**
 * The default seed sources, in import order. The bundled core seed carries
 * the playground's own canvas pages + template (this repo's markdown/, first
 * paint, built at build time by scripts/sync-seed.ts). Every other seed is
 * one split content repo publishing to its own GitHub Pages and syncing as
 * an independent source — subscribing imports every notebook it publishes.
 * User-registered libraries (a seed dir on any host) register the same way.
 */
export function defaultSeedSources(): SeedSourceSpec[] {
  const hidden = new Set(hiddenSeedSourceIds());
  const coreUrl = toAbsoluteSeedUrl(CORE_SEED_URL);
  return [
    {
      id: 'core',
      label: 'Core (playground)',
      source: new HttpSeedSource(coreUrl),
      url: coreUrl,
      embeddedVersion: EMBEDDED_SEED_VERSIONS['core'] ?? 0,
    },
    ...SEED_SOURCES.map((seed): SeedSourceSpec => ({
      id: seed.id,
      label: seed.label,
      source: new HttpSeedSource(seed.url),
      url: seed.url,
      ...(seed.repositoryUrl ? { repositoryUrl: seed.repositoryUrl } : {}),
      // Never bundled: embeddedVersion 0 keeps every sync off the skip-fetch
      // fast path — GitHub Pages sends no build-stamp compatibility.
      embeddedVersion: 0,
      autoImport: seed.autoImport ?? false,
      tier: seed.tier,
      ...(seed.description ? { description: seed.description } : {}),
    })),
    // User-registered libraries (/settings/sync). Never auto-import; their
    // manifests are not build-stamped, so embeddedVersion 0 keeps them
    // off the skip-fetch fast path — every sync consults the manifest.
    ...customSeedSources().map((c): SeedSourceSpec => ({
      id: c.id,
      label: c.label,
      source: new HttpSeedSource(c.url),
      url: c.url,
      repositoryUrl: c.repositoryUrl,
      embeddedVersion: EMBEDDED_SEED_VERSIONS[c.id] ?? 0,
      autoImport: false,
    })),
  ].filter((spec) => !hidden.has(spec.id));
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
  /**
   * 'manual' (default): every listed source imports per the version
   * decision. 'background': a load-time check — only sources whose
   * persisted auto-sync preference is on apply updates; the rest are
   * check-only and their detected updates land in the grouped
   * catalog-updates snapshot instead of importing.
   */
  mode?: 'manual' | 'background';
  /**
   * Report per-source results/errors to sync activity (default true).
   * Background load checks suppress it — one grouped notification is
   * published instead of a per-source toast flood.
   */
  reportActivity?: boolean;
  /**
   * Import Once intake: `false` imports the content without subscribing —
   * a new source gets an explicit unsubscribed record so the checkpoint
   * migration cannot silently subscribe it later; an existing live
   * subscription is preserved. Absent/true keeps the established
   * manual-sync-subscribes behavior.
   */
  subscribe?: boolean;
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

/** Refresh this context's content caches and effort/equipment registries
 *  after an import — BroadcastChannel does not echo to the importing
 *  context, so every driver calls this directly. */
async function hydrateImportedContent(): Promise<void> {
  invalidateSeedContent();
  const registry = getAppEffortRegistry();
  if (registry.isInitialized()) await hydrateAppEffortRegistry(registry);
  const equipmentRegistry = getAppEquipmentRegistry();
  if (equipmentRegistry.isInitialized()) await hydrateAppEquipmentRegistry(equipmentRegistry);
}

/** Worst-first aggregation: readiness and toasts only need one verdict. */
function aggregateOutcomes(outcomes: SeedSyncOutcome[]): SeedSyncOutcome {
  if (outcomes.includes('error')) return 'error';
  if (outcomes.includes('imported')) return 'imported';
  if (outcomes.includes('update-pending')) return 'update-pending';
  if (outcomes.includes('server-stale')) return 'server-stale';
  if (outcomes.includes('busy')) return 'busy';
  return 'current';
}

/** Shared side effects applied to one finished source result (both drivers). */
function applySourceResult(
  spec: SeedSourceSpec,
  result: SourceSyncCoreResult,
  deps: SeedSyncDeps,
  updates: Map<string, CatalogSourceUpdate> | undefined,
): void {
  const now = deps.now ?? Date.now;
  const broadcast = deps.broadcast ?? defaultBroadcast;
  const report = deps.reportActivity !== false;
  if (result.manifestChecked) markSeedChecked(spec.id, now());
  if (result.outcome === 'error') {
    const message = result.error ?? 'seed sync failed';
    if (deps.mode === 'background') updates?.set(spec.id, { sourceId: spec.id, label: spec.label, state: 'error' });
    if (report) reportSyncError(message);
    return;
  }
  if (result.outcome === 'imported' && result.applied) {
    broadcast({ kind: 'seed-imported', source: spec.id, version: result.importedVersion });
    void hydrateImportedContent();
    if (report) reportSyncResult({ source: spec.label, added: result.added ?? 0, updated: result.updated ?? 0 });
    // An applied update of an already-installed catalog is part of the
    // grouped snapshot ('updated'); a first import is not an update.
    if (updates && result.hadCheckpoint) updates.set(spec.id, { sourceId: spec.id, label: spec.label, state: 'updated' });
  }
  if (updates && result.outcome === 'update-pending') {
    updates.set(spec.id, { sourceId: spec.id, label: spec.label, state: 'pending' });
  }
}

/** The worker path runs ONLY against the app's real IndexedDB database —
 *  injected storages (tests) and the API backend stay on the main thread. */
function workerSupported(): boolean {
  return typeof Worker !== 'undefined' && storageBackend !== 'api';
}

/**
 * Run the whole sync inside seedSync.worker: manifest fetches, chunk JSON
 * parsing, row validation, and IndexedDB writes happen off the main thread.
 * The driver here translates messages back into the side effects the main
 * thread owns (progress, activity, content caches, registries, catalog
 * updates, check timestamps). Resolves null when the worker is unusable —
 * the caller reruns the direct path (idempotent: nothing applied before a
 * startup failure, and checkpoints/claims guard anything partial).
 */
async function runSeedSyncViaWorker(
  sources: SeedSourceSpec[],
  deps: SeedSyncDeps,
  owner: string,
): Promise<SeedSyncOutcome | null> {
  return await new Promise<SeedSyncOutcome | null>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./seedSync.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      console.warn('[seedSync] seed worker unavailable; running on main thread', err);
      resolve(null);
      return;
    }
    const updates = deps.mode === 'background' ? new Map<string, CatalogSourceUpdate>() : undefined;
    const outcomes: SeedSyncOutcome[] = [];
    const totalSources = sources.length;
    let received = false;
    const settle = (value: SeedSyncOutcome | null): void => {
      reportSyncProgress(null);
      worker.terminate();
      resolve(value);
    };
    worker.onerror = (event) => {
        console.warn('[seedSync] seed worker failed', event.message ?? 'unknown error');
        settle(received ? aggregateOutcomes(outcomes) : null);
    };
    worker.onmessage = (event: MessageEvent<SeedWorkerToMain>) => {
      received = true;
      const msg = event.data;
      if (msg.type === 'progress') {
        const spec = sources.find((s) => s.id === msg.sourceId);
        reportSyncProgress({
          sourceId: msg.sourceId,
          sourceLabel: spec?.label ?? msg.sourceId,
          chunkId: msg.progress.chunkId,
          recordId: msg.progress.recordId,
          completedRecords: msg.progress.completedRecords,
          totalRecords: msg.progress.totalRecords,
          completedChunks: msg.progress.completedChunks,
          totalChunks: msg.progress.totalChunks,
          phase: msg.progress.phase,
        });
        deps.onProgress?.({
          ...msg.progress,
          sourceId: msg.sourceId,
          sourceLabel: spec?.label ?? msg.sourceId,
          sourceIndex: sources.indexOf(spec!) + 1,
          totalSources,
        });
        return;
      }
      if (msg.type === 'first-paint') {
        void hydrateImportedContent();
        deps.onFirstPaint?.();
        return;
      }
      if (msg.type === 'source-result') {
        const index = sources.findIndex((s) => s.id === msg.sourceId);
        const spec = sources[index];
        if (!spec) return;
        outcomes.push(msg.result.outcome);
        applySourceResult(spec, msg.result, deps, updates);
        deps.onProgress?.({
          phase: 'finished', outcome: msg.result.outcome, error: msg.result.error,
          sourceId: spec.id, sourceLabel: spec.label, sourceIndex: index + 1, totalSources,
        });
        return;
      }
      // 'done'
      if (updates) publishCatalogUpdates([...updates.values()]);
      settle(aggregateOutcomes(msg.outcomes.length ? msg.outcomes : outcomes));
    };
    worker.postMessage({
      type: 'run',
      dbName: getActiveLocalDbName(),
      // Identity is a plain value over the wire (functions cannot post);
      // it already resolved once per page load on the main thread.
      userId: profileService.currentSync()?.id ?? null,
      owner,
      force: deps.force,
      probeManifests: deps.probeManifests,
      background: deps.mode === 'background',
      sources: sources.map((s) => ({
        id: s.id,
        label: s.label,
        url: toAbsoluteSeedUrl(s.url),
        ...(s.tier ? { tier: s.tier } : {}),
        embeddedVersion: s.embeddedVersion,
        autoSyncOn: isSeedAutoSync(s.id),
        notebookIds: getSubscribedNotebooks(s.id) ?? undefined,
        granularRecords: true,
      })),
    });
  });
}

// ── Grouped catalog updates (one snapshot per background load check) ───────

export type CatalogUpdateState = 'pending' | 'updated' | 'error';

export interface CatalogSourceUpdate {
  sourceId: string;
  label: string;
  state: CatalogUpdateState;
}

export interface CatalogUpdatesSnapshot {
  id: number;
  updates: CatalogSourceUpdate[];
}

let catalogUpdates: CatalogUpdatesSnapshot | null = null;
let catalogUpdateSeq = 0;
const catalogUpdateListeners = new Set<() => void>();

/** Latest grouped snapshot of detected catalog updates, or null when the
 *  last background check (or manual sync) left nothing outstanding. */
export function getCatalogUpdates(): CatalogUpdatesSnapshot | null {
  return catalogUpdates;
}

export function subscribeCatalogUpdates(listener: () => void): () => void {
  catalogUpdateListeners.add(listener);
  return () => {
    catalogUpdateListeners.delete(listener);
  };
}

function publishCatalogUpdates(updates: CatalogSourceUpdate[]): void {
  catalogUpdates = updates.length ? { id: ++catalogUpdateSeq, updates } : null;
  for (const listener of catalogUpdateListeners) listener();
}

/** Drop one source from the snapshot (manual sync applied it) and
 *  republish — an empty list clears the grouped notification. */
function clearCatalogSourceUpdate(sourceId: string): void {
  if (!catalogUpdates?.updates.some((u) => u.sourceId === sourceId)) return;
  publishCatalogUpdates(catalogUpdates.updates.filter((u) => u.sourceId !== sourceId));
}

// ── Last manifest-check timestamps ─────────────────────────────────────────

const SEED_CHECKS_KEY = 'wodwiki.seedChecks';

function readSeedChecks(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEED_CHECKS_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'),
    );
  } catch {
    return {};
  }
}

function markSeedChecked(id: string, at: number): void {
  try {
    localStorage.setItem(SEED_CHECKS_KEY, JSON.stringify({ ...readSeedChecks(), [id]: at }));
  } catch {
    // Status timestamps are best-effort; a failed write keeps the old value.
  }
}

function seedCheckedAt(id: string): number | null {
  return readSeedChecks()[id] ?? null;
}

export async function runSeedSync(deps: SeedSyncDeps = {}): Promise<SeedSyncOutcome> {
  const outcomes: SeedSyncOutcome[] = [];
  const storage = deps.storage ?? mainThreadSeedImportStorage();
  // Background load checks collect per-source update states; the run ends
  // with ONE grouped snapshot — never per-source notifications.
  const updates = deps.mode === 'background' ? new Map<string, CatalogSourceUpdate>() : undefined;

  if (!(deps.isEnabled ?? isSeedImportEnabled)()) return 'disabled';


  const owner = deps.owner ?? `seed-${(deps.now ?? Date.now)()}-${Math.random().toString(36).slice(2, 8)}`;
  const sources = deps.sources ?? defaultSeedSources();

  // Production runs (boot load check, manual syncs) execute inside the seed
  // worker so manifest fetches, chunk parsing, and imports never block the
  // UI. A null result means the worker is unusable (or injected deps force
  // the main thread, as in tests) — the direct path below reruns it.
  if (!deps.storage && !deps.now && workerSupported()) {
    const viaWorker = await runSeedSyncViaWorker(sources, deps, owner);
    if (viaWorker) return viaWorker;
  }

  for (const [index, spec] of sources.entries()) {
    // A failing source emits its own finished('error'); the run continues.
    const outcome = await runSourceSync(spec, deps, storage, owner, index + 1, sources.length, updates);
    console.debug(`[seedSync] ${spec.id} outcome: ${outcome}`);
    outcomes.push(outcome);
  }
  if (updates) publishCatalogUpdates([...updates.values()]);
  return aggregateOutcomes(outcomes);
}

/**
 * Boot-time seed policy (app bootstrap), layered on runSeedSync:
 *  - fresh browser (no core checkpoint): the core seed only — home ungates
 *    on the committed canvas chunk while the rest of the library imports;
 *    subscribed community libraries join from the next visit (a fresh
 *    browser has no imported checkpoints to subscribe);
 *  - returning browser (web or API storage — both honor the subscription
 *    and auto-sync choices): every consumed subscribed catalog is checked
 *    in the background, nonblocking, consulting remote manifests even when
 *    the bundled core's embedded version matches the stored checkpoint.
 *    Sources with auto-sync on apply updates; the rest are check-only and
 *    surface one grouped update snapshot instead of importing.
 */
export async function runBootSeedSync(deps: SeedSyncDeps = {}): Promise<SeedSyncOutcome> {
  const all = deps.sources ?? defaultSeedSources();
  const storage = deps.storage ?? mainThreadSeedImportStorage();
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
  const sources = all.filter((s) => s.id === 'core' || isSeedSubscribed(s.id) || getSubscribedNotebooks(s.id) !== null);
  return runSeedSync({
    ...deps,
    sources,
    probeManifests: true,
    mode: 'background',
    reportActivity: false,
  });
}

async function runSourceSync(
  spec: SeedSourceSpec,
  deps: SeedSyncDeps,
  storage: SeedImportStorage,
  owner: string,
  sourceIndex: number,
  totalSources: number,
  updates?: Map<string, CatalogSourceUpdate>,
): Promise<SeedSyncOutcome> {
  const now = deps.now ?? Date.now;
  const onProgress = deps.onProgress;
  // Background load checks stay silent: no activity entry, no per-source
  // completion report — their outcome is the grouped snapshot alone.
  const report = deps.reportActivity !== false;
  // `finished` closes every attempted source — after claim release and
  // first-paint hydration: a run is never complete before its commits.
  const finish = (outcome: SeedSyncOutcome, error: string | null = null): void =>
    onProgress?.({ phase: 'finished', outcome, error, sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources });

  onProgress?.({ phase: 'checking', sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources });
  const endActivity = report ? beginSyncActivity('download', spec.label) : () => {};
  try {
    // Storage/network/decision core (seedSyncCore) — the same unit the seed
    // worker executes; this direct path drives it on the main thread.
    const result = await runSourceSyncCore(
      {
        id: spec.id,
        label: spec.label,
        source: spec.source,
        embeddedVersion: spec.embeddedVersion,
        autoSyncOn: isSeedAutoSync(spec.id),
        ...(spec.tier ? { tier: spec.tier } : {}),
        notebookIds: getSubscribedNotebooks(spec.id) ?? undefined,
        granularRecords: true,
      },
      { storage, owner, now, force: deps.force, probeManifests: deps.probeManifests, background: deps.mode === 'background' },
      {
        // Tag importer chunk phases with this source's identity. No
        // subscriber → no per-event allocation.
        onProgress: (progress) => {
          reportSyncProgress({
            sourceId: spec.id,
            sourceLabel: spec.label,
            chunkId: progress.chunkId,
            recordId: progress.recordId,
            completedRecords: progress.completedRecords,
            totalRecords: progress.totalRecords,
            completedChunks: progress.completedChunks,
            totalChunks: progress.totalChunks,
            phase: progress.phase,
          });
          onProgress?.({ ...progress, sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources });
        },
        // First paint: as soon as the canvas chunk (home page + canvas
        // routes) is committed, refresh content consumers — the home page
        // renders while the rest of the library is still importing. Sources
        // without a canvas chunk never trigger it.
        onFirstPaint: () => {
          invalidateSeedContent();
          deps.onFirstPaint?.();
        },
      },
    );
    applySourceResult(spec, result, deps, updates);
    finish(result.outcome, result.error);
    return result.outcome;
  } finally {
    reportSyncProgress(null);
    endActivity();
  }
}

// ── Status (Settings → Data) ───────────────────────────────────────────────

export interface SeedVersionInfo {
  version: number;
  schema: number;
  builtAt: string;
}

/** One notebook inside a seed's published manifest — the rows a Subscribe
 *  brings for it, and whether this device already holds them. */
export interface SeedNotebookStatus {
  /** Registry notebook id (the chunk id for a seed we have no registry entry for). */
  id: string;
  label: string;
  chunkId: string;
  /** Published rows / bytes (0 when the manifest is unreachable). */
  count: number;
  bytes: number;
  /** The stored checkpoint covers this chunk. */
  imported: boolean;
}

export interface SeedSourceStatus {
  id: string;
  label: string;
  /** The seed directory this source syncs from. */
  url: string;
  /** Published Git repository link — absent when the source publishes none. */
  repositoryUrl?: string;
  /** One-line registry description of what the seed delivers. */
  description?: string;
  /** False for theme/custom seeds — they never import at boot. */
  autoImport: boolean;
  /** Every notebook this seed publishes, in manifest order. */
  notebooks: SeedNotebookStatus[];
  /** The import checkpoint in Storage — null before the first import. */
  stored: (SeedVersionInfo & { importedAt: number }) | null;
  /** The published manifest — null when unreachable (offline). */
  remote: SeedVersionInfo | null;
  remoteError: string | null;
  /** Stored checkpoint matches the published manifest. */
  upToDate: boolean;
  /** Total rows across the published manifest's chunks (0 when unreachable). */
  count: number;
  /** Total published chunk bytes (0 when unreachable). */
  bytes: number;
  /** Epoch ms of the last successful manifest check — null before one. */
  checkedAt: number | null;
  subscribed: boolean;
  /** Persisted per-source auto-sync choice (core defaults on, others off). */
  autoSync: boolean;
}

export interface SeedStatus {
  sources: SeedSourceStatus[];
}

/**
 * Sync one source by id (Settings → Sync per-source button, catalog
 * management, or /subscribe intake). Picks the spec from the registered
 * sources; unknown ids (e.g. a removed custom source) report 'error'. No
 * `force` default: a plain sync imports when the stored checkpoint is
 * missing or behind the manifest — manual syncs are never auto-sync-gated.
 *
 * `deps.subscribe === false` is the Import Once boundary: content imports,
 * the subscription stays untouched when one already exists, and a new
 * source gets an explicit unsubscribed record so the checkpoint-migration
 * on the next load cannot silently subscribe it.
 */
export async function syncSeedSource(id: string, deps: SeedSyncDeps = {}): Promise<SeedSyncOutcome> {
  const spec = (deps.sources ?? defaultSeedSources()).find(s => s.id === id);
  if (!spec) {
    console.warn(`[seedSync] unknown seed source: ${id}`);
    return 'error';
  }
  const outcome = await runSeedSync({ ...deps, sources: [spec] });
  if (outcome === 'imported' || outcome === 'current') {
    if (deps.subscribe === false) {
      // Import Once: pin the explicit choice, but never downgrade a live
      // subscription (the flag only ever guards NEW registrations).
      if (!isSeedSubscribed(id)) setSeedSubscribed(id, false);
    } else {
      // A manual sync that restored a healthy checkpoint subscribes the
      // library for background refresh — both a fresh import and an
      // already-current library the user explicitly chose. 'busy'/'error'/
      // 'server-stale' never change a persisted choice. (Core: no-op.)
      setSeedSubscribed(id, true);
    }
    // A successful manual sync applied (or confirmed) the remote version —
    // the pending-update marker is stale and the grouped snapshot clears.
    clearCatalogSourceUpdate(id);
  }
  return outcome;
}

// ── Unsubscribe / delete (exact checkpoint ownership) ──────────────────────

/**
 * Remove one source's imported content and checkpoint, and stop its
 * subscription and auto-sync — keeping the source row and its config for a
 * later Subscribe. Ownership is exact (`SeedMetaRecord.chunks` memberships),
 * so a package/custom-source removal can never touch another source's
 * rows, and user-authored notes always survive. Core is protected. Storage
 * failures propagate: a swallowed deletion would leave a stale checkpoint
 * that re-imports the removed content on the next sync.
 */
export async function unsubscribeSeedSource(id: string, deps: Pick<SeedSyncDeps, 'storage'> = {}): Promise<{ deleted: number }> {
  if (id === 'core') return { deleted: 0 };
  const storage = deps.storage ?? mainThreadSeedImportStorage();
  const meta = await storage.getSeedMeta(seedMetaKey(id));
  const deleted = meta ? await storage.removeSourceContent(meta) : 0;
  setSeedSubscribed(id, false);
  setSeedAutoSync(id, false);
  clearCatalogSourceUpdate(id);
  invalidateSeedContent();
  const effortRegistry = getAppEffortRegistry();
  if (effortRegistry.isInitialized()) await hydrateAppEffortRegistry(effortRegistry);
  const equipmentRegistry = getAppEquipmentRegistry();
  if (equipmentRegistry.isInitialized()) await hydrateAppEquipmentRegistry(equipmentRegistry);
  defaultBroadcast({ kind: 'seed-removed', source: id });
  return { deleted };
}

/**
 * Unsubscribe AND remove the source entry: a custom source leaves the
 * registry; a built-in catalog row is hidden (its config lives in code).
 * Core is protected — deleting the app's own seed is a no-op.
 */
export async function deleteSeedSource(id: string, deps: Pick<SeedSyncDeps, 'storage'> = {}): Promise<{ deleted: number }> {
  if (id === 'core') return { deleted: 0 };
  const result = await unsubscribeSeedSource(id, deps);
  if (customSeedSources().some((s) => s.id === id)) removeCustomSeedSource(id);
  else hideSeedSourceRow(id);
  return result;
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
  const storage = deps.storage ?? mainThreadSeedImportStorage();
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

/**
 * Probe specifically for the bundled core source's checkpoint. Unlike
 * readSeedCoverage (which flips coreImported for ANY non-disabled auto-import
 * source), this accurately gates the initial boot population of the core corpus.
 */
export async function isCoreSeedImported(deps: Pick<SeedSyncDeps, 'storage'> = {}): Promise<boolean> {
  const storage = deps.storage ?? mainThreadSeedImportStorage();
  try {
    const meta = await storage.getSeedMeta(seedMetaKey('core'));
    return (meta?.seedVersion ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Per-source local + remote seed versions for the Settings status card and
 * catalog management. Validates each fetched manifest and records the check
 * time; counts/bytes come from the validated manifest (0 when unreachable).
 */
export async function readSeedStatus(deps: SeedSyncDeps = {}): Promise<SeedStatus> {
  const storage = deps.storage ?? mainThreadSeedImportStorage();
  const sources = await Promise.all(
    (deps.sources ?? defaultSeedSources()).map(async (spec) => {
      const stored = await storage.getSeedMeta(seedMetaKey(spec.id));
      let remote: SeedSourceStatus['remote'] = null;
      let remoteError: string | null = null;
      let manifest: SeedManifest | null = null;
      let repositoryUrl = spec.repositoryUrl;
      try {
        manifest = assertManifest(await spec.source.fetchManifest());
        remote = { version: manifest.version, schema: manifest.schema, builtAt: manifest.builtAt };
        // A seed may publish its repository link only in the manifest —
        // the registry entry is not required to carry it.
        repositoryUrl ??= safeRepositoryUrl(manifest.repositoryUrl ?? '') ?? undefined;
        markSeedChecked(spec.id, (deps.now ?? Date.now)());
      } catch (err) {
        remoteError = err instanceof Error ? err.message : String(err);
      }
      const notebooks = seedNotebookStatuses(spec.id, manifest, stored);
      return {
        id: spec.id,
        label: spec.label,
        url: spec.url,
        ...(repositoryUrl ? { repositoryUrl } : {}),
        ...(spec.description ? { description: spec.description } : {}),
        autoImport: spec.autoImport !== false,
        notebooks,
        stored: stored
          ? { version: stored.seedVersion, schema: stored.schema, builtAt: stored.builtAt, importedAt: stored.importedAt }
          : null,
        remote,
        remoteError,
        upToDate:
          stored != null && remote != null && stored.schema === SEED_SCHEMA && stored.seedVersion === remote.version,
        count: notebooks.reduce((n, notebook) => n + notebook.count, 0),
        bytes: notebooks.reduce((n, notebook) => n + notebook.bytes, 0),
        checkedAt: seedCheckedAt(spec.id),
        subscribed: isSeedSubscribed(spec.id),
        autoSync: isSeedAutoSync(spec.id),
      };
    }),
  );
  return { sources };
}

/** A seed's notebooks from its published manifest (registry labels where we
 *  know the chunk), falling back to the registry when it is unreachable. */
function seedNotebookStatuses(
  seedId: string,
  manifest: SeedManifest | null,
  stored: SeedMetaRecord | undefined,
): SeedNotebookStatus[] {
  const byChunkId: Record<string, { id: string; label: string }> = {};
  for (const notebook of notebooksOfSeed(seedId)) byChunkId[notebook.chunkId] = notebook;
  const published = (manifest?.chunks ?? []).map((chunk): SeedNotebookStatus => ({
    id: byChunkId[chunk.id]?.id ?? chunk.id,
    label: byChunkId[chunk.id]?.label ?? chunk.id,
    chunkId: chunk.id,
    count: chunk.count,
    bytes: chunk.bytes,
    imported: Boolean(stored?.chunks[chunk.id]),
  }));
  if (published.length > 0) return published;
  return notebooksOfSeed(seedId).map((notebook): SeedNotebookStatus => ({
    id: notebook.id,
    label: notebook.label,
    chunkId: notebook.chunkId,
    count: 0,
    bytes: 0,
    imported: Boolean(stored?.chunks[notebook.chunkId]),
  }));
}

/**
 * One-time checkpoint adoption (pre-seed-unit builds): those builds synced
 * one notebook at a time, so the rows and their exact ownership live in
 * per-notebook checkpoints (`seed:community-<slug>`). Each seed's notebook
 * records fold into the seed's own checkpoint — union of chunks and note ids,
 * highest published version — so a returning reader keeps the imported
 * content, the ownership that lets Unsubscribe remove exactly it, and the
 * "already imported" state, without re-downloading a chunk. Blanks the folded
 * records so ownership never lives in two places; runs before the
 * subscription migration, which probes the seed checkpoint.
 */
export async function adoptLegacySeedCheckpoints(deps: Pick<SeedSyncDeps, 'storage'> = {}): Promise<number> {
  const storage = deps.storage ?? mainThreadSeedImportStorage();
  let adopted = 0;
  for (const seed of SEED_SOURCES) {
    const metaKey = seedMetaKey(seed.id);
    try {
      const existing = await storage.getSeedMeta(metaKey);
      if (existing && existing.seedVersion > 0) continue;
      const legacy: SeedMetaRecord[] = [];
      for (const notebook of notebooksOfSeed(seed.id)) {
        if (notebook.id === seed.id) continue;
        const meta = await storage.getSeedMeta(seedMetaKey(notebook.id));
        if (meta && meta.seedVersion > 0) legacy.push(meta);
      }
      if (legacy.length === 0) continue;
      const newest = legacy.reduce((a, b) => (b.seedVersion > a.seedVersion ? b : a));
      // The tier belongs to the seed, not to one folded notebook — take it
      // from whichever record carries it.
      const tier = legacy.find((meta) => meta.tier)?.tier;
      const merged: SeedMetaRecord = {
        key: metaKey,
        schema: newest.schema,
        seedVersion: newest.seedVersion,
        builtAt: newest.builtAt,
        importedAt: Math.max(...legacy.map((meta) => meta.importedAt)),
        chunks: Object.assign({}, ...legacy.map((meta) => meta.chunks)),
        ...(tier ? { tier } : {}),
        claim: null,
      };
      await storage.putSeedMeta(merged, existing ?? null);
      for (const meta of legacy) {
        await storage.putSeedMeta({ ...meta, seedVersion: 0, chunks: {}, claim: null }, meta);
      }
      adopted += 1;
    } catch (err) {
      console.warn(`[seedSync] legacy checkpoint adoption failed for ${seed.id}`, err);
    }
  }
  return adopted;
}
