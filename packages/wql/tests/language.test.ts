import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { highlightTree, tags as t } from '@lezer/highlight';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  wqlLanguage,
  wqlCompletionSource,
} from '../src/language';
import { wqlFilterKeys, wqlGroupingDimensions } from '../src/capabilities';
import { WQL_SOURCE_VALUES } from '../src/vocabulary';
import { EFFORT_DISCIPLINES } from '../src/disciplines';

const EFFORTS = ['thruster', 'back-squat', 'rowing'];
const source = wqlCompletionSource({ effortNames: () => EFFORTS });

function complete(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc, extensions: [wqlLanguage] });
  ensureSyntaxTree(state, doc.length, 200);
  const labels = source(new CompletionContext(state, pos, true))?.options.map((o) => o.label);
  return labels ?? null;
}

async function completeAsync(scm: typeof source, doc: string) {
  const state = EditorState.create({ doc, extensions: [wqlLanguage] });
  ensureSyntaxTree(state, doc.length, 200);
  const result = await scm(new CompletionContext(state, doc.length, true));
  return result?.options ?? null;
}

describe('wqlCompletionSource', () => {
  it('offers heads at the query start, narrowed by prefix', () => {
    expect(complete('su')).toEqual(['sum']);
    expect(complete('@to')).toEqual(['@today']);
  });

  it('offers Canonical Metric Keys after the head colon', () => {
    const labels = complete('sum:')!;
    expect(labels).toContain('totalVolume');
    expect(labels).toContain('tis');
    expect(labels).toContain('reps');
    expect(labels).toContain('thruster.reps');
    expect(labels).toContain('back-squat.resistance');
    expect(labels).toContain('calc.');
  });

  it('resolves the head target and offers its supported filter keys', () => {
    // :note — target-aware keys, no discipline on note.
    expect(complete(':note{')).toEqual([...wqlFilterKeys('note', 'find')]);
    expect(complete(':note{')).not.toContain('discipline');
    // partially typed target resolves through the unique prefix.
    expect(complete(':no{')).toEqual([...wqlFilterKeys('note', 'find')]);
    // aggregate heads keep the full fact-key list.
    expect(complete('sum:tis{')).toEqual([...wqlFilterKeys('', 'aggregate')]);
  });

  it('excludes already-used filter keys from the open group', () => {
    const labels = complete(':note{source:journal,')!;
    expect(labels).not.toContain('source');
    expect(labels).toContain('text');
  });

  it('negation ! reopens the same field list as an exclude', () => {
    const labels = complete(':note{!')!;
    expect(labels).toEqual([...wqlFilterKeys('note', 'find')]);
    const doc = ':note{!';
    const picked = source(new CompletionContext(EditorState.create({ doc, extensions: [wqlLanguage] }), doc.length, true))!
      .options.find((o) => o.label === 'source')!;
    expect(picked.detail).toContain('exclude');
  });

  it('offers resolver-fed effort names for effort values, narrowed by prefix', () => {
    expect(complete('sum:tis{effort:')).toEqual(EFFORTS);
    expect(complete('sum:tis{effort:th')).toEqual(['thruster']);
  });

  it('offers the canonical discipline vocabulary for discipline values', () => {
    const labels = complete('sum:tis{discipline:')!;
    expect(labels).toContain('strength');
    expect(labels).toContain('kettlebell');
    expect(labels).toHaveLength(10);
  });

  it('offers intensity tiers and grains for their values', () => {
    expect(complete('sum:tis{intensity:')).toEqual(['low', 'moderate', 'high']);
    expect(complete('sum:tis{grain:')).toEqual(['summary', 'event']);
  });

  it('merges host values first with static canonical after, deduped by value', async () => {
    const hosted = wqlCompletionSource({
      effortNames: () => EFFORTS,
      values: async (key) => (key === 'discipline' ? [{ label: 'Strongman' }, { label: 'strength' }] : []),
    });
    const options = await completeAsync(hosted, ':effort{discipline:');
    // Host rank first; case-insensitive dedup collapses 'strength'; static fills the rest.
    expect(options!.map((o) => o.label)).toEqual([
      'Strongman', 'strength',
      ...EFFORT_DISCIPLINES.filter((d) => d !== 'strength'),
    ]);
    expect(options![0].boost!).toBeGreaterThan(options![2].boost ?? 0);
  });

  it('quotes whitespace values and never quotes inside an open quote', async () => {
    const spaced = wqlCompletionSource({ values: async (key) => (key === 'text' ? [{ label: '300 air squats' }] : []) });
    const outside = await completeAsync(spaced, ':note{text:');
    expect(outside!.map((o) => o.label)).toEqual(['300 air squats']);
    expect(typeof outside![0].apply).toBe('function'); // quote-wrap insertion

    const inside = await completeAsync(spaced, ':note{text:"300 air squ');
    expect(inside!.map((o) => o.label)).toEqual(['300 air squats']);
    expect(typeof inside![0].apply).toBe('function'); // runtime check inserts raw (no double quote)
  });

  it('offers injected typed-tag values for frontmatter tag filters', async () => {
    const typedSource = wqlCompletionSource({
      effortNames: () => EFFORTS,
      tagTypeValues: async (key) =>
        ({ domain: ['crossfit', 'parkour'], equipment: ['kettlebell', 'clubs'] })[key as 'domain' | 'equipment'] ?? [],
    });
    expect((await completeAsync(typedSource, ':note{domain:')).map((o) => o.label)).toEqual(['crossfit', 'parkour']);
    expect((await completeAsync(typedSource, ':note{equipment:kettlebell')).map((o) => o.label)).toEqual(['kettlebell']);
  });

  it('closes quietly on free-form values (text stays as written)', () => {
    expect(complete(':note{domain:')).toBeNull();
    expect(complete('sum:tis{note:')).toBeNull();
  });

  it('target-aware group-by dimensions with used-dim exclusion', () => {
    const aggregate = complete('sum:tis{} by {')!;
    for (const dim of ['day', 'week', 'session', 'effort']) expect(aggregate).toContain(dim);
    const content = complete(':note by {')!;
    expect(content).toEqual([...wqlGroupingDimensions('note', 'find')]);
    expect(complete(':note by {week,')!).not.toContain('week');
  });

  it('offers rollup periods inside .rollup() on aggregate heads only', () => {
    const labels = complete('sum:tis{}.rollup(')!;
    expect(labels).toContain('2w');
    expect(labels).toContain('4w');
    expect(complete(':note{}.rollup(')).toBeNull(); // find ignores rollup (advisory)
  });

  it('offers structural suffixes after a complete head', () => {
    expect(complete('sum:tis ')).toEqual(['by {}', '.rollup()', 'last', 'from']);
    expect(complete(':note ')).toEqual(['by {}', 'last', 'from', '|']);
  });

  it('disambiguates last the aggregator from last the time window', () => {
    // Query start / inside the head word → the aggregator slot.
    expect(complete('las')).toEqual(['last']);
    // After a complete head → the window keyword (apply opens `last <n>d|w`).
    expect(complete('sum:tis last')).toEqual(['last']);
    const picked = source(new CompletionContext(EditorState.create({ doc: 'sum:tis last', extensions: [wqlLanguage] }), 12, true))!
      .options[0];
    // chained() rewrites apply into an inserter — the window variant is the
    // one whose detail marks it as `last <n>d|w`, not the `last:` aggregator.
    expect(picked.detail).toBe('relative window: last <n>d|w');
    expect(typeof picked.apply).toBe('function');
  });

  it('completes relative window units after last <n>', () => {
    expect(complete(':note last 4')).toEqual(['d', 'w']);
    expect(complete(':note last 4w')).toBeNull();
    expect(complete(':note last ')).toEqual(['4w', '8w', '7d', '30d']); // placeholder windows
  });

  it('completes the date range from → to chain', () => {
    expect(complete(':note from ')).toEqual(['2026-01-01']);
    expect(complete(':note from 2026-01-01 ')).toEqual(['to']);
    expect(complete(':note from 2026-01-01 to ')).toEqual(['2026-03-31']);
  });

  it('offers presentation pipe clauses after |, not inside braces', () => {
    expect(complete(':note | ')).toEqual(['order by', 'select', 'limit']);
    // OR pipe inside braces continues the same key's value list.
    expect(complete('sum:tis{effort:fran|')).toEqual(EFFORTS);
    // Quoted pipe/colon never becomes a suffix boundary.
    expect(complete('sum:tis{effort:"th')).toEqual(['thruster']);
  });

  it('carries executor advisories on ignored pipe clauses', () => {
    const doc = ':note | ';
    const state = EditorState.create({ doc, extensions: [wqlLanguage] });
    ensureSyntaxTree(state, doc.length, 200);
    const opts = source(new CompletionContext(state, doc.length, true))!.options;
    expect(opts.find((o) => o.label === 'select')!.detail).toContain('advisory');
  });

  it('completes per-target pipe columns, directions, units and limit', () => {
    expect(complete(':note | order by ')).toEqual(['title', 'date', 'createdAt', 'type', 'sourceId', 'catalog', 'notebookId']);
    expect(complete(':note | order by title ')).toEqual(['asc', 'desc']);
    expect(complete(':segment | select ')).toContain('date');
    expect(complete(':segment | select distance ')).toEqual(['kg', 'lb']);
    expect(complete(':segment | select distance in ')).toEqual(['kg', 'lb']);
    expect(complete(':segment | limit ')).toBeNull(); // numeric placeholder is free-form
  });
});

