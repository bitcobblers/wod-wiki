import type { NoteDef } from './AudioPolicy';

/**
 * IAudioSink — port for audio output.
 * Production: Web Audio API. Tests: RecordingAudioSink.
 */
export interface IAudioSink {
  /** Play a sequence of notes (with optional offsets from t=0). */
  playNotes(notes: readonly NoteDef[], volume: number): void | Promise<void>;
  /** Resume/reserve the underlying audio context (browser security). */
  init?(): void;
}
