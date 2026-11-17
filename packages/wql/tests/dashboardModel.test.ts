import { describe, expect, it } from 'vitest';
import {
  buildDashboardDocument,
  defaultTokenValues,
  extractDashboardTokens,
  isDashboardMeta,
  isDashboardWidgetType,
  isProposedMetric,
  parseQueryWidgetSuffix,
  referencedTokens,
  setDashboardTokenValue,
  substituteTokens,
} from '../src/dashboard/model';

describe('parseQueryWidgetSuffix', () => {
  it('parses a bare type', () => {
    expect(parseQueryWidgetSuffix('timeseries')).toEqual({ type: 'timeseries', attributes: {}, attributeOrder: [] });
  });

  it('parses type with column span', () => {
    expect(parseQueryWidgetSuffix('bar-2')).toEqual({ type: 'bar', spanCols: 2, attributes: {}, attributeOrder: [] });
  });

  it('parses type with full-row flag', () => {
    expect(parseQueryWidgetSuffix('heatmap-full')).toEqual({ type: 'heatmap', spanFull: true, attributes: {}, attributeOrder: [] });
  });

  it('parses kebab-case types', () => {
    expect(parseQueryWidgetSuffix('stacked-bar')).toEqual({ type: 'stacked-bar', attributes: {}, attributeOrder: [] });
    expect(parseQueryWidgetSuffix('zone-distribution-4')).toEqual({
      type: 'zone-distribution',
      spanCols: 4,
      attributes: {},
      attributeOrder: [],
    });
  });

  it('lowercases the type', () => {
    expect(parseQueryWidgetSuffix('TimeSeries')).toEqual({ type: 'timeseries', attributes: {}, attributeOrder: [] });
  });

  it('flags an empty type', () => {
    expect(parseQueryWidgetSuffix('').error).toBeDefined();
  });

  it('rejects span outside 1..4', () => {
    expect(parseQueryWidgetSuffix('bar-0').error).toContain('outside');
    expect(parseQueryWidgetSuffix('bar-5').error).toContain('outside');
    expect(parseQueryWidgetSuffix('bar-9').type).toBe('bar');
  });

  it('rejects span+full combos as mutually exclusive', () => {
    expect(parseQueryWidgetSuffix('bar-2-full').error).toBeDefined();
    expect(parseQueryWidgetSuffix('bar-full-2').error).toBeDefined();
  });

  it('keeps unknown types valid (renderer badges them)', () => {
    const parsed = parseQueryWidgetSuffix('bogus-widget');
    expect(parsed.error).toBeUndefined();
    expect(parsed.type).toBe('bogus-widget');
  });
});

describe('isDashboardWidgetType', () => {
  it('knows the locked vocabulary', () => {
    for (const t of ['table', 'value', 'timeseries', 'bar', 'toplist', 'stacked-bar', 'goal-rings', 'zone-distribution']) {
      expect(isDashboardWidgetType(t)).toBe(true);
    }
  });
  it('rejects others', () => {
    expect(isDashboardWidgetType('query_value')).toBe(false);
    expect(isDashboardWidgetType('')).toBe(false);
  });
});

describe('isProposedMetric', () => {
  it('identifies proposed calc.* metrics', () => {
    expect(isProposedMetric('calc.pmc')).toBe(true);
  });

  it('returns false for supported calc.* metrics', () => {
    expect(isProposedMetric('calc.acwr')).toBe(false);
    expect(isProposedMetric('calc.monotony')).toBe(false);
    expect(isProposedMetric('calc.strain')).toBe(false);
    expect(isProposedMetric('calc.e1rm')).toBe(false);
    expect(isProposedMetric('calc.ctl')).toBe(false);
    expect(isProposedMetric('calc.atl')).toBe(false);
    expect(isProposedMetric('calc.tsb')).toBe(false);
    expect(isProposedMetric('calc.soreness')).toBe(false);
    expect(isProposedMetric('calc.sleep')).toBe(false);
    expect(isProposedMetric('calc.hrv')).toBe(false);
    expect(isProposedMetric('calc.readiness')).toBe(false);
    expect(isProposedMetric('calc.mvcBw')).toBe(false);
    expect(isProposedMetric('calc.ef')).toBe(false);
    expect(isProposedMetric('calc.adherence')).toBe(false);
    expect(isProposedMetric('calc.pct1rm')).toBe(false);
    expect(isProposedMetric('calc.sends')).toBe(false);
  });

  it('returns false for standard non-calc metrics or empty', () => {
    expect(isProposedMetric('totalVolume')).toBe(false);
    expect(isProposedMetric('tis')).toBe(false);
    expect(isProposedMetric(undefined)).toBe(false);
  });
});