describe('wqlCompletionSource — aggressive slots', () => {
  const at = (doc: string, from: number, to: number) => {
    const state = EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [wqlLanguage] });
    ensureSyntaxTree(state, doc.length, 200);
    const result = source(new CompletionContext(state, to, false));
    if (!result || !('options' in result)) return null;
    return { labels: result.options.map((o) => o.label), from: result.from, to: result.to, filter: result.filter };
  };

  it('offers every sibling when a slot token is selected, replacing it', () => {
    // Legacy `agg:` head slot offers the retained aggregators.
    const head = at('sum:tis{} last 2w', 0, 3)!;
    expect(head.labels).toEqual(['sum', 'avg', 'min', 'max', 'count', 'last', 'delta']);
    expect([head.from, head.to, head.filter]).toEqual([0, 3, false]);

    // The retired find: target slot is gone — a colon head word offers the
    // head vocabulary instead.
    const target = at(':note last 2w', 1, 5)!;
    expect(target.labels).toContain('note');
    expect(target.labels).toContain('journal');
    expect(target.labels).toContain('sum');
    expect([target.from, target.to, target.filter]).toEqual([1, 5, false]);
  });

  it('offers colon heads inside the colon head word, replacing it', () => {
    const head = at(':segm last 2w', 1, 5)!;
    expect(head.labels).toContain('segment');
    expect(head.labels).toContain('sum');
    expect([head.from, head.to, head.filter]).toEqual([1, 5, false]);
  });

  it('offers values for the selected filter value and keys for the selected key', () => {
    const doc = ':note{source:journal}';
    const keyFrom = doc.indexOf('source');
    const valueFrom = doc.indexOf('journal');
    expect(at(doc, valueFrom, valueFrom + 'journal'.length)!.labels).toEqual([...WQL_SOURCE_VALUES]);
    expect(at(doc, keyFrom, keyFrom + 'source'.length)!.labels).toEqual([...wqlFilterKeys('note', 'find')]);
  });

  it('opens the next slot right after a separator without a keystroke', () => {
    const doc = ':note{';
    const state = EditorState.create({ doc, extensions: [wqlLanguage] });
    ensureSyntaxTree(state, doc.length, 200);
    const result = source(new CompletionContext(state, doc.length, false));
    if (!result || !('options' in result)) throw new Error('expected completion options');
    expect(result.options.map((o) => o.label)).toEqual([...wqlFilterKeys('note', 'find')]);
    const valueDoc = ':note{source:';
    const valueState = EditorState.create({ doc: valueDoc, extensions: [wqlLanguage] });
    ensureSyntaxTree(valueState, valueDoc.length, 200);
    const values = source(new CompletionContext(valueState, valueDoc.length, false));
    if (!values || !('options' in values)) throw new Error('expected completion options');
    expect(values.options.map((o) => o.label)).toContain('journal');
  });

  it('ranks host-supplied values ahead of the static vocabulary', async () => {
    const hosted = wqlCompletionSource({ values: async (key) => (key === 'source' ? [{ label: 'mine' }] : []) });
    const doc = ':note{source:';
    const state = EditorState.create({ doc, extensions: [wqlLanguage] });
    ensureSyntaxTree(state, doc.length, 200);
    const result = await hosted(new CompletionContext(state, doc.length, true));
    expect(result?.options.map((o) => o.label)).toEqual(['mine', ...WQL_SOURCE_VALUES]);
  });
});

