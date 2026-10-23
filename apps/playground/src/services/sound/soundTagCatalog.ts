/**
 * soundTagCatalog — turns stored tags into the catalog a script can
 * reference.
 *
 * A script line points at a tag with `#{tag-slug}`. The parser resolves
 * that reference through the catalog, and the tag contributes the metrics
 * it is marked down with.
 *
 * Sound profile tags are the important case: a tag named `sound-classic`
 * contributes the sound metric that selects the `classic` profile. The
 * mapping is derived from the tag's own metrics when it has them, and
 * inferred from the `sound-` prefix when it does not — so a tag created
 * outside the profile UI still selects the profile it is named after.
 */

import { createTagIndex, type TagDefinition, type TagIndex } from '@bitcobblers/wod-wiki-engine'
import type { Tag } from '@bitcobblers/wod-wiki-core'
import {
    soundProfileIdFromTag,
    soundProfileTagMetrics,
} from './soundProfiles'

/**
 * The tag definitions a script can reference.
 */
export function buildTagDefinitions(tags: readonly Tag[]): TagDefinition[] {
    const definitions: TagDefinition[] = []
    for (const tag of tags) {
        const slug = tag.label.trim()
        if (slug.length === 0) continue

        const metrics = tag.metrics?.length
            ? tag.metrics.map(metric => ({ type: metric.type, value: metric.value }))
            : inferredMetrics(slug)

        if (metrics.length === 0) continue
        definitions.push({ slug, metrics })
    }
    return definitions
}

/**
 * The metrics a tag contributes when it does not carry any of its own.
 *
 * Only sound profile tags are inferred — every other tag type needs its
 * metrics marked down explicitly.
 */
function inferredMetrics(slug: string): Array<{ type: string; value: string }> {
    const profileId = soundProfileIdFromTag(slug)
    if (profileId) return soundProfileTagMetrics(profileId)
    return []
}

/**
 * The tag index a parser resolves `#{tag-slug}` references against.
 */
export function buildSoundTagIndex(tags: readonly Tag[]): TagIndex {
    return createTagIndex(buildTagDefinitions(tags))
}

/**
 * The profile id a set of note tags selects, or `undefined` when none do.
 *
 * The note-level selection: a note tagged `sound-classic` runs the
 * `classic` profile. The first matching tag wins, so a note with two
 * sound tags picks one deterministically.
 */
export function noteProfileIdFromTags(tags: readonly string[]): string | undefined {
    for (const tag of tags) {
        const profileId = soundProfileIdFromTag(tag.trim())
        if (profileId) return profileId
    }
    return undefined
}

// ── Cached index ───────────────────────────────────────────────────────────

/**
 * The tag index the parser resolves `#{tag-slug}` against.
 *
 * Parsing is synchronous but tags live in async storage, so the index is
 * cached here and refreshed when the tags are loaded. A parse that happens
 * before the tags load simply sees no tags — the same as a document with
 * no tag references.
 */
let cachedTagIndex: TagIndex = createTagIndex([])

/** Replace the cached tag index. */
export function setSoundTagIndex(tags: readonly Tag[]): void {
    cachedTagIndex = buildSoundTagIndex(tags)
}

/** The cached tag index. */
export function getSoundTagIndex(): TagIndex {
    return cachedTagIndex
}
