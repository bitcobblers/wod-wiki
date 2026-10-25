/**
 * useLibraryCatalog — the notebook catalog behind the home gallery, resolved
 * for cast-driven navigation.
 *
 * `[]` until the feed corpus lands; only installed feeds with local rows are
 * offered — a couch cannot import a package. Sorted like the gallery default.
 */

import { useMemo } from 'react';
import { useSeedContent } from '@/services/content/seedContent';
import { listNotebooks, listFeedSources } from '@/services/feed/feedSources';
import {
    buildFeedCatalog,
    filterFeeds,
    sortFeeds,
} from '../../app/views/notebook-gallery/notebookGalleryModel';
import type { RpcLibraryEntry } from '@/services/cast/rpc/RpcMessages';

/**
 * Pure mapping from the home-gallery catalog to the cast library payload.
 * Exported for tests; the hook memoizes the live derivation.
 */
export function toLibraryEntries(files: Record<string, string> | null): RpcLibraryEntry[] {
    return sortFeeds(filterFeeds(buildFeedCatalog(listNotebooks(), files, listFeedSources()), {}), 'updated')
        .filter((feed) => feed.installed && feed.itemCount > 0)
        .map((feed) => ({
            notebookId: feed.slug,
            title: feed.label,
            href: feed.href,
            itemCount: feed.itemCount,
        }));
}

export function useLibraryCatalog(): RpcLibraryEntry[] {
    const files = useSeedContent();
    return useMemo(() => toLibraryEntries(files), [files]);
}
