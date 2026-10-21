/**
 * Regression checks for the shared clock command registry: authority
 * selection/priority handoff, dispatch validation, NumLock-independent key
 * normalization (user amendment) and draft parsing. Pure module — no React,
 * no DOM.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import {
  applyEntryKey,
  dispatchClockCommand,
  getClockSnapshot,
  isClockCommand,
  normalizeClockKey,
  parseClockDraftValue,
  registerClockController,
  unregisterClockController,
  type ClockSnapshot,
} from './clockCommands';

const registered: number[] = [];

function snap(runId: string, overrides: Partial<ClockSnapshot> = {}): ClockSnapshot {
  return {
    runId,
    phase: 'live',
    status: 'running',
    canNext: true,
    canStop: true,
    stopRequested: false,
    reps: [],
    selectedOccurrenceId: null,
    entry: null,
    error: null,
    saving: false,
    ...overrides,
  };
}

function register(
  runId: string,
  priority: number,
  handler: () => boolean = () => true,
  overrides: Partial<ClockSnapshot> = {},
): number {
  const id = registerClockController({ snapshot: snap(runId, overrides), handler, priority, keyboard: false });
  registered.push(id);
  return id;
}

afterEach(() => {
  while (registered.length > 0) unregisterClockController(registered.pop()!);
  expect(getClockSnapshot()).toBeNull();
});

describe('clock command registry', () => {
  it('routes dispatch to the highest-priority controller only', () => {
    let liveHits = 0;
    let wizardHits = 0;
    register('run-live', 0, () => { liveHits += 1; return true; });
    register('run-wizard', 10, () => { wizardHits += 1; return true; });

    expect(getClockSnapshot()?.runId).toBe('run-wizard');
    expect(dispatchClockCommand('run-wizard', { kind: 'next' })).toBe(true);
    expect(wizardHits).toBe(1);
    expect(liveHits).toBe(0);

    // Wrong run id (e.g. a stale receiver echo) never reaches any handler.
    expect(dispatchClockCommand('run-live', { kind: 'next' })).toBe(false);
    expect(liveHits).toBe(0);
  });

  it('falls back by registration order at equal priority and restores on unmount', () => {
    let inlineHits = 0;
    let fullscreenHits = 0;
    register('run-inline', 0, () => { inlineHits += 1; return true; }, { status: 'running' });
    const fullscreen = register('run-inline', 0, () => { fullscreenHits += 1; return true; }, { status: 'paused' });

    // Same priority: the most recently registered (fullscreen overlay) owns
    // the projected snapshot.
    expect(getClockSnapshot()?.status).toBe('paused');
    dispatchClockCommand('run-inline', { kind: 'playback' });
    expect(fullscreenHits).toBe(1);
    expect(inlineHits).toBe(0);

    unregisterClockController(fullscreen);
    registered.splice(registered.indexOf(fullscreen), 1);

    // Authority hands back to the still-mounted inline clock.
    expect(getClockSnapshot()?.status).toBe('running');
    expect(dispatchClockCommand('run-inline', { kind: 'playback' })).toBe(true);
    expect(inlineHits).toBe(1);
  });

  it('rejects handler failures and unknown payloads at the boundary', () => {
    register('run-a', 0, () => false);
    expect(dispatchClockCommand('run-a', { kind: 'next' })).toBe(false);
    expect(dispatchClockCommand('run-a', { kind: 'stop-request' })).toBe(false);

    expect(isClockCommand({ kind: 'next' })).toBe(true);
    expect(isClockCommand({ kind: 'entry-save', fieldId: 'f', value: 3 })).toBe(true);
    expect(isClockCommand({ kind: 'nope' })).toBe(false);
    expect(isClockCommand({ kind: 'reps-adjust', occurrenceId: 'x', delta: 2 })).toBe(false);
    expect(isClockCommand({ kind: 'reps-set', occurrenceId: 'x', value: -1 })).toBe(false);
    expect(isClockCommand({ kind: 'entry-save', fieldId: 'f', value: 'x' })).toBe(false);
    // Unvalidated transport payloads stay `unknown` until the guard passes —
    // dispatchClockCommand's parameter never sees raw input.
    const transport: unknown = { kind: 'nope' };
    expect(isClockCommand(transport)).toBe(false);
  });
});

describe('normalizeClockKey (NumLock amendment)', () => {
  const live = { entryOpen: false, mode: 'navigation' as const };
  const entry = { entryOpen: true, mode: 'navigation' as const };

  it('numpad arrows navigate live regardless of Num Lock', () => {
    // Num Lock off: key is the arrow name, code still says Numpad8.
    expect(normalizeClockKey({ key: 'ArrowUp', code: 'Numpad8', location: 3 }, live))
      .toEqual({ kind: 'direction', direction: 'up' });
    // Num Lock on: key is the digit.
    expect(normalizeClockKey({ key: '8', code: 'Numpad8', location: 3 }, live))
      .toEqual({ kind: 'direction', direction: 'up' });
    expect(normalizeClockKey({ key: '2', code: 'Numpad2' }, live))
      .toEqual({ kind: 'direction', direction: 'down' });
    expect(normalizeClockKey({ key: '4' }, live)).toEqual({ kind: 'direction', direction: 'left' });
    expect(normalizeClockKey({ key: '6' }, live)).toEqual({ kind: 'direction', direction: 'right' });
  });

  it('all digits are data during entry, including 8/2/4/6 and NumLock-off arrows', () => {
    expect(normalizeClockKey({ key: '8', code: 'Numpad8' }, entry)).toEqual({ kind: 'digit', digit: '8' });
    expect(normalizeClockKey({ key: 'ArrowDown', code: 'Numpad2' }, entry)).toEqual({ kind: 'digit', digit: '2' });
    expect(normalizeClockKey({ key: '5' }, entry)).toEqual({ kind: 'digit', digit: '5' });
    // Real arrows keep navigating inside the entry card.
    expect(normalizeClockKey({ key: 'ArrowUp', code: 'ArrowUp' }, entry))
      .toEqual({ kind: 'direction', direction: 'up' });
    expect(normalizeClockKey({ key: '.', code: 'NumpadDecimal' }, entry)).toEqual({ kind: 'digit', digit: '.' });
  });

  it('classifies Enter variants, media keys and operator keys', () => {
    expect(normalizeClockKey({ key: 'Enter', code: 'NumpadEnter', location: 3 }, live)).toEqual({ kind: 'primary' });
    expect(normalizeClockKey({ key: 'Enter', code: 'Enter', location: 0 }, live)).toEqual({ kind: 'select' });
    expect(normalizeClockKey({ key: 'Enter', code: 'Enter', location: 0 }, { ...live, mode: 'keypad' }))
      .toEqual({ kind: 'primary', ambiguous: true });
    expect(normalizeClockKey({ key: 'Unidentified', keyCode: 179 }, live)).toEqual({ kind: 'playback' });
    expect(normalizeClockKey({ key: '/', code: 'NumpadDivide' }, live)).toEqual({ kind: 'playback' });
    expect(normalizeClockKey({ key: '*', code: 'NumpadMultiply' }, live)).toEqual({ kind: 'values' });
    expect(normalizeClockKey({ key: '+', code: 'NumpadAdd' }, live)).toEqual({ kind: 'reps-adjust', delta: 1 });
    expect(normalizeClockKey({ key: '-', code: 'NumpadSubtract' }, live)).toEqual({ kind: 'reps-adjust', delta: -1 });
    expect(normalizeClockKey({ key: 'Escape' }, live)).toEqual({ kind: 'cancel' });
    expect(normalizeClockKey({ key: 'Select' }, { ...live, mode: 'keypad' })).toEqual({ kind: 'select' });
    expect(normalizeClockKey({ key: 'Unidentified', keyCode: 23 }, live)).toEqual({ kind: 'select' });
    expect(normalizeClockKey({ key: 'GoBack' }, entry)).toEqual({ kind: 'cancel' });
    expect(normalizeClockKey({ key: 'Backspace', code: 'Backspace' }, live)).toEqual({ kind: 'none' });
    expect(normalizeClockKey({ key: 'Backspace', code: 'Backspace' }, entry)).toEqual({ kind: 'back' });
  });
});

describe('applyEntryKey (shared draft editor)', () => {
  it('keeps duration drafts canonical M:SS and integer/decimal drafts raw', () => {
    expect(applyEntryKey('duration', '', '1')).toBe('1');
    expect(applyEntryKey('duration', '1', '3')).toBe('13'); // seconds fill first
    expect(applyEntryKey('duration', '13', '0')).toBe('1:30'); // third digit → minutes
    expect(applyEntryKey('duration', '1:30', '5')).toBe('13:05');
    expect(applyEntryKey('duration', '12:34', '5')).toBe('12:34'); // capacity cap
    expect(applyEntryKey('duration', '1:30', 'x')).toBe('1:30');
    expect(applyEntryKey('decimal', '12', '.')).toBe('12.');
    expect(applyEntryKey('decimal', '12.', '.')).toBe('12.');
    expect(applyEntryKey('integer', '', '7')).toBe('7');
    expect(applyEntryKey('integer', '', '.')).toBe('');
  });
});

describe('parseClockDraftValue', () => {
  it('parses integer, decimal and explicit M:SS duration drafts', () => {
    expect(parseClockDraftValue('15', 'integer')).toEqual({ ok: true, value: 15 });
    expect(parseClockDraftValue('0', 'integer')).toEqual({ ok: true, value: 0 });
    expect(parseClockDraftValue('1.5', 'integer').ok).toBe(false);
    expect(parseClockDraftValue('', 'integer').ok).toBe(false);
    expect(parseClockDraftValue('12.5', 'decimal')).toEqual({ ok: true, value: 12.5 });
    expect(parseClockDraftValue('.', 'decimal').ok).toBe(false);
    // "130" reads minutes-then-seconds: 1:30 — never an ambiguous 130.
    expect(parseClockDraftValue('130', 'duration')).toEqual({ ok: true, value: 90_000 });
    expect(parseClockDraftValue('1:30', 'duration')).toEqual({ ok: true, value: 90_000 });
    expect(parseClockDraftValue('5:', 'duration')).toEqual({ ok: true, value: 300_000 });
    expect(parseClockDraftValue('0:5', 'duration')).toEqual({ ok: true, value: 5_000 });
    expect(parseClockDraftValue('1:2:3', 'duration').ok).toBe(false);
    expect(applyEntryKey('duration', '1:30', 'back')).toBe('13');
    expect(applyEntryKey('integer', '12', 'clear')).toBe('');
    expect(parseClockDraftValue('1305', 'duration')).toEqual({ ok: true, value: 13 * 60_000 + 5_000 });
    expect(parseClockDraftValue('1365', 'duration').ok).toBe(false); // seconds > 59
    expect(parseClockDraftValue('12345', 'duration').ok).toBe(false);
  });
});
