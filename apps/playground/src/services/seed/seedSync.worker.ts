/**
 * seedSync.worker — off-main-thread seed sync. The boot load check and
 * manual syncs run here so manifest fetches, chunk JSON parsing, row
 * validation, and IndexedDB writes never block the UI.
 *
 * The worker owns ONLY the seedSyncCore path (no localStorage, no app
 * caches — the core module's hard boundary). It opens its own
 * IndexedDBStorage against the same database the tab uses; the driver on
 * the main thread owns every side effect (activity, content caches,
 * registries, catalog-update snapshot, check timestamps).
 */
import { IndexedDBStorage } from '@bitcobblers/wod-wiki-storage/idb';
import type { SeedImportProgress } from './SeedImporter';
import { HttpSeedSource } from './HttpSeedSource';
import type { SeedPrecedenceTier } from '@/types/seed';
import { IndexedDBSeedImportStorage } from './SeedImportStorage';
import { runSourceSyncCore, type SeedSyncOutcome, type SourceSyncCoreResult } from './seedSyncCore';

interface WorkerSourceSpec {
  id: string;
  label: string;
  url: string;
  /** Precedence tier stamped on the checkpoint (built-in corpus vs user library). */
  tier?: SeedPrecedenceTier;
  embeddedVersion: number;
  autoSyncOn: boolean;
}

interface RunMessage {
  type: 'run';
  dbName: string;
  userId: string | null;
  owner: string;
  force?: boolean;
  probeManifests?: boolean;
  background: boolean;
  sources: WorkerSourceSpec[];
}

export type SeedWorkerToMain =
  | { type: 'progress'; sourceId: string; progress: SeedImportProgress }
  | { type: 'first-paint'; sourceId: string }
  | { type: 'source-result'; sourceId: string; result: SourceSyncCoreResult }
  | { type: 'done'; outcomes: SeedSyncOutcome[] };

// DOM lib types `self` as Window; a module worker only needs these two.
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<RunMessage>) => void) | null;
  postMessage: (message: SeedWorkerToMain) => void;
};

ctx.onmessage = (event: MessageEvent<RunMessage>): void => {
  if (event.data.type !== 'run') return;
  const msg = event.data;
  void (async (): Promise<void> => {
    const storage = new IndexedDBSeedImportStorage(new IndexedDBStorage({
      dbName: msg.dbName,
      // Identity is snapshotted on the main thread at kickoff; rows written
      // here carry the same stamp a main-thread sync would write.
      ...(msg.userId ? { getUserId: (): string => msg.userId as string } : {}),
    }));
    const outcomes: SeedSyncOutcome[] = [];
    for (const spec of msg.sources) {
      const result = await runSourceSyncCore(
        {
          id: spec.id,
          label: spec.label,
          source: new HttpSeedSource(spec.url),
          embeddedVersion: spec.embeddedVersion,
          autoSyncOn: spec.autoSyncOn,
          ...(spec.tier ? { tier: spec.tier } : {}),
        },
        { storage, owner: msg.owner, now: Date.now, force: msg.force, probeManifests: msg.probeManifests, background: msg.background },
        {
          onProgress: (progress) => ctx.postMessage({ type: 'progress', sourceId: spec.id, progress }),
          onFirstPaint: () => ctx.postMessage({ type: 'first-paint', sourceId: spec.id }),
        },
      );
      ctx.postMessage({ type: 'source-result', sourceId: spec.id, result });
      outcomes.push(result.outcome);
    }
    ctx.postMessage({ type: 'done', outcomes });
  })();
};
