/**
 * useScriptBlockResults
 *
 * Fetches workout results associated with a specific WOD section.
 * Supports both IndexedDB (Production) and In-Memory (Storybook/Static) data sources.
 * Returns results sorted by completion date (most recent first).
 */

import { useState, useEffect } from 'react';
import type { Session } from '@/types/storage';
import { notePersistence } from '@/hooks/useBrowserServices';

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
 * @param extendedResultsOverride - Optional explicit in-memory results (bypasses persistence)
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

  useEffect(() => {
    if (!noteId || !sectionId) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchResults() {
      // 1. Check for in-memory results (Static Mode or immediate UI update)
      if (Array.isArray(extendedResultsOverride)) {
        const inMemoryMatches = extendedResultsOverride.filter(
          (result) => result.noteId === noteId && result.blockId === sectionId,
        );

        if (inMemoryMatches.length > 0) {
          if (!cancelled) {
            setResults(inMemoryMatches.sort((a, b) => b.createdAt - a.createdAt));
            setLoading(false);
            return;
          }
        }
      }

      // 2. Fallback through the note persistence seam (History Mode).
      try {
        const entry = await notePersistence.getNote(noteId!, {
          projection: 'history-detail',
          resultSelection: {
            mode: 'all-for-section',
            blockId: sectionId!,
          },
        });
        if (!cancelled) {
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
  }, [noteId, sectionId, extendedResultsOverride, contentId]);

  return { results, loading };
}
