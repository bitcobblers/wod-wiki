import { describe, it, expect } from 'vitest';
import {
    parseSoundTrigger,
    formatSoundTrigger,
    resolveProfileRules,
    DEFAULT_SOUND_PROFILE,
} from '../../../src/runtime/sound/SoundProfile';
import type { SoundProfile } from '../../../src/runtime/sound/SoundProfile';

describe('parseSoundTrigger', () => {
    it('reads the start anchor', () => {
        expect(parseSoundTrigger(':00')).toEqual({ anchor: 'start', offsetMs: 0 });
    });

    it('reads the end anchor', () => {
        expect(parseSoundTrigger('-:00')).toEqual({ anchor: 'end', offsetMs: 0 });
    });

    it('reads a countdown offset from the end', () => {
        expect(parseSoundTrigger('-:03')).toEqual({ anchor: 'end', offsetMs: 3000 });
    });

    it('reads elapsed minutes from the start', () => {
        expect(parseSoundTrigger(':05:00')).toEqual({ anchor: 'start', offsetMs: 300000 });
    });

    it('accepts every duration spelling for the same magnitude', () => {
        const expected = { anchor: 'start', offsetMs: 300000 };
        expect(parseSoundTrigger(':05:00')).toEqual(expected);
        expect(parseSoundTrigger(':00:05:00')).toEqual(expected);
        expect(parseSoundTrigger(':5:00')).toEqual(expected);
        expect(parseSoundTrigger(':300')).toEqual({ anchor: 'start', offsetMs: 300000 });
    });

    it('treats the start anchor as the default', () => {
        const expected = { anchor: 'start', offsetMs: 300000 };
        expect(parseSoundTrigger('05:00')).toEqual(expected);
        expect(parseSoundTrigger('00:05:00')).toEqual(expected);
        expect(parseSoundTrigger('5:00')).toEqual(expected);
    });

    it('accepts the end anchor with or without the colon', () => {
        expect(parseSoundTrigger('-:03')).toEqual({ anchor: 'end', offsetMs: 3000 });
        expect(parseSoundTrigger('-03')).toEqual({ anchor: 'end', offsetMs: 3000 });
    });

    it('accepts bare seconds', () => {
        expect(parseSoundTrigger(':3')).toEqual({ anchor: 'start', offsetMs: 3000 });
    });

    it('accepts hours', () => {
        expect(parseSoundTrigger(':01:00:00')).toEqual({ anchor: 'start', offsetMs: 3600000 });
    });

    it('rejects malformed magnitudes', () => {
        expect(parseSoundTrigger(':abc')).toBeUndefined();
        expect(parseSoundTrigger(':-3')).toBeUndefined();
        expect(parseSoundTrigger(':1:2:3:4:5')).toBeUndefined();
    });

    it('rejects an empty notation', () => {
        expect(parseSoundTrigger('')).toBeUndefined();
        expect(parseSoundTrigger('   ')).toBeUndefined();
    });
});

describe('formatSoundTrigger', () => {
    it('round-trips every notation it produces', () => {
        for (const notation of [':00', '-:00', '-:03', ':05:00', ':01:00:00']) {
            const trigger = parseSoundTrigger(notation);
            expect(trigger).toBeDefined();
            expect(formatSoundTrigger(trigger!)).toBe(notation);
        }
    });
});

describe('resolveProfileRules', () => {
    const profile: SoundProfile = {
        id: 'p',
        name: 'P',
        rules: [
            { trigger: { anchor: 'end', offsetMs: 3000 }, sound: 'beep' },
            { trigger: { anchor: 'end', offsetMs: 0 }, sound: 'complete' },
            { trigger: { anchor: 'start', offsetMs: 300000 }, sound: 'halfway' },
        ],
    };

    it('keeps rules whose trigger is reachable', () => {
        const resolved = resolveProfileRules(profile, 300000);
        expect(resolved.map(r => r.sound)).toEqual(['beep', 'complete', 'halfway']);
    });

    it('drops end-anchored rules whose offset exceeds the block duration', () => {
        const resolved = resolveProfileRules(profile, 10000);
        expect(resolved.map(r => r.sound)).toEqual(['beep', 'complete', 'halfway']);
    });

    it('drops end-anchored offset rules when the duration is unknown', () => {
        expect(resolveProfileRules(profile, undefined).map(r => r.sound)).toEqual(['complete', 'halfway']);
    });

    it('keeps start-anchored and end-at-zero rules when the duration is unknown', () => {
        const mixed: SoundProfile = {
            id: 'm',
            name: 'M',
            rules: [
                { trigger: { anchor: 'start', offsetMs: 0 }, sound: 'start' },
                { trigger: { anchor: 'start', offsetMs: 300000 }, sound: 'halfway' },
                { trigger: { anchor: 'end', offsetMs: 0 }, sound: 'complete' },
                { trigger: { anchor: 'end', offsetMs: 3000 }, sound: 'beep' },
            ],
        };
        expect(resolveProfileRules(mixed, undefined).map(r => r.sound)).toEqual([
            'start', 'halfway', 'complete',
        ]);
    });
});

describe('DEFAULT_SOUND_PROFILE', () => {
    it('counts three-two-one into a completion cue', () => {
        expect(DEFAULT_SOUND_PROFILE.rules.map(r => r.trigger.offsetMs)).toEqual([3000, 2000, 1000, 0]);
        expect(DEFAULT_SOUND_PROFILE.rules.every(r => r.trigger.anchor === 'end')).toBe(true);
    });
});
