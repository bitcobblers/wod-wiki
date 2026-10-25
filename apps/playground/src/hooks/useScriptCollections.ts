/**
 * useScriptCollections — React hook for accessing WOD collections
 * derived from the seeded corpus (markdown/collections/), via the
 * seed-content seam. Returns an empty list until the corpus lands; the
 * list refreshes automatically when a new feed is imported.
 */
import { useMemo, useCallback } from 'react';
import { useQueryState } from 'nuqs';
import { buildScriptCollections } from '@/repositories/script-collections';
import type { ScriptCollection, ScriptCollectionItem } from '@/repositories/script-collections';
import { useSeedContent } from '@/services/content/seedContent';

export type { ScriptCollection, ScriptCollectionItem };

export interface UseScriptCollectionsReturn {
    /** All available collections */
    collections: ScriptCollection[];
    /** Currently selected collection ID (null = none) */
    activeCollectionId: string | null;
    /** Currently selected collection object */
    activeCollection: ScriptCollection | null;
    /** Items in the active collection */
    activeCollectionItems: ScriptCollectionItem[];
    /** Select a collection */
    setActiveCollection: (id: string | null) => void;
}

export function useScriptCollections(): UseScriptCollectionsReturn {
    const files = useSeedContent();
    const collections = useMemo(
        () => (files ? buildScriptCollections(files) : []),
        [files],
    );
    const [activeCollectionId, setActiveCollectionId] = useQueryState('col', {
        defaultValue: '',
        clearOnDefault: true,
    });

    const activeCollection = useMemo(() => {
        if (!activeCollectionId) return null;
        return collections.find(c => c.id === activeCollectionId) ?? null;
    }, [collections, activeCollectionId]);

    const activeCollectionItems = useMemo(() => {
        return activeCollection?.items ?? [];
    }, [activeCollection]);

    const setActiveCollection = useCallback((id: string | null) => {
        setActiveCollectionId(id ?? '');
    }, [setActiveCollectionId]);

    return {
        collections,
        activeCollectionId,
        activeCollection,
        activeCollectionItems,
        setActiveCollection,
    };
}
