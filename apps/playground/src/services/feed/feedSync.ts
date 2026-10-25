/**
 * feedSync — the boot orchestrator (docs/prototypes/seed-data-unification.md
 * § Version check), multi-feed edition. Ties together per registered feed:
 * flag gate → skip-fetch fast path → multi-tab claim → manifest fetch →
 * version decision → FeedImporter (canvas chunk first, refreshing content
 * consumers for first paint) → broadcast. Sources run in registry order —
 * the core feed (playground canvas + template) before community libraries —
 * each with an independent checkpoint (`seed:<sourceId>` meta record), so
 * chunk membership and vanished-chunk sweeps never cross sources.
 */
import {
  SEED_BROADCAST_CHANNEL,
  SEED_SCHEMA,
  emptySeedMeta,
  seedMetaKey,
  type SeedManifest,
  type SeedMetaRecord,
  type SeedPrecedenceTier,
} from '@/types/seed';
import type { FeedId } from '@bitcobblers/wod-wiki-core';
import type { FeedImportProgress } from './FeedImporter';
import { HttpFeedSource } from './HttpFeedSource';
import type { FeedImportStorage } from './FeedImportStorage';
import { mainThreadFeedImportStorage } from './feedStorageDefault';
import { assertManifest, type IFeedSource } from './IFeedSource';
import { EMBEDDED_FEED_VERSIONS } from './feedVersion';
import { customFeedSources, CORE_FEED_URL, FEED_SOURCES, notebooksOfFeed, hideFeedSourceRow, hiddenFeedSourceIds, removeCustomFeedSource, safeRepositoryUrl, toAbsoluteFeedUrl } from './feedSources';
import { getSubscribedNotebooks, isNotebookSubscribed, isFeedAutoSync, isFeedSubscribed, setFeedAutoSync, setFeedSubscribed } from './feedSubscriptions';
import { beginSyncActivity, reportSyncResult, reportSyncError, reportSyncProgress } from '@/services/syncActivity';
import { invalidateSeedContent } from '@/services/content/seedContent';
import { hydrateAppEffortRegistry, getAppEffortRegistry } from '@/services/effortRegistry';
import { refreshTagIndex } from '@/services/tags/tagCatalogue';
import { hydrateAppEquipmentRegistry, getAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { profileService, storageBackend } from '@/services/storage';
import { getActiveLocalDbName } from '@/services/storage/dataSettings';
import {
  runSourceSyncCore,
  type FeedSyncOutcome,
  type SourceSyncCoreResult,
} from './feedSyncCore';
import type { FeedWorkerToMain } from './feedSync.worker';

export { SEED_BROADCAST_CHANNEL } from '@/types/seed';
export { SEED_CLAIM_TTL_MS } from './feedSyncCore';
export type { FeedSyncOutcome } from './feedSyncCore';
export const FEED_IMPORT_FLAG = 'wodwiki.seedImport.enabled';

/** Default-on; '0' is the explicit opt-out. */
export function isFeedImportEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FEED_IMPORT_FLAG) !== '0';
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
export type FeedSyncProgress = {
  /** The registered feed this event belongs to. */
  sourceId: FeedId;
  /** The feed's display name. */
  sourceLabel: string;
  /** One-based position in this run's feed list. */
  sourceIndex: number;
  totalSources: number;
} & (
  | { phase: 'checking' }
  | FeedImportProgress
  | { phase: 'finished'; outcome: FeedSyncOutcome; error: string | null }
);

/** One registered feed: transport, identity, and build-stamped version. */
export interface FeedSourceSpec {
  /** The feed's id — namespaces the checkpoint (`seed:<id>`) and broadcasts. */
  id: FeedId;
  label: string;
  source: IFeedSource;
  /** The feed directory this source syncs from (status/link rendering). */
  url: string;
  /** Published Git repository link, when the source publishes one. */
  repositoryUrl?: string;
  /** `__FEED_VERSIONS__[id]` — this bundle's own build of the source's manifest. */
  embeddedVersion: number;
  /** Boot auto-import gate (default true). Non-auto feeds (user libraries,
  *  theme repos) never import on launch — default installs get playground
  *  content only; Subscribe imports them. */
  autoImport?: boolean;
  /** Checkpoint precedence tier — built-in corpus rows rank under user libraries. */
  tier?: SeedPrecedenceTier;
  /** One-line feed description (status cards). */
  description?: string;
}

