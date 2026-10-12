/**
 * useScriptBlockResults
 *
 * Fetches workout results associated with a specific WOD section.
 * Supports both IndexedDB (Production) and In-Memory (Storybook/Static) data sources.
 * Returns results sorted by completion date (most recent first).
 */

import { useState, useEffect } from 'react';
import type { Session } from '@/types/storage';
import { useWorkbenchSession } from '@/stores/workbenchSessionStore'

export interface UseScriptBlockResultsReturn {
  /** All results for this section, sorted most recent first */
  results: Session[];
  /** Whether the initial load is in progress */
  loading: boolean;
}

/**
 * Fetch workout results for a specific WOD section.
 *
 * @param noteId   - The note containing the WOD block (short or full UUID)
 * @param sectionId - The WOD section ID within the note
 * @param extendedResultsOverride - Optional explicit in-memory results (bypasses context)
 * @param contentId - Cross-note fingerprint, never occurrence identity.
 */
export function useScriptBlockResults(
  noteId: string | undefined,
  sectionId: string | undefined,
  extendedResultsOverride?: Session[],
  contentId?: string,
): UseScriptBlockResultsReturn {
  const [results, setResults] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  // Read the in-memory `currentEntry` from the Workbench Session (Static
  // Mode populates this on mount; production backends hydrate via
  // `loadEntry` from the route's `noteId`).
  const currentEntry = useWorkbenchSession((s) => s.currentEntry);
  const getNote = useWorkbenchSession((s) => s.getNote);
  const extendedResults = extendedResultsOverride ?? currentEntry?.extendedResults;
  useEffect(() => {
    if (!noteId || !sectionId) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchResults() {
      // 1. Check for in-memory results (Static Mode or immediate UI update)
      // Use extendedResults array if available (Mutable Static mode)
      if (Array.isArray(extendedResults)) {
        const inMemoryMatches = extendedResults.filter(result => result.noteId === noteId && result.blockId === sectionId);

        if (inMemoryMatches.length > 0) {
          if (!cancelled) {
            setResults(inMemoryMatches.sort((a, b) => b.createdAt - a.createdAt));
            setLoading(false);
            return;
          }
        }
      }

      // 2. Fallback through the note persistence seam (History Mode).
      // The session exposes `getNote` as a proxy to the injected port;
      // skip if no port is wired (e.g. outside a provider).
      if (typeof getNote !== 'function') {
        if (!cancelled) {
          setResults([]);
          setLoading(false);
        }
        return;
      }

      try {
        const entry = await getNote(noteId!, {
          projection: 'history-detail',
          resultSelection: {
            mode: 'all-for-section',
            blockId: sectionId!,
          },
        });
        if (!cancelled) {
          // Sort by createdAt descending (most recent first)
          setResults((entry?.extendedResults ?? []).sort((a, b) => b.createdAt - a.createdAt));
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchResults();

    return () => { cancelled = true; };
  }, [noteId, sectionId, extendedResults, getNote, contentId]);

  return { results, loading };
}
