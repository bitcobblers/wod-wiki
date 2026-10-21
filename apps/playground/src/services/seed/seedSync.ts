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
  type SeedMetaRecord,
} from '@/types/seed';
import type { SeedImportProgress } from './SeedImporter';
import { HttpSeedSource } from './HttpSeedSource';
import type { SeedImportStorage } from './SeedImportStorage';
import { mainThreadSeedImportStorage } from './seedStorageDefault';
import { assertManifest, type ISeedSource } from './ISeedSource';
import { EMBEDDED_SEED_VERSIONS } from './seedVersion';
import { customSeedSources, CORE_SEED_URL, COMMUNITY_SEED_URL, COMMUNITY_REPOSITORY_URL, FeedSeedSource, listSyncPackages, hideSeedSourceRow, hiddenSeedSourceIds, removeCustomSeedSource, safeRepositoryUrl } from './seedSources';
import { isSeedAutoSync, isSeedSubscribed, setSeedAutoSync, setSeedSubscribed } from './seedSubscriptions';
import { beginSyncActivity, reportSyncResult, reportSyncError } from '@/services/syncActivity';
import { invalidateSeedContent } from '@/services/content/seedContent';
import { hydrateAppEffortRegistry, getAppEffortRegistry } from '@/services/effortRegistry';
import { hydrateAppEquipmentRegistry, getAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { profileService, storageBackend, storageService } from '@/services/storage';
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

/** One registered seed library: transport, identity, and build-stamped version. */
export interface SeedSourceSpec {
  /** Seed-source identity — namespaces the checkpoint (`seed:<id>`) and broadcasts. */
  id: string;
  label: string;
  source: ISeedSource;
  /** The seed directory this source syncs from (status/link rendering). */
  url: string;
  /** Published Git repository link, when the source publishes one. */
  repositoryUrl?: string;
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
  const hidden = new Set(hiddenSeedSourceIds());
  return [
    {
      id: 'core',
      label: 'Core (playground)',
      source: new HttpSeedSource(CORE_SEED_URL),
      url: CORE_SEED_URL,
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
      url: COMMUNITY_SEED_URL,
      repositoryUrl: COMMUNITY_REPOSITORY_URL,
      embeddedVersion: 0,
      autoImport: false,
    },
    // Built-in package sources: each is a filtered view of its notebook's
    // own repo (pkg.seedUrl) syncing only its own chunk — a package sync
    // never downloads a whole library, and repos sync independently.
    // Built-ins only: listSyncPackages mirrors custom sources as package
    // views too, and those get their own specs below — emitting both would
    // duplicate every custom-source row.
    ...listSyncPackages().filter((pkg) => pkg.category !== 'custom').map((pkg): SeedSourceSpec => ({
      id: pkg.id,
      label: pkg.label,
      source: new FeedSeedSource(new HttpSeedSource(pkg.seedUrl), pkg.chunkId),
      url: pkg.seedUrl,
      repositoryUrl: pkg.repositoryUrl,
      embeddedVersion: 0,
      autoImport: pkg.autoImport ?? false,
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
        url: s.url,
        ...(s.source instanceof FeedSeedSource ? { chunkId: s.source.chunkId } : {}),
        embeddedVersion: s.embeddedVersion,
        autoSyncOn: isSeedAutoSync(s.id),
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
  const sources = all.filter((s) => s.id === 'core' || isSeedSubscribed(s.id));
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
      },
      { storage, owner, now, force: deps.force, probeManifests: deps.probeManifests, background: deps.mode === 'background' },
      {
        // Tag importer chunk phases with this source's identity. No
        // subscriber → no per-event allocation.
        onProgress: onProgress
          ? (progress) => onProgress({ ...progress, sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources })
          : undefined,
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
  /** The seed directory this source syncs from. */
  url: string;
  /** Published Git repository link — absent when the source publishes none. */
  repositoryUrl?: string;
  /** False for community/catalog sources — they never import at boot. */
  autoImport: boolean;
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

/**
 * Home-tour removal (TourJumpSection/OfferingTiers): exact-ownership
 * unsubscribe for a package — same semantics as unsubscribeSeedSource.
 */
export async function removePackageFromLibrary(packageId: string): Promise<{ deleted: number }> {
  return unsubscribeSeedSource(packageId);
}

/**
 * Check whether a package is present in the library (subscribed or has
 * imported rows), by exact checkpoint/chunk provenance only.
 */
export async function isPackageInLibrary(packageId: string): Promise<boolean> {
  if (isSeedSubscribed(packageId)) return true;
  const pkg = listSyncPackages().find((p) => p.id === packageId);
  const chunkId = pkg?.chunkId ?? packageId;
  // A package sync writes its own checkpoint; before that, membership
  // lives in the community library checkpoint the package syncs from.
  const storage = mainThreadSeedImportStorage();
  for (const key of [seedMetaKey(packageId), seedMetaKey('community')]) {
    const meta = await storage.getSeedMeta(key);
    if (meta?.chunks[chunkId]) return true;
  }
  const allNotes = await storageService.getAllNotes();
  return allNotes.some((note) => note.seedOrigin === 'seed' && note.seedChunkId === chunkId);
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
 * Per-source local + remote seed versions for the Settings status card and
 * catalog management. Validates each fetched manifest and records the check
 * time; counts/bytes come from the validated manifest (0 when unreachable).
 */
export async function readSeedStatus(deps: SeedSyncDeps = {}): Promise<SeedStatus> {
  const storage = deps.storage ?? mainThreadSeedImportStorage();
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
      let count = 0;
      let bytes = 0;
      let repositoryUrl = spec.repositoryUrl;
      try {
        const manifest = assertManifest(await spec.source.fetchManifest());
        remote = { version: manifest.version, schema: manifest.schema, builtAt: manifest.builtAt };
        count = manifest.chunks.reduce((n, c) => n + c.count, 0);
        bytes = manifest.chunks.reduce((n, c) => n + c.bytes, 0);
        // A source may publish its repository link only in the manifest —
        // the registry entry is not required to carry it.
        repositoryUrl ??= safeRepositoryUrl(manifest.repositoryUrl ?? '') ?? undefined;
        markSeedChecked(spec.id, (deps.now ?? Date.now)());
      } catch (err) {
        remoteError = err instanceof Error ? err.message : String(err);
      }
      return {
        id: spec.id,
        label: spec.label,
        url: spec.url,
        ...(repositoryUrl ? { repositoryUrl } : {}),
        autoImport: spec.autoImport !== false,
        stored: stored
          ? { version: stored.seedVersion, schema: stored.schema, builtAt: stored.builtAt, importedAt: stored.importedAt }
          : null,
        remote,
        remoteError,
        upToDate:
          stored != null && remote != null && stored.schema === SEED_SCHEMA && stored.seedVersion === remote.version,
        count,
        bytes,
        checkedAt: seedCheckedAt(spec.id),
        subscribed: isSeedSubscribed(spec.id),
        autoSync: isSeedAutoSync(spec.id),
      };
    }),
  );
  return { sources };
}
