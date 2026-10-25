import { describe, expect, it } from 'bun:test';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { calcCompletionSource, type CalcCompletionOptions } from './calcCompletion';
import { analyzeCalcLine } from './calcDiagnostics';

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

  it('applies quoted lookup options without duplicating quotes', () => {
    const cases = [
      { line: 'v = lookup("', label: 'effort', doc: 'v = lookup("effort"', suffix: ', effort, "met")' },
      { line: 'v = lookup("effort", ', label: 'fran', doc: 'v = lookup("effort", "fran"', suffix: ', "met")' },
      { line: 'v = lookup("effort", effort, "', label: 'met', doc: 'v = lookup("effort", effort, "met"', suffix: ')' },
    ] as const;
    for (const { line, label, doc: expected, suffix } of cases) {
      const state = EditorState.create({ doc: line });
      const result = calcCompletionSource({ effortKeys: () => ['fran'] })(new CompletionContext(state, line.length, true));
      const option = result?.options.find((o) => o.label === label);
      expect(option).toBeDefined();
      if (!result || !option || typeof option.apply !== 'string') throw new Error(`Missing apply for ${label}`);
      const applied = state.update({ changes: { from: result.from, to: line.length, insert: option.apply } });
      const doc = applied.state.doc.toString();
      expect(doc).toBe(expected);
      expect(analyzeCalcLine(`${doc}${suffix}`, 'segment').diagnostics).toEqual([]);
    }
  });

  it('replaces an auto-closed quote instead of inserting a second one', () => {
    const line = 'v = lookup("")';
    const pos = line.length - 2;
    const state = EditorState.create({ doc: line });
    const result = calcCompletionSource({})(new CompletionContext(state, pos, true));
    const option = result?.options.find((o) => o.label === 'effort');
    expect(option).toBeDefined();
    expect(result?.to).toBe(pos + 1);
    if (!result || !option || typeof option.apply !== 'string') throw new Error('Missing quoted completion');
    const applied = state.update({ changes: { from: result.from, to: result.to ?? pos, insert: option.apply } });
    expect(applied.state.doc.toString()).toBe('v = lookup("effort")');
  });

  it('suggests units after the -> arrow', () => {
    const labels = complete('p = reps -> ');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain('reps');
  });

  it('offers only count units for a count expression', () => {
    const labels = complete('p = reps -> ');
    expect(labels).toContain('reps');
    expect(labels).not.toContain('kg');
    expect(labels).not.toContain('km');
  });

  it('offers only mass units for a mass expression', () => {
    const labels = complete('p = resistance -> ');
    expect(labels).toContain('kg');
    expect(labels).toContain('lb');
    expect(labels).not.toContain('reps');
    expect(labels).not.toContain('km');
  });

  it('offers only length units for a length expression', () => {
    const labels = complete('p = distance -> ');
    expect(labels).toContain('km');
    expect(labels).not.toContain('reps');
    expect(labels).not.toContain('kg');
  });

  it('offers no units when the inferred dimension has no registered output unit', () => {
    expect(complete('p = reps * reps -> ')).toEqual([]);
  });

  it('keeps dimension filtering while typing a partial unit after the arrow', () => {
    // A mid-draft `-> k` cannot compile as a whole; the pre-arrow expression
    // must still drive the dimension so mass/length/energy units never leak.
    expect(complete('p = reps -> k')).toEqual([]);
    expect(complete('p = resistance -> k')).toEqual(['kg']);
  });

  it('never suggests a typed unit that conflicts with the inferred dimension', () => {
    expect(complete('p = reps -> kg')).not.toContain('kg');
    expect(complete('p = resistance -> reps')).not.toContain('reps');
  });

  it('applies suggestions that compile clean with the inferred dimension', () => {
    const cases = [
      { line: 'p = reps -> ', label: 'reps', compound: 'count' },
      { line: 'p = resistance -> ', label: 'kg', compound: 'mass' },
      { line: 'p = distance -> ', label: 'km', compound: 'length' },
    ] as const;
    for (const { line, label, compound } of cases) {
      const state = EditorState.create({ doc: line });
      const result = calcCompletionSource({})(new CompletionContext(state, line.length, true));
      const option = result?.options.find((o) => o.label === label);
      expect(option).toBeDefined();
      if (!result || !option) throw new Error(`Missing completion for ${label}`);
      const applied = state.update({ changes: { from: result.from, to: line.length, insert: typeof option.apply === 'string' ? option.apply : option.label } });
      const doc = applied.state.doc.toString();
      expect(doc).toBe(line + label);
      const analysis = analyzeCalcLine(doc, 'segment');
      expect(analysis.diagnostics).toEqual([]);
      expect(analysis.compound).toBe(compound);
    }
  });

  it('keeps segment atoms in scope for the plain-word slot', () => {
    expect(complete('re', { scope: 'segment' })).toContain('reps');
  });
});
