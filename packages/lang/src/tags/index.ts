/**
 * Tags — named, reusable things a script can reference.
 *
 * A line can point at a tag rather than repeating what the tag means:
 * `sound: #{sound-classic}`. The tag contributes the metrics it is marked
 * down with, so the meaning lives in one place.
 */

export {
    MAX_TAG_CONTRIBUTION_DEPTH,
    TAG_MARKER_PREFIX,
    findTagContributionCycles,
    resolveTagContributions,
    sortedTagDefinitions,
    tagContributionMetrics,
    tagMarkerSlug,
    tagMarkerSlugs,
    tagMarkerType,
} from './TagContributions';
export type { ResolvedTagContributions } from './TagContributions';
