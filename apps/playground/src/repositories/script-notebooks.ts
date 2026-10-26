/**
 * WOD Notebooks — public adapter over the seeded corpus
 * (docs/prototypes/seed-data-unification.md § Module 3).
 *
 * A notebook is a Grouping from markdown/notebooks/: its README plus its
 * items, plain or dated (`<slug>/<date>/<file>.md`). Dated items sort by
 * date descending (most recent first), undated by name ascending; notebooks
 * sort by name ascending. Reads go through the seed-content seam
 * (IndexedDB-backed); results are memoized per corpus snapshot and refresh
 * when a new seed lands.
 */

import { ensureSeedContent, type SeedContentFiles } from '@/services/content/seedContent';
import { buildGroupings, type Grouping } from './groupings';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScriptNotebookItem {
  /** Filename without extension, e.g. "fran" or "monday-strength" */
  id: string;
  /** Display name derived from filename */
  name: string;
  /** Raw markdown content */
  content: string;
  /** Date key (dated notebooks only): YYYY-MM-DD (parent directory name) */
  date?: string;
  /** Canonical markdown path key */
  path: string;
}

export interface ScriptNotebook {
  /** Directory name, e.g. "crossfit-girls" or "crossfit-programming" */
  id: string;
  /** Display name, e.g. "Crossfit Girls" */
  name: string;
  /** The content of README.md if it exists */
  readme?: string;
  /** Category slugs parsed from the README front matter `category` field */
  categories: string[];
  /** Short package description (front matter `description:` or README first paragraph) */
  description?: string;
  /** Cover image URL (front matter `image:`), when the package provides one */
  image?: string;
  /** All items — dated notebooks sort by date descending, undated by name ascending */
  items: ScriptNotebookItem[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Pure derivation over a corpus snapshot — the hook-level entry point. */
export function buildScriptNotebooks(files: SeedContentFiles): ScriptNotebook[] {
  return buildGroupings('notebooks', files)
    .map((grouping: Grouping) => ({
      id: grouping.id,
      name: grouping.name,
      readme: grouping.readme,
      categories: grouping.categories,
      description: grouping.description,
      image: grouping.image,
      items: grouping.items
        .map(({ id, name, content, path, date }) => ({ id, name, content, path, ...(date ? { date } : {}) }))
        .sort((a, b) => {
          const aDate = a.date ?? '';
          const bDate = b.date ?? '';
          // Dated notebooks: newest first; undated: name ascending.
          if (aDate || bDate) return bDate.localeCompare(aDate);
          return a.name.localeCompare(b.name);
        }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

/** Get a single notebook by ID. */
export async function getScriptNotebook(id: string): Promise<ScriptNotebook | undefined> {
  return (await getScriptNotebooks()).find((n) => n.id === id);
}

/** Get a specific item within a notebook by date + item id. */
export async function getScriptNotebookItem(
  notebookId: string,
  itemDate: string,
  itemId: string,
): Promise<ScriptNotebookItem | undefined> {
  const notebook = await getScriptNotebook(notebookId);
  return notebook ? findNotebookItem(notebook, itemDate, itemId) : undefined;
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

/** Unique date keys present in a notebook, most recent first. */
export function getNotebookDateKeys(notebook: ScriptNotebook): string[] {
  return Array.from(new Set(notebook.items.map((i) => i.date).filter((d): d is string => !!d))).sort().reverse();
}
