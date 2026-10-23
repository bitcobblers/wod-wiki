import { MetricType } from '@bitcobblers/wod-wiki-core';
import type { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { DEFAULT_SOUND_PROFILE } from '../sound/SoundProfile';
import type { SoundProfile } from '../sound/SoundProfile';

/**
 * The metric type a block uses to name its own sound profile.
 *
 * A block-level selection is written as a `sound` metric — `sound: classic`
 * in script content, or contributed by a `#sound-classic` tag reference.
 */
export const SOUND_PROFILE_METRIC = MetricType.Sound;

/**
 * Resolve the sound profile for a block.
 *
 * Three levels, most specific wins:
 *
 * 1. **Block** — a `sound` metric on the block's own statements. This is the
 *    line-level selection; it overrides everything below.
 * 2. **Note** — the profile selected by a note-level `sound-{profile}` tag,
 *    resolved by the host and passed in as `noteProfileId`.
 * 3. **Default** — {@link DEFAULT_SOUND_PROFILE}, when nothing is selected.
 *
 * @param statements the block's statements, searched for a `sound` metric
 * @param options the runtime's sound options
 */
export function resolveSoundProfile(
    statements: readonly ICodeStatement[],
    options?: { profiles?: readonly SoundProfile[]; noteProfileId?: string },
): SoundProfile {
    const blockProfileId = findBlockProfileId(statements);
    if (blockProfileId) {
        const match = findProfile(options?.profiles, blockProfileId);
        if (match) return match;
    }

    if (options?.noteProfileId) {
        const match = findProfile(options?.profiles, options.noteProfileId);
        if (match) return match;
    }

    return DEFAULT_SOUND_PROFILE;
}

/**
 * The profile id named by a `sound` metric on the block's statements, if any.
 */
function findBlockProfileId(statements: readonly ICodeStatement[]): string | undefined {
    for (const statement of statements) {
        const metric = statement.metrics.find(m => m.type === SOUND_PROFILE_METRIC);
        if (!metric) continue;
        const value = metric.value;
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
}

/**
 * Look a profile up by id.
 */
function findProfile(profiles: readonly SoundProfile[] | undefined, id: string): SoundProfile | undefined {
    if (!profiles) return undefined;
    return profiles.find(profile => profile.id === id);
}
