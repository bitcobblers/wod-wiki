import { describe, it, expect } from 'vitest';
import { resolveSoundProfile } from '../../../src/runtime/sound/resolveSoundProfile';
import { DEFAULT_SOUND_PROFILE } from '../../../src/runtime/sound/SoundProfile';
import type { SoundProfile } from '../../../src/runtime/sound/SoundProfile';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import type { ICodeStatement } from '@bitcobblers/wod-wiki-core';

const classic: SoundProfile = {
    id: 'classic',
    name: 'Classic',
    rules: [{ trigger: { anchor: 'end', offsetMs: 0 }, sound: 'timer-complete' }],
};

const quiet: SoundProfile = {
    id: 'quiet',
    name: 'Quiet',
    rules: [],
};

const profiles = [classic, quiet];

function stmtWithSound(value: string): ICodeStatement {
    return {
        id: 1,
        metrics: [{ type: MetricType.Sound, value, origin: 'parser' }],
        hints: [],
        sourceId: 'test',
    } as unknown as ICodeStatement;
}

const noSound = { id: 1, metrics: [], hints: [], sourceId: 'test' } as unknown as ICodeStatement;

describe('resolveSoundProfile', () => {
    it('falls back to the default profile when nothing is selected', () => {
        expect(resolveSoundProfile([noSound], { profiles })).toBe(DEFAULT_SOUND_PROFILE);
    });

    it('uses the note-level profile when no block metric names one', () => {
        expect(resolveSoundProfile([noSound], { profiles, noteProfileId: 'quiet' })).toBe(quiet);
    });

    it('lets a block metric override the note-level profile', () => {
        const result = resolveSoundProfile([stmtWithSound('classic')], { profiles, noteProfileId: 'quiet' });
        expect(result).toBe(classic);
    });

    it('falls back to the note-level profile when the block names an unknown profile', () => {
        const result = resolveSoundProfile([stmtWithSound('nope')], { profiles, noteProfileId: 'quiet' });
        expect(result).toBe(quiet);
    });

    it('falls back to the default profile when the block names an unknown profile and no note profile exists', () => {
        expect(resolveSoundProfile([stmtWithSound('nope')], { profiles })).toBe(DEFAULT_SOUND_PROFILE);
    });

    it('ignores a block metric with an empty value', () => {
        expect(resolveSoundProfile([stmtWithSound('  ')], { profiles, noteProfileId: 'quiet' })).toBe(quiet);
    });

    it('falls back to the default profile when no profiles are configured', () => {
        expect(resolveSoundProfile([stmtWithSound('classic')], undefined)).toBe(DEFAULT_SOUND_PROFILE);
    });
});
