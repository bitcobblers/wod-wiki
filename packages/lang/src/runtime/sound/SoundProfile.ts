/**
 * Sound profiles — user-defined rule sets that drive workout audio.
 *
 * A profile is a list of rules. Each rule names a **trigger point** (an offset
 * relative to the block's own duration) and the **sound** to play there. The
 * profile therefore decides both *when* a sound fires and *what* it is.
 *
 * ## Trigger notation
 *
 * A trigger is a duration offset written in the whiteboard duration notation,
 * with a leading anchor that says which end of the block it counts from:
 *
 * - `:00` — the **start** of the block (elapsed = 0).
 * - `-:00` — the **end** of the block (remaining = 0).
 * - `-:03` — three seconds before the end (remaining).
 * - `:05:00` — five minutes after the start (elapsed).
 *
 * The magnitude accepts every duration spelling the language already
 * understands — `05:00`, `5:00`, `00:05:00` and `5` all mean the same
 * duration. The anchor is what distinguishes the two families:
 *
 * | Anchor | Counts from | Fires when |
 * |--------|-------------|------------|
 * | `:`    | block start | elapsed reaches the offset |
 * | `-:`   | block end   | remaining falls to the offset |
 *
 * Because the offset is relative to the block's own duration, one profile
 * works for any block length: the same `-:03` rule beeps three seconds
 * before the end of a 5:00 run and three seconds before the end of a 1:00
 * rest.
 */

/** Which end of the block a trigger counts from. */
export type SoundTriggerAnchor = 'start' | 'end';

/** A trigger point: an anchor plus an offset from that anchor. */
export interface SoundTrigger {
    /** Counts from the block's start (`start`) or its end (`end`). */
    readonly anchor: SoundTriggerAnchor;
    /** Offset from the anchor, in milliseconds. Never negative. */
    readonly offsetMs: number;
}

/** One rule in a profile: a trigger point plus the sound to play there. */
export interface SoundRule {
    /** When the sound fires. */
    readonly trigger: SoundTrigger;
    /** Name of the sound to play. Resolved against the app's sound table. */
    readonly sound: string;
}

/** A named, user-defined set of sound rules. */
export interface SoundProfile {
    /** Stable identifier (slug). Unique across profiles. */
    readonly id: string;
    /** Human-readable name shown in Settings. */
    readonly name: string;
    /** The rules, in declaration order. */
    readonly rules: readonly SoundRule[];
}

/**
 * Parse a trigger notation into a {@link SoundTrigger}.
 *
 * Accepts the anchor forms `:` (from start) and `-:` (from end), each
 * optionally followed by a duration written in any of the spellings the
 * language understands: `05:00`, `5:00`, `00:05:00`, `5`.
 *
 * @returns the parsed trigger, or `undefined` when the notation is malformed.
 */
export function parseSoundTrigger(notation: string): SoundTrigger | undefined {
    const trimmed = notation.trim();
    if (trimmed.length === 0) return undefined;

    let anchor: SoundTriggerAnchor;
    let magnitude: string;

    if (trimmed.startsWith('-:')) {
        anchor = 'end';
        magnitude = trimmed.slice(2);
    } else if (trimmed.startsWith(':')) {
        anchor = 'start';
        magnitude = trimmed.slice(1);
    } else {
        return undefined;
    }

    const offsetMs = parseDurationMagnitude(magnitude);
    if (offsetMs === undefined) return undefined;

    return { anchor, offsetMs };
}

/**
 * Parse the duration magnitude of a trigger — the part after the anchor.
 *
 * Accepts `5` (seconds), `5:00` (minutes), `00:05:00` (hours), with or
 * without a leading colon. An empty magnitude is zero.
 */
function parseDurationMagnitude(magnitude: string): number | undefined {
    const cleaned = magnitude.trim().replace(/^:/, '');
    if (cleaned.length === 0) return 0;
    if (!/^\d+(:\d+)*$/.test(cleaned)) return undefined;

    // Rightmost segment is seconds, then minutes, hours, days — the same
    // ordering `DurationMetric` uses for `5:00` meaning five minutes.
    const segments = cleaned.split(':').map(Number).reverse();
    const [seconds = 0, minutes = 0, hours = 0, days = 0] = segments;
    if (segments.length > 4) return undefined;
    if (minutes > 59 || hours > 59) return undefined;

    return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000;
}

/**
 * Format a trigger back into its canonical notation.
 *
 * `:00` for the start, `-:00` for the end, `-:03` for three seconds before
 * the end, `:05:00` for five minutes after the start.
 */
export function formatSoundTrigger(trigger: SoundTrigger): string {
    const totalSeconds = Math.round(trigger.offsetMs / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);

    let magnitude: string;
    if (hours > 0) {
        magnitude = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    } else if (minutes > 0) {
        magnitude = `${pad(minutes)}:${pad(seconds)}`;
    } else {
        magnitude = pad(seconds);
    }

    return `${trigger.anchor === 'end' ? '-:' : ':'}${magnitude}`;
}

function pad(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

/**
 * Resolve a profile's rules against a block's duration, dropping any rule
 * whose trigger point can never be reached.
 *
 * - A rule anchored to the **start** measures elapsed time, so it always
 *   applies — no duration needed.
 * - A rule anchored to the **end** with no offset means "when the block
 *   ends", so it always applies too.
 * - A rule anchored to the **end** with an offset needs a duration to count
 *   down from. It applies only when the block's duration is known and long
 *   enough to reach it.
 *
 * A rule that cannot be reached is dropped silently — an unreachable trigger
 * is not an authoring error, it is simply a rule that does not apply to this
 * block.
 *
 * @param profile the profile whose rules to resolve
 * @param durationMs the block's duration in milliseconds, when known
 */
export function resolveProfileRules(profile: SoundProfile, durationMs: number | undefined): SoundRule[] {
    return profile.rules.filter(rule => {
        const { anchor, offsetMs } = rule.trigger;
        if (anchor === 'start') return true;
        if (offsetMs === 0) return true;
        if (durationMs === undefined) return false;
        return offsetMs <= durationMs;
    });
}

/**
 * The profile applied when nothing selects one.
 *
 * A three-two-one countdown into a completion cue — the behaviour the app
 * has always implied but never actually played.
 */
export const DEFAULT_SOUND_PROFILE: SoundProfile = {
    id: 'default',
    name: 'Default',
    rules: [
        { trigger: { anchor: 'end', offsetMs: 3000 }, sound: 'countdown-beep' },
        { trigger: { anchor: 'end', offsetMs: 2000 }, sound: 'countdown-beep' },
        { trigger: { anchor: 'end', offsetMs: 1000 }, sound: 'countdown-beep' },
        { trigger: { anchor: 'end', offsetMs: 0 }, sound: 'timer-complete' },
    ],
};
