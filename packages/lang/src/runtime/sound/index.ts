/**
 * Sound profiles — user-defined rule sets that drive workout audio.
 *
 * A profile maps trigger points (offsets relative to a block's own duration)
 * to the sounds played there. The profile decides both *when* a sound fires
 * and *what* it is; the app decides what a given sound name sounds like.
 */

export {
    parseSoundTrigger,
    formatSoundTrigger,
    resolveProfileRules,
    DEFAULT_SOUND_PROFILE,
} from './SoundProfile';
export type {
    SoundProfile,
    SoundRule,
    SoundTriggerPoint,
    SoundTriggerAnchor,
} from './SoundProfile';

export { resolveSoundProfile, SOUND_PROFILE_METRIC } from './resolveSoundProfile';