describe('wqlCompletionSource — colon heads', () => {
  it('offers head names after the colon, narrowed by prefix', () => {
    expect(complete(':')).toEqual([
      'sum', 'avg', 'min', 'max', 'count', 'last', 'delta',
      'note', 'notes', 'block', 'effort', 'session', 'segment', 'event', 'journal', 'notebook', 'notebooks', 'feed', 'feeds', 'catalog', 'catalogs', 'playground', 'dashboard',
      'timeseries', 'bar', 'table', 'donut', 'toplist', 'value',
      '@session', '@today',
    ]);
    expect(complete(':j')).toEqual(['journal']);
  });

  it('resolves colon source heads to target-aware filter keys', () => {
    expect(complete(':note{')).toEqual([...wqlFilterKeys('note', 'find')]);
    // Scoped note heads resolve to the note plane.
    expect(complete(':journal{')).toEqual([...wqlFilterKeys('note', 'find')]);
    // Function heads keep the full fact-key list (metric included).
    expect(complete(':sum{')).toEqual([...wqlFilterKeys('', 'aggregate')]);
    expect(complete(':sum{')).toContain('metric');
  });

  it('offers structural suffixes after a complete colon head', () => {
    expect(complete(':journal ')).toEqual(['by {}', 'last', 'from', '|']);
    expect(complete(':sum ')).toEqual(['by {}', '.rollup()', 'last', 'from']);
  });

  it('carries target awareness into pipes after a colon head', () => {
    expect(complete(':note | order by ')).toEqual(['title', 'date', 'createdAt', 'type', 'sourceId', 'catalog', 'notebookId']);
    expect(complete(':segment | select ')).toContain('date');
  });
});

