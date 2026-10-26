/**
 * script-loader — view-source content over the seeded corpus
 * (docs/prototypes/seed-data-unification.md § Module 3).
 *
 * Resolves a script id (e.g. `crossfit-girls/fran` or `syntax/basics`) to
 * the raw markdown of the corresponding collections/canvas page. Reads go
 * through the seed-content seam (IndexedDB-backed); the old build-time glob
 * is gone.
 */
import { ensureSeedContent } from '@/services/content/seedContent';

/** Resolve a script id to its raw markdown, exact path first, then suffix match. */
export async function getScriptContent(id: string): Promise<string | undefined> {
  const files = await ensureSeedContent();
  // Try exact matches in both collections and canvas
  const paths = [
    `markdown/notebooks/${id}.md`,
    `markdown/canvas/${id}.md`,
  ];

  for (const path of paths) {
    if (files[path]) {
      return files[path];
    }
  }

  // Try case-insensitive match by searching for the suffix /id.md
  const suffix = `/${id}.md`.toLowerCase();
  const entry = Object.entries(files).find(([p]) => p.toLowerCase().endsWith(suffix));

  return entry ? entry[1] : undefined;
}
