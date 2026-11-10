import { describe, expect, it } from 'vitest';
import { parseQuery } from '../src/wql';
import { serialize } from '../src/serialize';
import { bindQueryParams, collectQueryParams } from '../src/paramRef';

describe('WQL first-class $param (ParamRef) AST & binding', () => {
  it('parses and round-trips spread filter $scope, value $effort, metric $metric, and window $weeks', () => {
    const cases = [
      'sum:totalVolume{discipline:strength,$scope}',
      'sum:$metric{effort:$effort} by {week}',
      ':segment{$scope,intensity:$intensity} last $weeks w',
      ':note{$scope} last $range',
      ':segment{effort:$effort} | :sum{metric:$metric} by {week}',
    ];
    for (const raw of cases) {
      const parsed = parseQuery(raw);
      expect(parsed.error, raw).toBeUndefined();
      const roundTripped = serialize(parsed);
      expect(roundTripped).toBe(raw);
      expect(parseQuery(roundTripped).error, roundTripped).toBeUndefined();
    }
  });

  it('collects referenced parameter names in appearance order', () => {
    const parsed = parseQuery('sum:$metric{discipline:strength,$scope,effort:$effort} last $weeks w');
    expect(parsed.error).toBeUndefined();
    expect(collectQueryParams(parsed)).toEqual(['metric', 'scope', 'effort', 'weeks']);
  });

  it('drops empty optional $scope without leaving a trailing-comma syntax error', () => {
    const parsed = parseQuery('sum:totalVolume{discipline:strength,$scope} by {week}');
    expect(parsed.error).toBeUndefined();
    const bound = bindQueryParams(parsed, { scope: '' });
    expect(bound.missing).toEqual([]);
    expect(bound.parsed.error).toBeUndefined();
    expect(serialize(bound.parsed)).toBe('sum:totalVolume{discipline:strength} by {week}');
  });

  it('expands multi-clause $scope and lifts content-only keys into where :note{...} on aggregates', () => {
    const parsed = parseQuery('sum:totalVolume{$scope} by {week}');
    const effortBound = bindQueryParams(parsed, { scope: 'effort:back-squat, discipline:strength' });
    expect(effortBound.missing).toEqual([]);
    expect(effortBound.parsed.error).toBeUndefined();
    expect(serialize(effortBound.parsed)).toBe('sum:totalVolume{effort:back-squat,discipline:strength} by {week}');

    const notebookBound = bindQueryParams(parsed, { scope: 'notebook:crossfit-girls' });
    expect(notebookBound.missing).toEqual([]);
    expect(notebookBound.parsed.error).toBeUndefined();
    expect(serialize(notebookBound.parsed)).toBe('sum:totalVolume{} by {week} where :note{notebook:crossfit-girls}');
  });

  it('reports missing tokens cleanly when unbound', () => {
    const parsed = parseQuery('max:calc.e1rm{effort:$lift} last $range');
    const res = bindQueryParams(parsed, { lift: 'deadlift' });
    expect(res.missing).toEqual(['range']);
  });
});
