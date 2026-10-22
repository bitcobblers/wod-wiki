/**
 * useLibraryCatalog — the notebook catalog behind the home gallery, resolved
 * for cast-driven navigation.
 *
 * `[]` until the seed corpus lands; only installed seeds with local rows are
 * offered — a couch cannot import a package. Sorted like the gallery default.
 */

import { useMemo } from 'react';
import { useSeedContent } from '@/services/content/seedContent';
import { listNotebooks, listSeedSources } from '@/services/seed/seedSources';
import {
    buildSeedCatalog,
    filterSeeds,
    sortSeeds,
} from '../../app/views/notebook-gallery/notebookGalleryModel';
import type { RpcLibraryEntry } from '@/services/cast/rpc/RpcMessages';

/**
 * Pure mapping from the home-gallery catalog to the cast library payload.
 * Exported for tests; the hook memoizes the live derivation.
 */
export function toLibraryEntries(files: Record<string, string> | null): RpcLibraryEntry[] {
    return sortSeeds(filterSeeds(buildSeedCatalog(listNotebooks(), files, listSeedSources()), {}), 'updated')
        .filter((seed) => seed.installed && seed.itemCount > 0)
        .map((seed) => ({
            notebookId: seed.slug,
            title: seed.label,
            href: seed.href,
            itemCount: seed.itemCount,
        }));
}

export function useLibraryCatalog(): RpcLibraryEntry[] {
    const files = useSeedContent();
    return useMemo(() => toLibraryEntries(files), [files]);
}
