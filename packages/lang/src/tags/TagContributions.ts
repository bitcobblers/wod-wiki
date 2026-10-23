/**
 * Tag contributions — what a `#{slug}` reference resolves to.
 *
 * A tag contributes metrics (a typed value with a unit), other tags, and
 * functions (named calculations). Resolving a reference flattens that
 * structure: nested tags are walked, functions are collected by name, and
 * metric contributions keep the order the tags declare them in.
 *
 * The resolver is defensive about cycles — a tag that applies itself, directly
 * or through other tags, contributes nothing further rather than looping.
 */

import type {
    IMetric,
    MetricOrigin,
    TagIndex,
    TagMetricContribution,
} from '@bitcobblers/wod-wiki-core';

/**
 * The metric type prefix that marks a statement as carrying a tag.
 *
 * A marker is how tag activation survives into the runtime: the statement's
 * metrics travel with the segment, so a marker on the statement is a marker
 * on the segment — and on the stored log.
 */
export const TAG_MARKER_PREFIX = 'tag.';

/** How deep nested tag references may go. */
export const MAX_TAG_CONTRIBUTION_DEPTH = 8;

/** What a tag reference resolves to. */
export interface ResolvedTagContributions {
    /** Metric contributions, in the order the tags declare them. */
    readonly metrics: readonly TagMetricContribution[];
    /** Names of the functions the tags carry, without duplicates. */
    readonly functions: readonly string[];
    /** Every tag involved — the referenced tag and the tags it applies. */
    readonly tags: readonly string[];
}

const EMPTY: ResolvedTagContributions = { metrics: [], functions: [], tags: [] };

/**
 * Resolve what a tag reference contributes.
 *
 * A reference to a tag the catalogue does not know contributes nothing — the
 * line keeps whatever else it says.
 */
export function resolveTagContributions(
    tagIndex: TagIndex | undefined,
    slug: string,
): ResolvedTagContributions {
    if (!tagIndex) return EMPTY;

    const metrics: TagMetricContribution[] = [];
    const functions: string[] = [];
    const tags: string[] = [];
    const seenFunctions = new Set<string>();
    const visited = new Set<string>();

    // A tag is walked once: a tag that applies itself stops here rather
    // than looping, and a tag two others apply contributes once.
    const walk = (currentSlug: string, depth: number): void => {
        if (depth > MAX_TAG_CONTRIBUTION_DEPTH) return;
        if (visited.has(currentSlug)) return;

        const definition = tagIndex.resolve(currentSlug);
        if (!definition) return;

        visited.add(currentSlug);
        tags.push(currentSlug);

        // A tag's own contributions come before the tags it applies: the more
        // specific tag wins when two of them carry the same metric type.
        for (const contribution of definition.contributions) {
            if (contribution.kind === 'metric') metrics.push(contribution);
            else if (contribution.kind === 'function') {
                if (!seenFunctions.has(contribution.name)) {
                    seenFunctions.add(contribution.name);
                    functions.push(contribution.name);
                }
            }
        }

        for (const contribution of definition.contributions) {
            if (contribution.kind === 'tag') walk(contribution.slug, depth + 1);
        }
    };

    walk(slug, 0);
    return { metrics, functions, tags };
}

/**
 * The cycles in a catalogue's tag graph.
 *
 * Each cycle is the slugs that form it, with the entry slug repeated at the
 * end. A catalogue with no cycles returns an empty list.
 */
export function findTagContributionCycles(tagIndex: TagIndex | undefined): string[][] {
    if (!tagIndex) return [];

    const cycles: string[][] = [];
    const seen = new Set<string>();

    const walk = (slug: string, path: string[], onPath: ReadonlySet<string>): void => {
        if (onPath.has(slug)) {
            const start = path.indexOf(slug);
            if (start >= 0) {
                const cycle = [...path.slice(start), slug];
                const key = cycleKey(cycle);
                if (!seen.has(key)) {
                    seen.add(key);
                    cycles.push(cycle);
                }
            }
            return;
        }

        const definition = tagIndex.resolve(slug);
        if (!definition) return;

        const nextPath = [...path, slug];
        const nextOnPath = new Set(onPath);
        nextOnPath.add(slug);

        for (const contribution of definition.contributions) {
            if (contribution.kind === 'tag') walk(contribution.slug, nextPath, nextOnPath);
        }
    };

    for (const definition of tagIndex.list()) {
        walk(definition.slug, [], new Set());
    }
    return cycles;
}

/** A rotation-independent key for a cycle, so the same loop is reported once. */
function cycleKey(cycle: string[]): string {
    const nodes = cycle.slice(0, -1);
    if (nodes.length === 0) return '';
    let smallest = 0;
    for (let index = 1; index < nodes.length; index++) {
        if (nodes[index] < nodes[smallest]) smallest = index;
    }
    return [...nodes.slice(smallest), ...nodes.slice(0, smallest)].join('>');
}

/**
 * The metric type that marks a statement as carrying a tag.
 */
export function tagMarkerType(slug: string): string {
    return `${TAG_MARKER_PREFIX}${slug}`;
}

/**
 * The tag slug a marker metric type refers to, or `undefined` when the type
 * is not a marker.
 */
export function tagMarkerSlug(type: string): string | undefined {
    if (!type.startsWith(TAG_MARKER_PREFIX)) return undefined;
    const slug = type.slice(TAG_MARKER_PREFIX.length);
    return slug.length > 0 ? slug : undefined;
}

/**
 * The tag slugs a set of metrics marks.
 */
export function tagMarkerSlugs(metrics: Iterable<IMetric>): string[] {
    const slugs: string[] = [];
    for (const metric of metrics) {
        const slug = tagMarkerSlug(metric.type);
        if (slug !== undefined && !slugs.includes(slug)) slugs.push(slug);
    }
    return slugs;
}

/**
 * The metric a tag's metric contributions produce.
 */
export function tagContributionMetrics(
    contributions: readonly TagMetricContribution[],
    origin: MetricOrigin = 'parser',
): IMetric[] {
    return contributions.map(contribution => ({
        type: contribution.type,
        value: contribution.value,
        origin,
        image: String(contribution.value),
        ...(contribution.unit ? { unit: contribution.unit } : {}),
    }));
}
