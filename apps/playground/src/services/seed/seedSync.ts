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
  LEGACY_SEED_META_KEY,
  SEED_BROADCAST_CHANNEL,
  SEED_SCHEMA,
  seedMetaKey,
  type SeedMetaRecord,
} from '@/types/seed';
import { SeedImporter, type SeedImportProgress } from './SeedImporter';
import { HttpSeedSource } from './HttpSeedSource';
import { IndexedDBSeedImportStorage, type SeedImportStorage } from './SeedImportStorage';
import type { ISeedSource } from './ISeedSource';
import { decideSeedImport, EMBEDDED_SEED_VERSIONS, storedSeedIsCurrent } from './seedVersion';
import { customSeedSources } from './seedSources';
import { invalidateSeedContent } from '@/services/content/seedContent';
import { hydrateAppEffortRegistry, getAppEffortRegistry } from '@/services/effortRegistry';
import { readDataSettings, storage, storageBackend } from '@/services/storage';

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
  const base = import.meta.env.BASE_URL;
  return [
    {
      id: 'core',
      label: 'Core (playground)',
      source: new HttpSeedSource(`${base}seed/core/`),
      embeddedVersion: EMBEDDED_SEED_VERSIONS['core'] ?? 0,
    },
    {
      id: 'community',
      label: 'Community',
      // Published by wod-wiki-community's main pipeline to its repo Pages;
      // embeddedVersion stays 0 (never bundled) so every sync consults the
      // remote manifest — GitHub Pages sends no build-stamp compatibility.
      source: new HttpSeedSource('https://bitcobblers.github.io/wod-wiki-community/'),
      embeddedVersion: 0,
      autoImport: false,
    },
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
  /** Live progress stream (Settings → Sync): checking → chunk phases → finished per source. */
  onProgress?: (progress: SeedSyncProgress) => void;
}

function defaultBroadcast(message: unknown): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel(SEED_BROADCAST_CHANNEL).postMessage(message);
    }
  } catch {
    // Cross-tab notification is best-effort.
  }
}

function freshClaimIsOther(meta: SeedMetaRecord | undefined, owner: string, now: number): boolean {
  const claim = meta?.claim;
  return !!claim && claim.owner !== owner && now - claim.at < SEED_CLAIM_TTL_MS;
}

export async function runSeedSync(deps: SeedSyncDeps = {}): Promise<SeedSyncOutcome> {
  const outcomes: SeedSyncOutcome[] = [];
  const storage = deps.storage ?? new IndexedDBSeedImportStorage();

  if (!(deps.isEnabled ?? isSeedImportEnabled)()) return 'disabled';

  // One-time legacy cleanup: pre-multi-seed checkpoints lived under the
  // single 'seed' key. Per-source checkpoints start empty and re-apply
  // everything once (ownership-gated upserts; user work is never lost).
  try {
    if (await storage.getSeedMeta(LEGACY_SEED_META_KEY)) {
      await storage.deleteSeedMeta(LEGACY_SEED_META_KEY);
    }
  } catch {
    // Best-effort; an unremovable legacy record is inert — nothing reads it.
  }

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
 *  - browser providers (IndexedDB / Turso) auto-import the core seed only —
 *    community/catalog libraries never import on launch (Re-sync Now covers
 *    them);
 *  - on Turso, a database that already carries a core seed checkpoint keeps
 *    its content — migration copies checkpoints, so only a fresh-empty
 *    remote gets the core boot seed (the core seed owns only its own rows,
 *    so a user-data-only remote is safe to seed into);
 *  - API builds keep the prior behavior: every registered source syncs.
 */
export async function runBootSeedSync(deps: SeedSyncDeps = {}): Promise<SeedSyncOutcome> {
  if (storageBackend === 'api') return runSeedSync(deps);
  const sources = (deps.sources ?? defaultSeedSources()).filter((s) => s.autoImport !== false);
  try {
    const settings = readDataSettings();
    if (settings.state === 'turso') {
      // Any core checkpoint (multi-source or legacy single-key) means this
      // database was seeded before — never auto-import over it. Generic meta
      // rows (notebook prefs etc.) must not block the boot seed.
      const meta = storage.readonly('meta');
      if (await meta.get(seedMetaKey('core'))) return 'current';
      if (await meta.get(LEGACY_SEED_META_KEY)) return 'current';
    }
  } catch (err) {
    // Provider unreadable (offline, bad token, malformed config): nothing to
    // probe or import — the Data settings surface owns the error details.
    console.warn('[seedSync] boot provider probe failed', err);
    return 'error';
  }
  return runSeedSync({ ...deps, sources });
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
  try {
    const stored = await storage.getSeedMeta(metaKey);

    // Skip-fetch fast path: this bundle's own seed is already stored.
    if (!deps.force && storedSeedIsCurrent(stored, spec.embeddedVersion)) {
      finish('current');
      return 'current';
    }
    if (freshClaimIsOther(stored, owner, now())) {
      finish('busy');
      return 'busy';
    }

    const manifest = await spec.source.fetchManifest();
    const decision = deps.force ? 'import' : decideSeedImport(stored?.seedVersion, manifest.version);
    if (decision === 'server-stale') {
      finish('server-stale');
      return 'server-stale';
    }
    // A stored checkpoint from a different seed schema migrates even when the
    // manifest version is unchanged — the re-apply is the migration that
    // repairs metadata on already-seeded rows (ownership still gates rows).
    // Decided AFTER the version table so a rollback (server-stale) keeps its
    // refusal: never migrate onto an older manifest.
    if (decision === 'current' && stored?.schema === SEED_SCHEMA) {
      finish('current');
      return 'current';
    }

    // Claim before the (potentially long) chunk imports.
    const claimed: SeedMetaRecord = { ...(stored ?? emptySeedMeta(metaKey)), claim: { owner, at: now() } };
    await storage.putSeedMeta(claimed);
    try {
      const result = await new SeedImporter(storage, spec.source, spec.id, now).applyAll({
        forceAll: deps.force === true,
        // First paint: as soon as the canvas chunk (home page + canvas
        // routes) is committed, refresh content consumers — the home page
        // renders while the rest of the library is still importing. Sources
        // without a canvas chunk never trigger it.
        onFirstPaintApplied: invalidateSeedContent,
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
      }
    } finally {
      const after = await storage.getSeedMeta(metaKey);
      if (after?.claim?.owner === owner) {
        await storage.putSeedMeta({ ...after, claim: null });
      }
    }
    finish('imported');
    return 'imported';
  } catch (err) {
    console.warn(`[seedSync] ${spec.id} seed sync failed`, err);
    finish('error', err instanceof Error ? err.message : String(err));
    return 'error';
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
  return runSeedSync({ ...deps, sources: [spec] });
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
  const sources = await Promise.all(
    (deps.sources ?? defaultSeedSources()).map(async (spec) => {
      const metaKey = seedMetaKey(spec.id);
      const stored = await storage.getSeedMeta(metaKey);
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
