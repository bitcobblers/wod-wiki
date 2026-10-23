/**
 * Tags — named, reusable things a script can reference.
 *
 * A line can point at a tag rather than repeating what the tag means:
 * `sound: #{sound-classic}`. The tag contributes the metrics it is marked
 * down with, so the meaning lives in one place.
 */

export {
    createTagIndex,
    resolveTagMetrics,
    SOUND_PROFILE_TAG_TYPE,
} from './TagCatalog';
export type {
    TagDefinition,
    TagIndex,
} from './TagCatalog';
