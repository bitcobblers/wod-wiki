import { describe, it, expect } from 'bun:test';
import { TestScript } from '@/testing/script/TestScript';
import { SOUND_PLAY_EVENT } from '@bitcobblers/wod-wiki-engine';
import { DEFAULT_SOUND_PROFILE } from '@bitcobblers/wod-wiki-engine';

/**
 * Records every sound the runtime asks the app to play.
 */
function capturePlays(script: TestScript): string[] {
    const played: string[] = [];
    script.runtime.eventBus.register('*', {
        id: 'sound-listener',
        name: 'SoundListener',
        handler: (event) => {
            if (event.name === SOUND_PLAY_EVENT) {
                played.push((event.data as { sound: string }).sound);
            }
            return [];
        },
    }, 'listener', { scope: 'global' });
    return played;
}

describe('SoundProfileBehavior', () => {
    it('names the event the app listens on', () => {
        expect(SOUND_PLAY_EVENT).toBe('sound:play');
    });

    it('counts three-two-one into a completion cue by default', () => {
        expect(DEFAULT_SOUND_PROFILE.rules.map(r => r.sound)).toEqual([
            'countdown-beep',
            'countdown-beep',
            'countdown-beep',
            'timer-complete',
        ]);
    });

    it('plays the countdown cues as the block approaches its end', async () => {
        const script = await TestScript.compile('5:00 Run\n');
        const played = capturePlays(script);
        await script.next();
        await script.tick(297_000); // 3s remaining
        await script.tick(1_000);   // 2s remaining
        await script.tick(1_000);   // 1s remaining

        expect(played).toEqual(['countdown-beep', 'countdown-beep', 'countdown-beep']);
    });

    it('plays each rule exactly once', async () => {
        const script = await TestScript.compile('5:00 Run\n');
        const played = capturePlays(script);
        await script.next();
        await script.tick(297_000);
        await script.tick(1_000);
        await script.tick(1_000);
        await script.tick(1_000);
        await script.tick(1_000); // the block expires here

        // Three countdown cues and one completion cue — each rule fired once,
        // even though the clock passed through every second.
        expect(played).toEqual([
            'countdown-beep',
            'countdown-beep',
            'countdown-beep',
            'timer-complete',
        ]);
    });
});
