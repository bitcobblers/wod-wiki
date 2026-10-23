import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IBehaviorContext } from '../contracts/IBehaviorContext';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { readTimer } from '../time/TimerSpans';
import { calculateElapsed } from '../time/calculateElapsed';
import { SoundMetric } from '../compiler/metrics/SoundMetric';
import type { SoundTrigger } from '../compiler/metrics/SoundMetric';
import type { SoundProfile, SoundRule } from '../sound/SoundProfile';
import { resolveProfileRules } from '../sound/SoundProfile';

/**
 * The runtime event a sound cue is published on.
 *
 * Listeners (the app's audio layer) subscribe to this to play the sound.
 * The event carries the sound's **name** — the profile decides the name,
 * the app decides what it sounds like.
 */
export const SOUND_PLAY_EVENT = 'sound:play';

export interface SoundProfileBehaviorConfig {
    /** The profile whose rules drive this block's cues. */
    profile: SoundProfile;
}

/**
 * SoundProfileBehavior — plays a profile's rules at their trigger points.
 *
 * This is the generic replacement for the per-strategy hardcoded cues. Every
 * profile rule is expressed as an offset relative to the block's own duration,
 * so one profile applies to any block length:
 *
 * - `anchor: 'start'`, offset 0 → fires on mount.
 * - `anchor: 'end'`, offset 0 → fires on unmount.
 * - `anchor: 'end'`, offset N → fires when N ms remain (a countdown).
 * - `anchor: 'start'`, offset N → fires when N ms have elapsed.
 *
 * Each firing does two things: it records a {@link SoundMetric} output (so
 * history and analytics know a sound happened) and it emits a
 * {@link SOUND_PLAY_EVENT} event (so the app plays it). Recording and
 * playing are deliberately separate — the metric is a fact, the event is a
 * command.
 */
export class SoundProfileBehavior implements IRuntimeBehavior {
    private rules: SoundRule[] = [];
    /** Rule indices already fired, so each rule fires exactly once. */
    private readonly fired = new Set<number>();
    private durationMs: number | undefined;

    constructor(private config: SoundProfileBehaviorConfig) { }

    onMount(ctx: IBehaviorContext): IRuntimeAction[] {
        const timer = readTimer(ctx);
        this.durationMs = timer?.durationMs;
        this.rules = resolveProfileRules(this.config.profile, this.durationMs);

        // A rule anchored to the start with no offset fires the moment the
        // block opens.
        this.fireDue(ctx, 0, this.durationMs);

        // Bubble scope so a parent block's countdown keeps cueing while a
        // child block runs.
        ctx.subscribe('tick', (_event, tickCtx) => {
            const elapsed = this.elapsedMs(tickCtx);
            if (elapsed === undefined) return [];
            this.fireDue(tickCtx, elapsed, this.durationMs);
            return [];
        }, { scope: 'bubble' });

        return [];
    }

    onNext(_ctx: IBehaviorContext): IRuntimeAction[] {
        return [];
    }

    onUnmount(ctx: IBehaviorContext): IRuntimeAction[] {
        // A rule anchored to the end with no offset fires as the block ends.
        this.fireDue(ctx, this.elapsedMs(ctx) ?? 0, this.durationMs, true);
        return [];
    }

    onDispose(_ctx: IBehaviorContext): void {
        this.fired.clear();
    }

    /**
     * Elapsed milliseconds for the block's own timer, or `undefined` when the
     * block has no timer to measure against.
     */
    private elapsedMs(ctx: IBehaviorContext): number | undefined {
        const timer = readTimer(ctx);
        if (!timer) return undefined;
        return calculateElapsed(timer, ctx.clock.currentDate.getTime());
    }

    /**
     * Fire every rule whose trigger point has been reached.
     *
     * @param elapsed milliseconds elapsed on the block's timer
     * @param durationMs the block's total duration
     * @param ending whether the block is ending — a rule anchored to the end
     *   with no offset fires then, even when the block has no duration to
     *   count down from
     */
    private fireDue(
        ctx: IBehaviorContext,
        elapsed: number,
        durationMs: number | undefined,
        ending = false,
    ): void {
        const remaining = durationMs === undefined ? undefined : Math.max(0, durationMs - elapsed);

        this.rules.forEach((rule, index) => {
            if (this.fired.has(index)) return;
            const { anchor, offsetMs } = rule.trigger;

            const due = anchor === 'start'
                ? elapsed >= offsetMs
                : (offsetMs === 0
                    ? ending || (remaining !== undefined && remaining <= 0)
                    : (remaining !== undefined && remaining <= offsetMs));

            if (!due) return;
            this.fired.add(index);
            this.play(ctx, rule, anchor, offsetMs);
        });
    }

    /**
     * Record the cue and command its playback.
     */
    private play(ctx: IBehaviorContext, rule: SoundRule, anchor: string, offsetMs: number): void {
        const trigger: SoundTrigger = anchor === 'start'
            ? (offsetMs === 0 ? 'mount' : 'countdown')
            : (offsetMs === 0 ? 'complete' : 'countdown');

        ctx.emitOutput('system', [
            new SoundMetric(rule.sound, trigger, {
                atSecond: offsetMs / 1000,
            }),
        ], { label: `Sound: ${rule.sound}` });

        ctx.emitEvent({
            name: SOUND_PLAY_EVENT,
            timestamp: ctx.clock.currentDate,
            data: {
                sound: rule.sound,
                volume: 1.0,
            },
        });
    }
}
