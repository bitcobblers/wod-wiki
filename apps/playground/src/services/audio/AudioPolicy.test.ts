import { describe, expect, it } from 'bun:test';
import { getSoundDef, hasSound, SOUND_NAMES } from './AudioPolicy';

describe('AudioPolicy', () => {
  describe('getSoundDef', () => {
    it('returns beep with 1 sine note at 880 Hz', () => {
      const def = getSoundDef('beep');
      expect(def).toBeDefined();
      expect(def!.notes).toHaveLength(1);
      expect(def!.notes[0].freq).toBe(880);
      expect(def!.notes[0].type).toBe('sine');
      expect(def!.notes[0].duration).toBe(0.1);
    });

    it('returns click with freq 1400', () => {
      const def = getSoundDef('click');
      expect(def).toBeDefined();
      expect(def!.notes).toHaveLength(1);
      expect(def!.notes[0].freq).toBe(1400);
    });

    it('returns buzzer as sawtooth with duration 0.5', () => {
      const def = getSoundDef('buzzer');
      expect(def).toBeDefined();
      expect(def!.notes).toHaveLength(1);
      expect(def!.notes[0].type).toBe('sawtooth');
      expect(def!.notes[0].duration).toBe(0.5);
    });

    it('returns chime as 3 ascending notes (C5, E5, G5)', () => {
      const def = getSoundDef('chime');
      expect(def).toBeDefined();
      expect(def!.notes).toHaveLength(3);
      expect(def!.notes[0].freq).toBe(523.25);
      expect(def!.notes[1].freq).toBe(659.25);
      expect(def!.notes[2].freq).toBe(783.99);
      expect(def!.notes[0].offset).toBe(0);
      expect(def!.notes[1].offset).toBe(0.1);
      expect(def!.notes[2].offset).toBe(0.2);
    });

    it('returns complete identical to chime', () => {
      const chime = getSoundDef('chime');
      const complete = getSoundDef('complete');
      expect(complete).toBeDefined();
      expect(complete!.notes).toEqual(chime!.notes);
    });

    it('returns select as 2 ascending sine notes', () => {
      const def = getSoundDef('select');
      expect(def).toBeDefined();
      expect(def!.notes).toHaveLength(2);
      expect(def!.notes[0].freq).toBe(880);
      expect(def!.notes[0].duration).toBe(0.08);
      expect(def!.notes[1].freq).toBe(1200);
      expect(def!.notes[1].duration).toBe(0.12);
      expect(def!.notes[1].offset).toBe(0.08);
    });

    it('returns start as 2 square notes (A4 then A5)', () => {
      const def = getSoundDef('start');
      expect(def).toBeDefined();
      expect(def!.notes).toHaveLength(2);
      expect(def!.notes[0].freq).toBe(440);
      expect(def!.notes[0].type).toBe('square');
      expect(def!.notes[0].duration).toBe(0.1);
      expect(def!.notes[1].freq).toBe(880);
      expect(def!.notes[1].type).toBe('square');
      expect(def!.notes[1].duration).toBe(0.3);
      expect(def!.notes[1].offset).toBe(0.15);
    });

    it('returns undefined for nonexistent sound', () => {
      expect(getSoundDef('nonexistent')).toBeUndefined();
    });
  });

  describe('hasSound', () => {
    it('returns true for known sound', () => {
      expect(hasSound('beep')).toBe(true);
    });

    it('returns false for unknown sound', () => {
      expect(hasSound('garbage')).toBe(false);
    });
  });

  describe('SOUND_NAMES', () => {
    it('includes the UI feedback sounds', () => {
      const expected = ['beep', 'tick', 'click', 'buzzer', 'chime', 'complete', 'select', 'start'];
      for (const name of expected) {
        expect(SOUND_NAMES).toContain(name);
      }
    });

    it('includes the workout cue sounds', () => {
      const expected = [
        'countdown-beep',
        'timer-complete',
        'start-beep',
        'interval-start',
        'interval-complete',
        'rest-over',
      ];
      for (const name of expected) {
        expect(SOUND_NAMES).toContain(name);
        expect(getSoundDef(name)).toBeDefined();
      }
    });

    it('has no names beyond the known set', () => {
      const expected = [
        'beep', 'tick', 'click', 'buzzer', 'chime', 'complete', 'select', 'start',
        'countdown-beep', 'timer-complete', 'start-beep',
        'interval-start', 'interval-complete', 'rest-over',
      ];
      expect(SOUND_NAMES).toHaveLength(expected.length);
    });
  });
});
