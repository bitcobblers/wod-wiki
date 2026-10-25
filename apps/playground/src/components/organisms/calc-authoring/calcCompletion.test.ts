import { describe, expect, it } from 'bun:test';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { calcCompletionSource, type CalcCompletionOptions } from './calcCompletion';

/** Run the provider explicitly at end-of-line, as Ctrl-Space would. */
function complete(line: string, options?: CalcCompletionOptions): string[] {
  const state = EditorState.create({ doc: line });
  const result = calcCompletionSource(options)(new CompletionContext(state, line.length, true));
  return result ? result.options.map((option) => option.label) : [];
}

describe('calcCompletionSource', () => {
  it('suggests lookup tables in the first quoted slot', () => {
    expect(complete('v = lookup("')).toEqual(['effort', 'rpe-labels', 'profile', 'disciplines']);
    expect(complete('v = lookup("rp')).toEqual(['rpe-labels']);
  });

  it('feeds live effort registry slugs into the lookup key slot', () => {
    expect(complete('v = lookup("effort", ', { effortKeys: () => ['fran', 'grace'] }))
      .toEqual(['effort', 'fran', 'grace']);
    expect(complete('v = lookup("effort", fr', { effortKeys: () => ['fran', 'grace'] }))
      .toEqual(['fran']);
  });

  it('falls back to the static effort samples until the registry feeds slugs', () => {
    expect(complete('v = lookup("effort", ', {})).toContain('thruster');
    expect(complete('v = lookup("effort", ', { effortKeys: () => [] })).toContain('wall-ball');
  });

  it('suggests units after the -> arrow', () => {
    const labels = complete('p = reps -> ');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain('reps');
  });

  it('keeps segment atoms in scope for the plain-word slot', () => {
    expect(complete('re', { scope: 'segment' })).toContain('reps');
  });
});
