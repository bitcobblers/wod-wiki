/**
 * IndexedDBContentProvider — the page-route content provider.
 *
 * Extends IndexedDBNotePersistence with draft-durability gates: SPA
 * unmounts register in-flight draft saves (pendingNoteSaves) and hard
 * reloads park them in localStorage, so every route read first waits for
 * those saves (and replays staged pagehide drafts) before touching
 * IndexedDB. Halting runs stage their partial session on unload, flushed
 * here too so /results/:sessionId resolves immediately after a reload.
 *
 * The useNoteDraft import is dynamic: StaticContentProvider extends this
 * class at module init, and the hook graph (BlockHistory → useBrowserServices
 * → StaticContentProvider) would close an extends-TDZ cycle if it were
 * static. By call time every module is initialized, so a lazy import is both
 * safe and cycle-free.
 */
import type { HistoryRecord } from '@/types/history';
import {
  IndexedDBNotePersistence,
  type SelectiveRecordQuery,
} from '@/services/persistence/IndexedDBNotePersistence';
import { waitForAllPendingNoteSaves } from '@/services/persistence/pendingNoteSaves';
import { flushPendingUnloadResults } from '@/services/resultRecorder';

export class IndexedDBContentProvider extends IndexedDBNotePersistence {
  override async getRecord(id: string): Promise<HistoryRecord | null> {
    await Promise.all([waitForAllPendingNoteSaves(), flushPendingUnloadResults()]);
    return super.getRecord(id);
  }

  override async getRecords(query?: SelectiveRecordQuery): Promise<HistoryRecord[]> {
    await Promise.all([waitForAllPendingNoteSaves(), flushPendingUnloadResults()]);
    return super.getRecords(query);
  }
}