/**
 * The default feeds, in import order. The bundled core feed carries the
 * app's own corpus (this repo's markdown/ — canvas pages, the page template,
 * and the effort/equipment/dashboards reference chunks; first paint, built at
 * build time by scripts/sync-seed.ts). Every other feed is one split content
 * repo publishing to its own GitHub Pages and syncing as an independent
 * source — subscribing imports every notebook it publishes. User-registered
 * libraries (a feed directory on any host) register the same way.
 */
export function defaultFeedSources(): FeedSourceSpec[] {
  const hidden = new Set(hiddenFeedSourceIds());
  const coreUrl = toAbsoluteFeedUrl(CORE_FEED_URL);
  return [
    {
      id: 'core',
      label: 'Core',
      source: new HttpFeedSource(coreUrl),
      url: coreUrl,
      embeddedVersion: EMBEDDED_FEED_VERSIONS['core'] ?? 0,
    },
    ...FEED_SOURCES.map((feed): FeedSourceSpec => ({
      id: feed.id,
      label: feed.label,
      source: new HttpFeedSource(feed.url),
      url: feed.url,
      ...(feed.repositoryUrl ? { repositoryUrl: feed.repositoryUrl } : {}),
      // Never bundled: embeddedVersion 0 keeps every sync off the skip-fetch
      // fast path — GitHub Pages sends no build-stamp compatibility.
      embeddedVersion: 0,
      autoImport: feed.autoImport ?? false,
      tier: feed.tier,
      ...(feed.description ? { description: feed.description } : {}),
    })),
    // User-registered libraries (/settings/sync). Never auto-import; their
    // manifests are not build-stamped, so embeddedVersion 0 keeps them
    // off the skip-fetch fast path — every sync consults the manifest.
    ...customFeedSources().map((c): FeedSourceSpec => ({
      id: c.id,
      label: c.label,
      source: new HttpFeedSource(c.url),
      url: c.url,
      repositoryUrl: c.repositoryUrl,
      embeddedVersion: EMBEDDED_FEED_VERSIONS[c.id] ?? 0,
      autoImport: false,
    })),
  ].filter((spec) => !hidden.has(spec.id));
}

export interface FeedSyncDeps {
  sources?: FeedSourceSpec[];
  storage?: FeedImportStorage;
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
  onProgress?: (progress: FeedSyncProgress) => void;
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
  // The tag catalogue learned about the import through the broadcast; the
  // importing context does not receive its own broadcast, so it re-reads.
  await refreshTagIndex().catch(() => { /* The catalogue keeps the tags it has. */ });
  const registry = getAppEffortRegistry();
  if (registry.isInitialized()) await hydrateAppEffortRegistry(registry);
  const equipmentRegistry = getAppEquipmentRegistry();
  if (equipmentRegistry.isInitialized()) await hydrateAppEquipmentRegistry(equipmentRegistry);
}

/** Worst-first aggregation: readiness and toasts only need one verdict. */
function aggregateOutcomes(outcomes: FeedSyncOutcome[]): FeedSyncOutcome {
  if (outcomes.includes('error')) return 'error';
  if (outcomes.includes('imported')) return 'imported';
  if (outcomes.includes('update-pending')) return 'update-pending';
  if (outcomes.includes('server-stale')) return 'server-stale';
  if (outcomes.includes('busy')) return 'busy';
  return 'current';
}

