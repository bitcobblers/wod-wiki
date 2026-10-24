/**
 * useTagIndex — the tag catalogue, as React state.
 *
 * The catalogue is a module-level cache (parsing is synchronous, tags live
 * in async storage), so components that parse or display tags subscribe to
 * it rather than loading it themselves.
 */

import { useSyncExternalStore } from 'react';
import type { TagIndex } from '@bitcobblers/wod-wiki-core';
import { getTagIndex, subscribeTagIndex } from '@/services/tags/tagCatalogue';

export function useTagIndex(): TagIndex {
    return useSyncExternalStore(subscribeTagIndex, getTagIndex, getTagIndex);
}