describe('isDashboardMeta / extractDashboardTokens', () => {
  it('detects the dashboard flag', () => {
    expect(isDashboardMeta({ dashboard: 'true' })).toBe(true);
    expect(isDashboardMeta({})).toBe(false);
    expect(isDashboardMeta({ dashboard: 'false' })).toBe(false);
  });

  it('extracts scalar and list tokens in declaration order', () => {
    const tokens = extractDashboardTokens({
      title: 'X',
      'dashboard.weeks': 16,
      'dashboard.intensity': ['low', 'moderate', 'high'],
      category: ['training'],
    });
    expect(tokens).toEqual([
      { name: 'weeks', values: ['16'], isList: false },
      { name: 'intensity', values: ['low', 'moderate', 'high'], isList: true },
    ]);
  });

  it('defaults lists to their first entry', () => {
    const tokens = extractDashboardTokens({ 'dashboard.intensity': ['low', 'high'], 'dashboard.weeks': 8 });
    expect(defaultTokenValues(tokens)).toEqual({ intensity: 'low', weeks: '8' });
  });

  it('writes a list-token selection back by reordering the default (#899-6)', () => {
    const meta = { 'dashboard.intensity': ['low', 'moderate', 'high'] };
    expect(setDashboardTokenValue(meta, 'intensity', 'high')).toEqual({
      'dashboard.intensity': ['high', 'low', 'moderate'],
    });
    expect(meta['dashboard.intensity']).toEqual(['low', 'moderate', 'high']);
  });

  it('writes a scalar token back, preserving numeric type', () => {
    expect(setDashboardTokenValue({ 'dashboard.weeks': 16 }, 'weeks', '8')).toEqual({
      'dashboard.weeks': 8,
    });
    expect(setDashboardTokenValue({ 'dashboard.athlete': 'serge' }, 'athlete', 'alex')).toEqual({
      'dashboard.athlete': 'alex',
    });
  });

  it('refuses undeclared list values', () => {
    const meta = { 'dashboard.intensity': ['low', 'high'] };
    expect(setDashboardTokenValue(meta, 'intensity', 'extreme')).toBe(meta);
  });

  it('ignores empty lists and the bare prefix', () => {
    expect(extractDashboardTokens({ 'dashboard.': 'x', 'dashboard.empty': [] })).toEqual([]);
  });
});

describe('substituteTokens', () => {
  it('substitutes known references as raw text', () => {
    expect(substituteTokens('sum:totalVolume{} last $weeks w', { weeks: '16' })).toEqual({
      query: 'sum:totalVolume{} last 16 w',
      missing: [],
    });
  });

  it('substitutes inside filters', () => {
    expect(
      substituteTokens('sum:sessionLoad{intensity:$intensity}', { intensity: 'low' }).query,
    ).toBe('sum:sessionLoad{intensity:low}');
  });

  it('reports missing references and leaves them literal', () => {
    const { query, missing } = substituteTokens('avg:tis{} / $goal', {});
    expect(query).toBe('avg:tis{} / $goal');
    expect(missing).toEqual(['goal']);
  });

  it('collects each missing name once', () => {
    expect(substituteTokens('$a $b $a', { b: '1' }).missing).toEqual(['a']);
  });
});

describe('referencedTokens', () => {
  it('lists referenced names in order, deduped', () => {
    expect(referencedTokens('sum:x{} / $goal last $weeks $goal')).toEqual(['goal', 'weeks']);
  });
});