/** Shared side effects applied to one finished source result (both drivers). */
function applySourceResult(
  spec: FeedSourceSpec,
  result: SourceSyncCoreResult,
  deps: FeedSyncDeps,
  updates: Map<string, CatalogSourceUpdate> | undefined,
): void {
  const now = deps.now ?? Date.now;
  const broadcast = deps.broadcast ?? defaultBroadcast;
  const report = deps.reportActivity !== false;
  if (result.manifestChecked) markFeedChecked(spec.id, now());
  if (result.outcome === 'error') {
    const message = result.error ?? 'feed sync failed';
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
 * Run the whole sync inside feedSync.worker: manifest fetches, chunk JSON
 * parsing, row validation, and IndexedDB writes happen off the main thread.
 * The driver here translates messages back into the side effects the main
 * thread owns (progress, activity, content caches, registries, catalog
 * updates, check timestamps). Resolves null when the worker is unusable —
 * the caller reruns the direct path (idempotent: nothing applied before a
 * startup failure, and checkpoints/claims guard anything partial).
 */
async function runFeedSyncViaWorker(
  sources: FeedSourceSpec[],
  deps: FeedSyncDeps,
  owner: string,
): Promise<FeedSyncOutcome | null> {
  return await new Promise<FeedSyncOutcome | null>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./feedSync.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      console.warn('[feedSync] seed worker unavailable; running on main thread', err);
      resolve(null);
      return;
    }
    const updates = deps.mode === 'background' ? new Map<string, CatalogSourceUpdate>() : undefined;
    const outcomes: FeedSyncOutcome[] = [];
    const totalSources = sources.length;
    let received = false;
    const settle = (value: FeedSyncOutcome | null): void => {
      reportSyncProgress(null);
      worker.terminate();
      resolve(value);
    };
    worker.onerror = (event) => {
        console.warn('[feedSync] feed worker failed', event.message ?? 'unknown error');
        settle(received ? aggregateOutcomes(outcomes) : null);
    };
    worker.onmessage = (event: MessageEvent<FeedWorkerToMain>) => {
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
          sourceId: spec.id, sourceLabel: spec.label,
          sourceIndex: index + 1, totalSources,
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
        url: toAbsoluteFeedUrl(s.url),
        ...(s.tier ? { tier: s.tier } : {}),
        embeddedVersion: s.embeddedVersion,
        autoSyncOn: isFeedAutoSync(s.id),
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

function readFeedChecks(): Record<string, number> {
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

function markFeedChecked(id: string, at: number): void {
  try {
    localStorage.setItem(SEED_CHECKS_KEY, JSON.stringify({ ...readFeedChecks(), [id]: at }));
  } catch {
    // Status timestamps are best-effort; a failed write keeps the old value.
  }
}

function feedCheckedAt(id: string): number | null {
  return readFeedChecks()[id] ?? null;
}

export async function runFeedSync(deps: FeedSyncDeps = {}): Promise<FeedSyncOutcome> {
  const outcomes: FeedSyncOutcome[] = [];
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  // Background load checks collect per-source update states; the run ends
  // with ONE grouped snapshot — never per-source notifications.
  const updates = deps.mode === 'background' ? new Map<string, CatalogSourceUpdate>() : undefined;

  if (!(deps.isEnabled ?? isFeedImportEnabled)()) return 'disabled';


  const owner = deps.owner ?? `seed-${(deps.now ?? Date.now)()}-${Math.random().toString(36).slice(2, 8)}`;
  const sources = deps.sources ?? defaultFeedSources();

  // Production runs (boot load check, manual syncs) execute inside the feed
  // worker so manifest fetches, chunk parsing, and imports never block the
  // UI. A null result means the worker is unusable (or injected deps force
  // the main thread, as in tests) — the direct path below reruns it.
  if (!deps.storage && !deps.now && workerSupported()) {
    const viaWorker = await runFeedSyncViaWorker(sources, deps, owner);
    if (viaWorker) return viaWorker;
  }

  for (const [index, spec] of sources.entries()) {
    // A failing source emits its own finished('error'); the run continues.
    const outcome = await runSourceSync(spec, deps, storage, owner, index + 1, sources.length, updates);
    console.debug(`[feedSync] ${spec.id} outcome: ${outcome}`);
    outcomes.push(outcome);
  }
  if (updates) publishCatalogUpdates([...updates.values()]);
  return aggregateOutcomes(outcomes);
}

/**
 * Boot-time feed policy (app bootstrap), layered on runFeedSync:
 *  - fresh browser (no core checkpoint): the core feed only — home ungates
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
export async function runBootFeedSync(deps: FeedSyncDeps = {}): Promise<FeedSyncOutcome> {
  const all = deps.sources ?? defaultFeedSources();
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  // Retired remote Core Registry (seed:seed-core) folds into the local core
  // checkpoint before the boot decision reads it — the fold invalidates core
  // so this very run revalidates the folded records.
  await adoptLegacyCoreRegistryCheckpoint({ storage })
    .catch((err) => console.warn('[feedSync] core registry migration failed', err));
  let coreCheckpoint: SeedMetaRecord | undefined;
  try {
    coreCheckpoint = await storage.getSeedMeta(seedMetaKey('core'));
  } catch (err) {
    // Provider unreadable (offline, bad token, malformed config): nothing to
    // probe or import — the Data settings surface owns the error details.
    console.warn('[feedSync] boot provider probe failed', err);
    return 'error';
  }
  if (!coreCheckpoint || coreCheckpoint.seedVersion <= 0) {
    return runFeedSync({ ...deps, sources: all.filter((s) => s.autoImport !== false) });
  }
  const sources = all.filter((s) => s.id === 'core' || isFeedSubscribed(s.id) || getSubscribedNotebooks(s.id) !== null);
  return runFeedSync({
    ...deps,
    sources,
    probeManifests: true,
    mode: 'background',
    reportActivity: false,
  });
}

async function runSourceSync(
  spec: FeedSourceSpec,
  deps: FeedSyncDeps,
  storage: FeedImportStorage,
  owner: string,
  sourceIndex: number,
  totalSources: number,
  updates?: Map<string, CatalogSourceUpdate>,
): Promise<FeedSyncOutcome> {
  const now = deps.now ?? Date.now;
  const onProgress = deps.onProgress;
  // Background load checks stay silent: no activity entry, no per-source
  // completion report — their outcome is the grouped snapshot alone.
  const report = deps.reportActivity !== false;
  // `finished` closes every attempted source — after claim release and
  // first-paint hydration: a run is never complete before its commits.
  const finish = (outcome: FeedSyncOutcome, error: string | null = null): void =>
    onProgress?.({ phase: 'finished', outcome, error, sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources });

  onProgress?.({ phase: 'checking', sourceId: spec.id, sourceLabel: spec.label, sourceIndex, totalSources });
  const endActivity = report ? beginSyncActivity('download', spec.label) : () => {};
  try {
    // Storage/network/decision core (feedSyncCore) — the same unit the feed
    // worker executes; this direct path drives it on the main thread.
    const result = await runSourceSyncCore(
      {
        id: spec.id,
        label: spec.label,
        source: spec.source,
        embeddedVersion: spec.embeddedVersion,
        autoSyncOn: isFeedAutoSync(spec.id),
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

export interface FeedVersionInfo {
  version: number;
  schema: number;
  builtAt: string;
}

/** One notebook inside a feed's published manifest — the rows a Subscribe
 *  brings for it, and whether this device already holds them. */
export interface FeedNotebookStatus {
  /** Registry notebook id (the chunk id for a feed we have no registry entry for). */
  id: string;
  label: string;
  chunkId: string;
  /** Published rows / bytes (0 when the manifest is unreachable). */
  count: number;
  bytes: number;
  /** The stored checkpoint covers this chunk. */
  imported: boolean;
  subscribed?: boolean;
}

export interface FeedSourceStatus {
  /** The registered feed's id. */
  id: FeedId;
  label: string;
  /** The feed directory this source syncs from. */
  url: string;
  /** Published Git repository link — absent when the source publishes none. */
  repositoryUrl?: string;
  /** One-line registry description of what the feed delivers. */
  description?: string;
  /** False for theme/custom feeds — they never import at boot. */
  autoImport: boolean;
  /** Every notebook this feed publishes, in manifest order. */
  notebooks: FeedNotebookStatus[];
  /** The import checkpoint in Storage — null before the first import. */
  stored: (FeedVersionInfo & { importedAt: number }) | null;
  /** The published manifest — null when unreachable (offline). */
  remote: FeedVersionInfo | null;
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

export interface FeedStatus {
  sources: FeedSourceStatus[];
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
export async function syncFeedSource(id: string, deps: FeedSyncDeps = {}): Promise<FeedSyncOutcome> {
  const spec = (deps.sources ?? defaultFeedSources()).find(s => s.id === id);
  if (!spec) {
    console.warn(`[feedSync] unknown feed source: ${id}`);
    return 'error';
  }
  const outcome = await runFeedSync({ ...deps, sources: [spec] });
  if (outcome === 'imported' || outcome === 'current') {
    if (deps.subscribe === false) {
      // Import Once: pin the explicit choice, but never downgrade a live
      // subscription (the flag only ever guards NEW registrations).
      if (!isFeedSubscribed(id)) setFeedSubscribed(id, false);
    } else {
      // A manual sync that restored a healthy checkpoint subscribes the
      // library for background refresh — both a fresh import and an
      // already-current library the user explicitly chose. 'busy'/'error'/
      // 'server-stale' never change a persisted choice. (Core: no-op.)
      setFeedSubscribed(id, true);
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
export async function unsubscribeFeedSource(id: string, deps: Pick<FeedSyncDeps, 'storage'> = {}): Promise<{ deleted: number }> {
  if (id === 'core') return { deleted: 0 };
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  const meta = await storage.getSeedMeta(seedMetaKey(id));
  const deleted = meta ? await storage.removeSourceContent(meta) : 0;
  setFeedSubscribed(id, false);
  setFeedAutoSync(id, false);
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
 * Core is protected — deleting the app's own feed is a no-op.
 */
export async function deleteFeedSource(id: string, deps: Pick<FeedSyncDeps, 'storage'> = {}): Promise<{ deleted: number }> {
  if (id === 'core') return { deleted: 0 };
  const result = await unsubscribeFeedSource(id, deps);
  if (customFeedSources().some((s) => s.id === id)) removeCustomFeedSource(id);
  else hideFeedSourceRow(id);
  return result;
}

export interface FeedCoverage {
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
export async function readFeedCoverage(deps: Pick<FeedSyncDeps, 'sources' | 'storage'> = {}): Promise<FeedCoverage> {
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  let coreImported = false;
  let libraryImported = false;
  await Promise.all((deps.sources ?? defaultFeedSources()).map(async (spec) => {
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
 * readFeedCoverage (which flips coreImported for ANY non-disabled auto-import
 * source), this accurately gates the initial boot population of the core corpus.
 */
export async function isCoreFeedImported(deps: Pick<FeedSyncDeps, 'storage'> = {}): Promise<boolean> {
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  try {
    const meta = await storage.getSeedMeta(seedMetaKey('core'));
    return (meta?.seedVersion ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Per-source local + remote feed versions for the Settings status card and
 * catalog management. Validates each fetched manifest and records the check
 * time; counts/bytes come from the validated manifest (0 when unreachable).
 */
export async function readFeedStatus(deps: FeedSyncDeps = {}): Promise<FeedStatus> {
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  const sources = await Promise.all(
    (deps.sources ?? defaultFeedSources()).map(async (spec) => {
      const stored = await storage.getSeedMeta(seedMetaKey(spec.id));
      let remote: FeedSourceStatus['remote'] = null;
      let remoteError: string | null = null;
      let manifest: SeedManifest | null = null;
      let repositoryUrl = spec.repositoryUrl;
      try {
        manifest = assertManifest(await spec.source.fetchManifest());
        remote = { version: manifest.version, schema: manifest.schema, builtAt: manifest.builtAt };
        // A feed may publish its repository link only in the manifest —
        // the registry entry is not required to carry it.
        repositoryUrl ??= safeRepositoryUrl(manifest.repositoryUrl ?? '') ?? undefined;
        markFeedChecked(spec.id, (deps.now ?? Date.now)());
      } catch (err) {
        remoteError = err instanceof Error ? err.message : String(err);
      }
      const notebooks = feedNotebookStatuses(spec.id, manifest, stored);
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
        checkedAt: feedCheckedAt(spec.id),
        subscribed: isFeedSubscribed(spec.id),
        autoSync: isFeedAutoSync(spec.id),
      };
    }),
  );
  return { sources };
}

/** A feed's notebooks from its published manifest (registry labels where we
 *  know the chunk), falling back to the registry when it is unreachable. */
function feedNotebookStatuses(
  feedId: string,
  manifest: SeedManifest | null,
  stored: SeedMetaRecord | undefined,
): FeedNotebookStatus[] {
  const byChunkId: Record<string, { id: string; label: string }> = {};
  for (const notebook of notebooksOfFeed(feedId)) byChunkId[notebook.chunkId] = notebook;
  const published = (manifest?.chunks ?? []).map((chunk): FeedNotebookStatus => ({
    id: byChunkId[chunk.id]?.id ?? chunk.id,
    label: byChunkId[chunk.id]?.label ?? chunk.id,
    chunkId: chunk.id,
    count: chunk.count,
    bytes: chunk.bytes,
    imported: Boolean(stored?.chunks[chunk.id]),
    subscribed: isNotebookSubscribed(feedId, chunk.id),
  }));
  if (published.length > 0) return published;
  return notebooksOfFeed(feedId).map((notebook): FeedNotebookStatus => ({
    id: notebook.id,
    label: notebook.label,
    chunkId: notebook.chunkId,
    count: 0,
    bytes: 0,
    imported: Boolean(stored?.chunks[notebook.chunkId]),
    subscribed: isNotebookSubscribed(feedId, notebook.chunkId),
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
export async function adoptLegacyFeedCheckpoints(deps: Pick<FeedSyncDeps, 'storage'> = {}): Promise<number> {
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  let adopted = 0;
  for (const seed of FEED_SOURCES) {
    const metaKey = seedMetaKey(seed.id);
    try {
      const existing = await storage.getSeedMeta(metaKey);
      if (existing && existing.seedVersion > 0) continue;
      const legacy: SeedMetaRecord[] = [];
      for (const notebook of notebooksOfFeed(seed.id)) {
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
      console.warn(`[feedSync] legacy checkpoint adoption failed for ${seed.id}`, err);
    }
  }
  return adopted;
}

/**
 * One-time repair for notes imported before the feed stamp existed: the
 * import path now records which feed delivered a note, but notes already in
 * Storage carry only the seed stamps. The checkpoints say which feed
 * delivered them — the repair reads the checkpoint memberships and stamps
 * the still-unstamped, seed-delivered notes, without republishing anything
 * and without touching a note the user owns. Idempotent: a stamped note is
 * never stamped again. Returns the number of notes stamped.
 */
export async function adoptFeedProvenance(deps: Pick<FeedSyncDeps, 'storage'> = {}): Promise<number> {
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  return await storage.backfillFeedProvenance();
}

/**
 * One-time upgrade for the retired remote Core Registry: builds before the
 * unification synced `wod-wiki-seed-core` into a `seed:seed-core` checkpoint
 * (efforts/equipment/dashboards chunks). Those memberships fold into the
 * local core checkpoint, which is then invalidated (empty builtAt, claim
 * cleared — seedVersion PRESERVED so a returning user stays offline-ready;
 * the builtAt mismatch forces revalidation on the next sync that reaches
 * the manifest; a never-imported core keeps version 0) against the
 * authoritative local corpus — rows the corpus dropped are swept, rows it
 * still publishes are reclaimed, user edits always win.
 * Core is invalidated BEFORE the legacy record is blanked: a crash in
 * between just re-runs the migration on the next boot, while the reverse
 * order could blank the only copy of the memberships. Notes are never
 * touched. Idempotent: the legacy record is blanked to the emptySeedMeta
 * shape via the putSeedMeta CAS, so a re-run finds nothing to upgrade.
 */
export async function adoptLegacyCoreRegistryCheckpoint(deps: Pick<FeedSyncDeps, 'storage'> = {}): Promise<boolean> {
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  const legacyKey = seedMetaKey('seed-core');
  const legacy = await storage.getSeedMeta(legacyKey);
  // Older checkpoints may omit chunks; normalize before reading it.
  const legacyChunks = legacy?.chunks ?? {};
  // Skip only an actually blank checkpoint: a crashed sync can leave
  // seedVersion 0 with real memberships (and a claim) that must still fold.
  if (!legacy || (legacy.seedVersion <= 0 && Object.keys(legacyChunks).length === 0 && !legacy.claim)) return false;
  const coreKey = seedMetaKey('core');
  const core = await storage.getSeedMeta(coreKey);
  // Core keeps every membership it has; the registry's chunks fold in — a
  // chunk both own unions its note ids so neither build's rows lose ownership.
  // noteIds is optional on older checkpoints; normalize before spreading.
  const chunks: SeedMetaRecord['chunks'] = { ...core?.chunks };
  for (const [chunkId, membership] of Object.entries(legacyChunks)) {
    const existing = chunks[chunkId];
    chunks[chunkId] = existing
      ? { sha256: existing.sha256, noteIds: [...new Set([...(existing.noteIds ?? []), ...(membership.noteIds ?? [])])] }
      : { ...membership, noteIds: membership.noteIds ?? [] };
  }
  const invalidated: SeedMetaRecord = core
    ? { ...core, builtAt: '', claim: null, chunks }
    : { ...emptySeedMeta(coreKey), chunks };
  await storage.putSeedMeta(invalidated, core ?? null);
  await storage.putSeedMeta(emptySeedMeta(legacyKey), legacy);
  return true;
}
