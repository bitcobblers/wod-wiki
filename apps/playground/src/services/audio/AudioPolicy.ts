/**
 * AudioPolicy — the single table of sounds the app can play.
 *
 * A sound is named, and a name maps to the notes that synthesize it. Every
 * sound in the product lives here: UI feedback sounds and workout cue
 * sounds alike. One table means a cue name from a sound profile resolves
 * in exactly one place.
 *
 * An unknown name is an error the caller must see — not a silent fallback
 * to some other sound. `AudioService` reports it; it does not paper over it.
 */

export interface NoteDef {
  freq: number;
  type: OscillatorType;
  duration: number; // seconds
  offset?: number; // delay from start in seconds (default 0)
}

export interface SoundDef {
  notes: NoteDef[];
}

const SOUNDS: Record<string, SoundDef> = {
  // ── UI feedback ──────────────────────────────────────────────────────────
  beep: {
    notes: [{ freq: 880, type: 'sine', duration: 0.1 }],
  },
  tick: {
    notes: [{ freq: 880, type: 'sine', duration: 0.1 }],
  },
  click: {
    notes: [{ freq: 1400, type: 'sine', duration: 0.1 }],
  },
  buzzer: {
    notes: [{ freq: 150, type: 'sawtooth', duration: 0.5 }],
  },
  chime: {
    notes: [
      { freq: 523.25, type: 'sine', duration: 0.5, offset: 0 },
      { freq: 659.25, type: 'sine', duration: 0.5, offset: 0.1 },
      { freq: 783.99, type: 'sine', duration: 0.5, offset: 0.2 },
    ],
  },
  complete: {
    notes: [
      { freq: 523.25, type: 'sine', duration: 0.5, offset: 0 },
      { freq: 659.25, type: 'sine', duration: 0.5, offset: 0.1 },
      { freq: 783.99, type: 'sine', duration: 0.5, offset: 0.2 },
    ],
  },
  select: {
    notes: [
      { freq: 880, type: 'sine', duration: 0.08, offset: 0 },
      { freq: 1200, type: 'sine', duration: 0.12, offset: 0.08 },
    ],
  },
  start: {
    notes: [
      { freq: 440, type: 'square', duration: 0.1, offset: 0 },
      { freq: 880, type: 'square', duration: 0.3, offset: 0.15 },
    ],
  },

  // ── Workout cues ────────────────────────────────────────────────────────
  /** One tick of a countdown into the end of a block. */
  'countdown-beep': {
    notes: [{ freq: 880, type: 'sine', duration: 0.1 }],
  },
  /** A block finished. */
  'timer-complete': {
    notes: [
      { freq: 523.25, type: 'sine', duration: 0.4, offset: 0 },
      { freq: 659.25, type: 'sine', duration: 0.4, offset: 0.1 },
      { freq: 783.99, type: 'sine', duration: 0.6, offset: 0.2 },
    ],
  },
  /** A block started. */
  'start-beep': {
    notes: [
      { freq: 440, type: 'square', duration: 0.1, offset: 0 },
      { freq: 880, type: 'square', duration: 0.3, offset: 0.15 },
    ],
  },
  /** An interval (EMOM) round started. */
  'interval-start': {
    notes: [
      { freq: 440, type: 'square', duration: 0.1, offset: 0 },
      { freq: 880, type: 'square', duration: 0.3, offset: 0.15 },
    ],
  },
  /** An interval (EMOM) round finished. */
  'interval-complete': {
    notes: [
      { freq: 523.25, type: 'sine', duration: 0.4, offset: 0 },
      { freq: 659.25, type: 'sine', duration: 0.4, offset: 0.1 },
      { freq: 783.99, type: 'sine', duration: 0.6, offset: 0.2 },
    ],
  },
  /** A rest period finished. */
  'rest-over': {
    notes: [
      { freq: 783.99, type: 'sine', duration: 0.3, offset: 0 },
      { freq: 1046.5, type: 'sine', duration: 0.5, offset: 0.15 },
    ],
  },
};

export function getSoundDef(name: string): SoundDef | undefined {
  return SOUNDS[name];
}

export function hasSound(name: string): boolean {
  return name in SOUNDS;
}

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));
