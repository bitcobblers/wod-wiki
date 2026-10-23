/**
 * soundTagNaming — the naming a sound profile tag follows.
 *
 * A leaf module on purpose: the tag catalogue infers a sound profile from a
 * tag's slug, and the sound service writes those tags — so both need this
 * naming, and neither should need the other.
 */

/** The prefix of a tag that selects a sound profile. */
export const SOUND_PROFILE_TAG_PREFIX = 'sound-';

/**
 * The profile id a tag selects, or `undefined` when the tag is not a sound
 * profile tag.
 */
export function soundProfileIdFromTag(label: string): string | undefined {
    if (!label.startsWith(SOUND_PROFILE_TAG_PREFIX)) return undefined;
    const id = label.slice(SOUND_PROFILE_TAG_PREFIX.length);
    return id.length > 0 ? id : undefined;
}