describe('wqlLanguage highlighting — colon heads', () => {
  it('tags colon head names and dataset references as keywords', () => {
    const doc = ':journal{effort:snatch} | :sum{metric:tis} | @today';
    const tree = wqlLanguage.parser.parse(doc);
    const classes: Record<string, string> = {};
    highlightTree(
      tree,
      {
        style: (tags) => {
          if (tags.includes(t.keyword)) return 'keyword';
          if (tags.includes(t.propertyName)) return 'property';
          if (tags.includes(t.string)) return 'string';
          return null;
        },
      },
      (from, to, cls) => {
        classes[doc.slice(from, to)] = cls;
      },
    );
    expect(classes['journal']).toBe('keyword');
    expect(classes['sum']).toBe('keyword');
    expect(classes['effort']).toBe('property');
    expect(classes['snatch']).toBe('string');
    expect(classes['metric']).toBe('property');
    expect(classes['tis']).toBe('string');
    expect(classes['today']).toBe('keyword');
  });
});

describe('wqlLanguage highlighting', () => {
  it('tags the structural roles distinctly', () => {
    const doc = 'sum:totalVolume{effort:thruster} by {week}.rollup(2w)';
    const tree = wqlLanguage.parser.parse(doc);
    const classes: Record<string, string> = {};
    highlightTree(
      tree,
      {
        style: (tags) => {
          if (tags.includes(t.keyword)) return 'keyword';
          if (tags.includes(t.variableName)) return 'variable';
          if (tags.includes(t.propertyName)) return 'property';
          if (tags.includes(t.string)) return 'string';
          if (tags.includes(t.attributeName)) return 'attribute';
          if (tags.includes(t.number)) return 'number';
          if (tags.includes(t.unit)) return 'unit';
          return null;
        },
      },
      (from, to, cls) => {
        classes[doc.slice(from, to)] = cls;
      },
    );

    expect(classes['sum']).toBe('keyword');
    expect(classes['totalVolume']).toBe('variable');
    expect(classes['effort']).toBe('property');
    expect(classes['thruster']).toBe('string');
    expect(classes['week']).toBe('attribute');
    expect(classes['by']).toBe('keyword');
    expect(classes['.rollup']).toBe('keyword');
    expect(classes['2']).toBe('number');
    expect(classes['w']).toBe('unit');
  });
});
