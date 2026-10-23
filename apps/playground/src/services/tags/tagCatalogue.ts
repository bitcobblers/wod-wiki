/**
 * tagCatalogue — the tags a script can reference, loaded from storage.
 *
 * The language never reads storage: the host loads its tags and hands the
 * language a tag index. This module is that host side. It loads the tags
 * from the tags store, turns them into definitions, and caches the index
 * for the parser (which resolves `#{slug}` references) and the runtime
 * (which runs the functions a tag carries).
 *
 * Tags live in one namespace. A user-defined tag layers over a seeded tag
 * of the same slug, which is how the catalogue has always resolved them.
 */

import { createTagIndex, type TagDefinition, type TagIndex } from '@bitcobblers/wod-wiki-engine'
import type { ITagSource, Tag, TagContribution } from '@bitcobblers/wod-wiki-core'
import { storageService } from '@/services/storage'
import { soundProfileIdFromTag } from '@/services/sound/soundProfiles'

/**
 * The contributions of a tag that carries none of its own.
 *
 * A sound profile tag names its profile in its slug, so a tag created
 * outside the profile UI still selects the profile it is named after.
 */
function inferredContributions(slug: string): TagContribution[] {
    const profileId = soundProfileIdFromTag(slug)
    if (!profileId) return []
    return [{ kind: 'metric', type: 'sound', value: profileId }]
}

/**
 * The tag definitions a set of stored tags makes.
 *
 * A tag's slug is its label — that is what `#{slug}` refers to.
 */
export function buildTagDefinitions(tags: readonly Tag[]): TagDefinition[] {
    const definitions: TagDefinition[] = []
    for (const tag of tags) {
        const slug = tag.label.trim()
        if (slug.length === 0) continue

        const contributions = tag.contributions?.length
            ? tag.contributions
            : inferredContributions(slug)

        definitions.push({ slug, contributions })
    }
    return definitions
}

/**
 * The app's tag source — the tags the tags store holds, as definitions the
 * language can resolve.
 */
class StorageTagSource implements ITagSource {
    async loadTags(): Promise<readonly TagDefinition[]> {
        const tags = await storageService.getAllTags();
        return buildTagDefinitions(tags);
    }
}

const tagSource: ITagSource = new StorageTagSource();

// ── Cached index ───────────────────────────────────────────────────────────

/**
 * The tag index the parser resolves `#{tag-slug}` references against.
 *
 * Parsing is synchronous but tags live in async storage, so the index is
 * cached here and refreshed when the tags are loaded. A parse that happens
 * before the tags load simply sees no tags — the same as a document with
 * no tag references.
 */
let cachedTagIndex: TagIndex = createTagIndex([])

type TagIndexListener = () => void
const listeners = new Set<TagIndexListener>()

/** Replace the cached tag index. */
export function setTagIndex(tags: readonly Tag[]): void {
    cachedTagIndex = createTagIndex(buildTagDefinitions(tags))
    for (const listener of listeners) listener()
}

/** The cached tag index. */
export function getTagIndex(): TagIndex {
    return cachedTagIndex
}

/**
 * Load the tags from storage and refresh the cached index.
 *
 * The load is shared: several callers asking at once get one read.
 */
let loadPromise: Promise<TagIndex> | null = null

export function loadTagIndex(): Promise<TagIndex> {
    if (!loadPromise) {
        loadPromise = tagSource
            .loadTags()
            .then(definitions => {
                cachedTagIndex = createTagIndex(definitions)
                for (const listener of listeners) listener()
                return cachedTagIndex
            })
            .finally(() => {
                loadPromise = null
            })
    }
    return loadPromise
}

/**
 * Refresh the cached index from storage, bypassing the shared load.
 */
export async function refreshTagIndex(): Promise<TagIndex> {
    const definitions = await tagSource.loadTags()
    cachedTagIndex = createTagIndex(definitions)
    for (const listener of listeners) listener()
    return cachedTagIndex
}

/** Subscribe to catalogue changes. Returns the unsubscribe function. */
export function subscribeTagIndex(listener: TagIndexListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
