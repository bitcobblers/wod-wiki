import { describe, expect, it } from 'vitest';
import {
  isDefaultShorthandQueryBlock,
  isYamlQueryBlockBody,
  parseQueryBlock,
  queryBlockToDocumentText,
  serializeQueryBlock,
  type QueryBlockObject,
} from '../src/queryBlockCodec';
import { parseDocument } from '../src/document';
import { parseQuery } from '../src/wql';

describe('queryBlockCodec — 1-line shorthand, canonical YAML & legacy normalization', () => {
  it('keeps 1-line session shorthand minimal until customized', () => {
    const raw = ':session{result:0196ed40-8a1c-7000-8000-000000000001}';
    expect(isYamlQueryBlockBody(raw)).toBe(false);
    const obj = parseQueryBlock(raw);
    expect(obj).toEqual({
      view: 'table',
      query: raw,
    });
    expect(isDefaultShorthandQueryBlock(obj)).toBe(true);
    expect(serializeQueryBlock(obj)).toBe(raw);

    // Customizing columns/sort expands cleanly into deterministic YAML
    const customized: QueryBlockObject = {
      ...obj,
      columns: ['effort', 'reps', 'weight', 'calc.e1rm'],
      sort: [{ col: 'calc.e1rm', dir: 'desc' }],
      comparePr: true,
    };
    expect(isDefaultShorthandQueryBlock(customized)).toBe(false);
    const yaml = serializeQueryBlock(customized);
    expect(isYamlQueryBlockBody(yaml)).toBe(true);
    expect(yaml).toContain('view: table');
    expect(yaml).toContain('comparePr: true');
    expect(yaml).toContain('columns: [effort, reps, weight, calc.e1rm]');
    expect(yaml).toContain('sort: [calc.e1rm desc]');
    expect(parseQueryBlock(yaml)).toEqual(customized);
  });

  it('round-trips multi-series YAML with rolling baseline, formula, $scope, and goal token', () => {
    const yaml = [
      'title: Weekly Strength Tonnage',
      'description: Is volume rising relative to the 4-week baseline?',
      'view: timeseries',
      'span: 2',
      'window: 8w',
      'groupBy: [week]',
      'goal: $tonnageGoal',
      'series:',
      '  - id: tonnage',
      '    label: Weekly Tonnage',
      '    query: sum:totalVolume{discipline:strength,$scope}',
      '  - id: baseline',
      '    label: 4w Baseline',
      '    query: avg:totalVolume{discipline:strength,$scope}.rollup(4w)',
      '  - id: ratio',
      '    label: Acute Ratio',
      '    formula: tonnage / baseline',
      '    unit: ratio',
    ].join('\n');

    expect(isYamlQueryBlockBody(yaml)).toBe(true);
    const parsed = parseQueryBlock(yaml);
    expect(parsed.error).toBeUndefined();
    expect(parsed.title).toBe('Weekly Strength Tonnage');
    expect(parsed.view).toBe('timeseries');
    expect(parsed.span).toBe(2);
    expect(parsed.window).toEqual({ kind: 'relative', size: 8, unit: 'w' });
    expect(parsed.groupBy).toEqual(['week']);
    expect(parsed.goal).toEqual({ param: 'tonnageGoal' });
    expect(parsed.series).toHaveLength(3);

    const reserialized = serializeQueryBlock(parsed);
    expect(parseQueryBlock(reserialized)).toEqual(parsed);

    const docText = queryBlockToDocumentText(parsed);
    const doc = parseDocument(docText);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.doc.assignments).toHaveLength(3);
    expect(doc.doc.show).toEqual(['tonnage', 'baseline', 'ratio']);
  });

  it('normalizes legacy fence suffixes, adjacent headings, and pipeline chart sinks into QueryBlockObject', () => {
    const legacyObj = parseQueryBlock(
      ':segment{effort:back-squat} | :max{metric:calc.e1rm} | :goal-rings{goal:"$squatGoal"}',
      {
        fenceTag: 'query:goal-rings-2 goal=$squatGoal',
        adjacentTitle: 'Squat goal',
        adjacentDescription: 'How close to the target?',
      },
    );
    expect(legacyObj).toEqual({
      title: 'Squat goal',
      description: 'How close to the target?',
      view: 'goal-rings',
      span: 2,
      goal: { param: 'squatGoal' },
      query: 'max:calc.e1rm{effort:back-squat}',
    });
    expect(parseQuery(queryBlockToDocumentText(legacyObj)).error).toBeUndefined();
  });

  it('round-trips zone-distribution targets', () => {
    const obj: QueryBlockObject = {
      title: 'Intensity distribution',
      view: 'zone-distribution',
      targets: [80, 2, 18],
      query: 'sum:tis{} by {intensity}',
    };
    const yaml = serializeQueryBlock(obj);
    expect(yaml).toContain('targets: [80, 2, 18]');
    expect(parseQueryBlock(yaml)).toEqual(obj);
  });
});
