/**
 * AudioService — thin orchestrator for audio feedback.
 *
 * Policy (what sound for what cue) lives in AudioPolicy.
 * I/O (synthesis via Web Audio API) lives in WebAudioSink.
 * This class wires them together and manages enabled/disabled state.
 */

import { getSoundDef } from './audio/AudioPolicy';
import type { IAudioSink } from './audio/IAudioSink';
import { WebAudioSink } from './audio/WebAudioSink';

/**
 * Thrown when a sound name has no entry in the sound table.
 *
 * An unmapped name is a mistake in a sound profile or a cue, and it is
 * reported rather than papered over — a silent fallback would make every
 * cue sound identical and hide the mistake.
 */
export class UnknownSoundError extends Error {
  constructor(public readonly sound: string) {
    super(`Unknown sound "${sound}" — it has no entry in the sound table`);
    this.name = 'UnknownSoundError';
  }
}

export class AudioService {
  private enabled: boolean;
  private sink: IAudioSink;

  constructor(sink?: IAudioSink, enabled?: boolean) {
    this.sink = sink ?? new WebAudioSink();
    // Initialize enabled state from localStorage if available
    if (enabled !== undefined) {
      this.enabled = enabled;
    } else if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('wod-wiki-audio-enabled');
        this.enabled = stored !== null ? stored === 'true' : true;
      } catch {
        this.enabled = true;
      }
    } else {
      this.enabled = true;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('wod-wiki-audio-enabled', String(enabled));
      } catch {
        // localStorage can throw in private-mode browsers; the toggle is best-effort.
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Play a named sound.
   *
   * @throws {UnknownSoundError} when the name has no entry in the sound
   * table. A missing sound is a real defect and must be visible.
   */
  async playSound(name: string, volume: number = 1.0): Promise<void> {
    if (!this.enabled) return;

    const def = getSoundDef(name);
    if (!def) {
      throw new UnknownSoundError(name);
    }

    // Initialize sink if it supports init (WebAudioSink does)
    if ('init' in this.sink && typeof this.sink.init === 'function') {
      this.sink.init();
    }

    await this.sink.playNotes(def.notes, volume);
  }
}

/**
 * Default singleton for backward compatibility.
 * Uses WebAudioSink (production audio output).
 */
export const audioService = new AudioService();
