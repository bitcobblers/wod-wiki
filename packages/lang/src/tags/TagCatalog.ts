import { IMetric, MetricType, MetricOrigin } from '@bitcobblers/wod-wiki-core';

/**
 * Tag catalog — the tags a script can reference, and the metrics each one
 * contributes.
 *
 * A script line can point at a tag rather than repeating what the tag
 * means:
 *
 * ```text
 * 5:00 Run
 *   sound: #{sound-classic}
 * ```
 *
 * The tag `sound-classic` contributes the metrics it is marked down with.
 * That keeps the meaning in one place — the tag — instead of repeating it
 * on every line that wants it.
 */

/** The tag type whose tags select a sound profile. */
export const SOUND_PROFILE_TAG_TYPE = 'sound';

/** One metric a tag contributes when referenced. */
export interface TagMetric {
    /** The metric type, e.g. `sound`. */
    readonly type: MetricType | string;
    /** The metric's value, e.g. the profile id. */
    readonly value: string | number | boolean | null;
}

/** A tag and the metrics it contributes. */
export interface TagDefinition {
    /** The tag's slug — what `#{slug}` refers to. */
    readonly slug: string;
    /** The metrics this tag adds when referenced. */
    readonly metrics: readonly TagMetric[];
}

/** A slug → tag lookup. */
export interface TagIndex {
    /**
     * The tag with this slug, or `undefined` when the catalog has no such
     * tag.
     */
    resolve(slug: string): TagDefinition | undefined;
}

/**
 * Build a tag index from tag definitions.
 *
 * Later definitions of the same slug win, matching how the app layers
 * user-defined tags over seeded ones.
 */
export function createTagIndex(tags: readonly TagDefinition[]): TagIndex {
    const bySlug = new Map<string, TagDefinition>();
    for (const tag of tags) {
        bySlug.set(tag.slug, tag);
    }
    return {
        resolve: (slug: string) => bySlug.get(slug),
    };
}

/**
 * The metrics a tag reference contributes, as ready-made metric objects.
 *
 * A reference to a tag the catalog does not know contributes nothing — the
 * line keeps whatever else it says, and the unknown reference is reported
 * through the property metric that carries it.
 */
export function resolveTagMetrics(
    tagIndex: TagIndex | undefined,
    slug: string,
    origin: MetricOrigin = 'parser',
): IMetric[] {
    const tag = tagIndex?.resolve(slug);
    if (!tag) return [];
    return tag.metrics.map(metric => ({
        type: metric.type,
        value: metric.value,
        origin,
        image: String(metric.value),
    }));
}
