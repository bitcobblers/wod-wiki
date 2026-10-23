import { describe, it, expect } from 'bun:test';
import { TestScript } from '@/testing/script/TestScript';
import { SOUND_PLAY_EVENT, type SoundProfile } from '@bitcobblers/wod-wiki-engine';

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

/** A profile that beeps once at the start of the block and nothing else. */
const startOnly: SoundProfile = {
    id: 'start-only',
    name: 'Start only',
    rules: [{ trigger: { anchor: 'start', offsetMs: 0 }, sound: 'start-beep' }],
};

describe('sound profile selection end to end', () => {
    it('uses the default profile when the note selects none', async () => {
        const script = await TestScript.compile('5:00 Run\n');
        const played = capturePlays(script);
        await script.next();
        await script.tick(297_000);
        await script.tick(1_000);
        await script.tick(1_000);

        expect(played).toEqual(['countdown-beep', 'countdown-beep', 'countdown-beep']);
    });

    it('uses the note-level profile when the note selects one', async () => {
        const script = await TestScript.compile('5:00 Run\n', {
            options: {
                soundOptions: {
                    profiles: [startOnly],
                    noteProfileId: 'start-only',
                },
            },
        });
        const played = capturePlays(script);
        await script.next();
        await script.tick(297_000);

        // The selected profile replaces the default countdown entirely.
        expect(played).toEqual(['start-beep']);
    });

    it('falls back to the default profile when the note names one that does not exist', async () => {
        const script = await TestScript.compile('5:00 Run\n', {
            options: {
                soundOptions: {
                    profiles: [startOnly],
                    noteProfileId: 'missing',
                },
            },
        });
        const played = capturePlays(script);
        await script.next();
        await script.tick(297_000);

        expect(played).toEqual(['countdown-beep']);
    });
});
