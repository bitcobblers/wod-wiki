import { describe, it, expect } from 'bun:test';
import {
    readSoundProfiles,
    writeSoundProfiles,
    toSoundProfile,
    soundProfileTagLabel,
    soundProfileIdFromTag,
    soundProfileTagMetrics,
} from '@/services/sound/soundProfiles';
import { buildTagDefinitions, noteProfileIdFromTags } from '@/services/sound/soundTagCatalog';
import { LocalStore, InMemoryBackend } from '@/services/storage/LocalStore';
import { MetricType } from '@bitcobblers/wod-wiki-core';

function store(): LocalStore {
    return new LocalStore('wodwiki.test.soundProfiles.v1', new InMemoryBackend());
}

describe('sound profile tags', () => {
    it('names the tag that selects a profile', () => {
        expect(soundProfileTagLabel('classic')).toBe('sound-classic');
    });

    it('reads the profile id back from the tag', () => {
        expect(soundProfileIdFromTag('sound-classic')).toBe('classic');
    });

    it('ignores tags that do not select a profile', () => {
        expect(soundProfileIdFromTag('strength')).toBeUndefined();
        expect(soundProfileIdFromTag('sound-')).toBeUndefined();
    });

    it('contributes the sound metric that names the profile', () => {
        expect(soundProfileTagMetrics('classic')).toEqual([{ type: 'sound', value: 'classic' }]);
    });

    it('finds the note-level profile from a note\'s tags', () => {
        expect(noteProfileIdFromTags(['strength', 'sound-classic'])).toBe('classic');
    });

    it('has no note-level profile when no tag selects one', () => {
        expect(noteProfileIdFromTags(['strength', 'conditioning'])).toBeUndefined();
    });
});

describe('tag catalog', () => {
    it('infers a sound metric for a sound profile tag', () => {
        const definitions = buildTagDefinitions([
            { id: 't1', label: 'sound-classic', createdAt: 0 },
        ]);
        expect(definitions).toEqual([
            { slug: 'sound-classic', metrics: [{ type: 'sound', value: 'classic' }] },
        ]);
    });

    it('uses the metrics a tag is marked down with when it has them', () => {
        const definitions = buildTagDefinitions([
            { id: 't1', label: 'sound-classic', createdAt: 0, metrics: [{ type: 'sound', value: 'explicit' }] },
        ]);
        expect(definitions[0].metrics).toEqual([{ type: 'sound', value: 'explicit' }]);
    });

    it('skips tags with no metrics and no inference', () => {
        const definitions = buildTagDefinitions([
            { id: 't1', label: 'strength', createdAt: 0 },
        ]);
        expect(definitions).toEqual([]);
    });
});

describe('sound profile store', () => {
    it('round-trips profiles', async () => {
        const s = store();
        const written = await writeSoundProfiles([
            { id: 'classic', name: 'Classic', rules: [{ trigger: '-:03', sound: 'countdown-beep' }] },
        ], s);
        expect(written).toBe(true);
        expect(readSoundProfiles(s)).toEqual([
            { id: 'classic', name: 'Classic', rules: [{ trigger: '-:03', sound: 'countdown-beep' }] },
        ]);
    });

    it('reads nothing when nothing is stored', () => {
        expect(readSoundProfiles(store())).toEqual([]);
    });

    it('drops malformed stored entries', () => {
        const s = store();
        s.set('profiles', [
            { id: 'ok', name: 'Ok', rules: [] },
            { name: 'no id', rules: [] },
            'not an object',
        ]);
        expect(readSoundProfiles(s).map(p => p.id)).toEqual(['ok']);
    });

    it('falls back to the id when a profile has no name', () => {
        const s = store();
        s.set('profiles', [{ id: 'classic', rules: [] }]);
        expect(readSoundProfiles(s)[0].name).toBe('classic');
    });
});

describe('toSoundProfile', () => {
    it('parses the trigger notation into a rule', () => {
        const profile = toSoundProfile({
            id: 'classic',
            name: 'Classic',
            rules: [{ trigger: '-:03', sound: 'countdown-beep' }],
        });
        expect(profile.rules).toEqual([
            { trigger: { anchor: 'end', offsetMs: 3000 }, sound: 'countdown-beep' },
        ]);
    });

    it('drops a rule whose trigger notation is malformed', () => {
        const profile = toSoundProfile({
            id: 'classic',
            name: 'Classic',
            rules: [
                { trigger: 'nonsense', sound: 'beep' },
                { trigger: ':00', sound: 'start-beep' },
            ],
        });
        expect(profile.rules.map(r => r.sound)).toEqual(['start-beep']);
    });
});