describe('fence-tag attributes (decision 22)', () => {
  it('parses trailing key=value attributes', () => {
    expect(parseQueryWidgetSuffix('goal-ring-2 goal=100')).toEqual({
      type: 'goal-ring', spanCols: 2, attributes: { goal: '100' }, attributeOrder: ['goal'],
    });
  });

  it('keeps quoted values verbatim minus quotes', () => {
    expect(parseQueryWidgetSuffix('table label="300 Air Squats"').attributes).toEqual({
      label: '300 Air Squats',
    });
  });

  it('duplicate attributes are a suffix error', () => {
    expect(parseQueryWidgetSuffix('bar a=1 a=2').error).toContain('duplicate');
  });
});

function md(type: string, content: string): import('../src/dashboard/model').DashboardSectionInput {
  return { type: 'markdown', subtype: type, content };
}

function query(
  body: string,
  opts: { widgetType?: string; spanCols?: number; spanFull?: boolean } = {},
): import('../src/dashboard/model').DashboardSectionInput {
  return {
    type: 'query',
    content: body,
    widgetType: opts.widgetType,
    spanCols: opts.spanCols,
    spanFull: opts.spanFull,
    attributes: {},
    attributeOrder: [],
  };
}

describe('buildDashboardDocument', () => {
  it('marks non-dashboard notes and still collects widgets', () => {
    const doc = buildDashboardDocument([query('sum:x{}')], {});
    expect(doc.isDashboard).toBe(false);
    expect(doc.widgets).toHaveLength(1);
  });

  it('reads title and tokens from frontmatter meta', () => {
    const doc = buildDashboardDocument([], {
      title: 'Polarized Base',
      dashboard: 'true',
      'dashboard.weeks': 16,
    });
    expect(doc.isDashboard).toBe(true);
    expect(doc.title).toBe('Polarized Base');
    expect(doc.tokens.map((t) => t.name)).toEqual(['weeks']);
  });

  it('associates heading + paragraph directly above a block', () => {
    const doc = buildDashboardDocument(
      [
        md('heading', '## Weekly tonnage'),
        md('paragraph', 'Is volume rising?'),
        query('sum:totalVolume{} by {week}', { widgetType: 'timeseries', spanCols: 2 }),
      ],
      {},
    );
    expect(doc.widgets[0]).toMatchObject({
      type: 'timeseries',
      spanCols: 2,
      title: 'Weekly tonnage',
      question: 'Is volume rising?',
      body: 'sum:totalVolume{} by {week}',
    });
  });

  it('associates a heading directly above with no paragraph', () => {
    const doc = buildDashboardDocument(
      [md('heading', '# Squat e1RM'), query('max:calc.e1rm{}')],
      {},
    );
    expect(doc.widgets[0].title).toBe('Squat e1RM');
    expect(doc.widgets[0].question).toBeUndefined();
  });

  it('does not associate across other sections', () => {
    const doc = buildDashboardDocument(
      [
        md('heading', '## Far away'),
        { type: 'code', content: 'x' },
        query('sum:x{}'),
      ],
      {},
    );
    expect(doc.widgets[0].title).toBeUndefined();
  });

  it('associates each widget to its own nearest heading', () => {
    const doc = buildDashboardDocument(
      [
        md('heading', '## First'),
        query('sum:a{}'),
        md('heading', '## Second'),
        md('paragraph', 'q2'),
        query('sum:b{}'),
      ],
      {},
    );
    expect(doc.widgets.map((w) => w.title)).toEqual(['First', 'Second']);
    expect(doc.widgets[0].question).toBeUndefined();
    expect(doc.widgets[1].question).toBe('q2');
  });

  it('splits widget params from the body', () => {
    const doc = buildDashboardDocument([query('max:calc.e1rm{}')], {});
    expect(doc.widgets[0].body).toBe('max:calc.e1rm{}');
  });

  it('skips comment and blank lines to find the body', () => {
    const doc = buildDashboardDocument([query('\n# a note\nsum:x{}\n')], {});
    expect(doc.widgets[0].body).toBe('sum:x{}');
  });
});
