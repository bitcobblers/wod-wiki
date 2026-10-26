import { formatPlaygroundTimestampLabel } from '@/lib/playgroundDisplay';
import { getScriptContent } from '@/repositories/script-loader';
import { appWarn } from '@/lib/log';
import type { IContentProvider } from '@/types/content-provider';
import type { HistoryEntry } from '@/types/history';

/** Synthesizes the display entry for a corpus-backed workbench route with no
 *  stored note yet — an ordinary (read-only) note, not a stored row. */
export function createTemplateEntry(id: string, content: string): HistoryEntry {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : id;
  const now = Date.now();

  return {
    id,
    title,
    rawContent: content,
    type: 'note',
    tags: [],
    createdAt: now,
    updatedAt: now,
    targetDate: now,
    schemaVersion: 1,
  };
}

export async function loadWorkbenchDisplayEntry(
  routeId: string,
  provider: Pick<IContentProvider, 'mode' | 'getEntry'>,
): Promise<HistoryEntry | null> {
  if (provider.mode === 'history') {
    try {
      const entry = await provider.getEntry(routeId);
      if (entry) {
        return entry;
      }
    } catch (error) {
      appWarn('WorkbenchEntryLoader', 'Failed to load entry from provider', error);
    }
  }

  // Fallback: the seeded corpus template for this route (IndexedDB-backed).
  const fallbackContent = await getScriptContent(routeId);
  return fallbackContent ? createTemplateEntry(routeId, fallbackContent) : null;
}

export function getWorkbenchDocumentTitle(
  currentEntry: HistoryEntry | null,
  routeId?: string,
): string {
  if (currentEntry?.title) {
    return `Wod.Wiki - ${currentEntry.title}`;
  }

  if (currentEntry?.type === 'playground') {
    return `Wod.Wiki - ${formatPlaygroundTimestampLabel(currentEntry.createdAt)}`;
  }

  if (routeId) {
    return 'Wod.Wiki - Untitled note';
  }

  return 'Wod.Wiki';
}
