/**
 * WOD Notebooks — public adapter over the seeded corpus
 * (docs/prototypes/seed-data-unification.md § Module 3).
 *
 * A notebook is a Grouping from markdown/notebooks/: its README plus its
 * items, plain or dated (`<slug>/<date>/<file>.md`). Items carry the
 * canonical notebook order built by `buildGroupings` (dated newest first,
 * then id ascending); notebooks sort by name ascending. Reads go through the seed-content seam
 * (IndexedDB-backed); results are memoized per corpus snapshot and refresh
 * when a new seed lands.
 */

import { ensureSeedContent, type SeedContentFiles } from '@/services/content/seedContent';
import { buildGroupings, type Grouping, type GroupingItem } from './groupings';

// ── Types ──────────────────────────────────────────────────────────────────

export type ScriptNotebookItem = GroupingItem;

export type ScriptNotebook = Grouping;

// ── Public API ─────────────────────────────────────────────────────────────

/** Pure derivation over a corpus snapshot — the hook-level entry point. */
export function buildScriptNotebooks(files: SeedContentFiles): ScriptNotebook[] {
  return buildGroupings('notebooks', files);
}

let cacheFor: SeedContentFiles | null = null;
let cached: ScriptNotebook[] = [];

/**
 * Get all notebooks from the seeded corpus. Memoized per corpus snapshot;
 * resolves after the seed content is loaded.
 */
export async function getScriptNotebooks(): Promise<ScriptNotebook[]> {
  const files = await ensureSeedContent();
  if (cacheFor !== files) {
    cacheFor = files;
    cached = buildScriptNotebooks(files);
  }
  return cached;
}

/** Sync item lookup over one notebook — the /notebook/:slug/:date/:item
 *  resolution contract (dated items match on `date`; undated items match an
 *  empty date). */
export function findNotebookItem(
  notebook: ScriptNotebook | undefined,
  itemDate: string,
  itemId: string,
): ScriptNotebookItem | undefined {
  return notebook?.items.find((i) => (i.date ?? '') === itemDate && i.id === itemId);
}
