import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { highlightTree, tags as t } from '@lezer/highlight';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  wqlLanguage,
  wqlCompletionSource,
  resolveWqlCursorStage,
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
    expect(complete(':sess{')).toEqual([...wqlFilterKeys('session', 'find')]);
    // ':no' is ambiguous now — note and notebook are distinct planes, so
    // the union of both planes' keys is offered.
    expect(complete(':no{')).toContain('effort');
    expect(complete(':no{')).toContain('contributes');
    // The plane heads offer their own plane's keys.
    expect(complete(':tag{')).toEqual([...wqlFilterKeys('tag', 'find')]);
    expect(complete(':equipment{')).toEqual([...wqlFilterKeys('equipment', 'find')]);
    expect(complete(':page{')).toEqual([...wqlFilterKeys('page', 'find')]);
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

  it('suppresses suffixes the parser already has as singletons', () => {
    // Duplicate 'by' clause → parse conflict.
    expect(complete(':note by {session} ')).toEqual(['last', 'from', '|']);
    expect(complete('sum:tis by {session} ')).toEqual(['.rollup()', 'last', 'from']);
    // Duplicate '.rollup' clause → parse conflict.
    expect(complete('sum:tis{}.rollup(4w) ')).toEqual(['by {}', 'last', 'from']);
    // Duplicate 'window' clause (same kind or last↔from) → parse conflict.
    expect(complete(':note last 4w ')).toEqual(['by {}', '|']);
    expect(complete(':note from 2026-01-01 to 2026-03-31 ')).toEqual(['by {}', '|']);
    expect(complete('sum:tis from 2026-01-01 to 2026-03-31 ')).toEqual(['by {}', '.rollup()']);
    // Mid-typed repeat narrows to nothing instead of re-offering the duplicate.
    expect(complete(':note by {session} by')).toBeNull();
    expect(complete('sum:tis{}.rollup(4w) .rollup')).toBeNull();
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
    // Row operators stay available on a bare downstream pipe (alongside the
    // reducer/chart stage heads); the incidental ordering is not pinned.
    const pipeLabels = complete(':note | ')!;
    for (const kw of ['order by', 'select', 'limit']) expect(pipeLabels).toContain(kw);
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
    expect(complete(':note | order by ')).toEqual(['title', 'date', 'createdAt', 'type', 'sourceId', 'notebookId']);
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
      'note', 'notes', 'block', 'effort', 'session', 'segment', 'event', 'journal', 'notebook', 'notebooks', 'playground', 'page', 'tag', 'equipment', 'dashboard',
      'timeseries', 'bar', 'stacked-bar', 'table', 'list', 'donut', 'toplist', 'value', 'goal-rings', 'zone-distribution',
      '@session', '@today', '@note',
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
    expect(complete(':note | order by ')).toEqual(['title', 'date', 'createdAt', 'type', 'sourceId', 'notebookId']);
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

describe('WQL-5 stage- and binding-aware typeahead & resolveWqlCursorStage', () => {
  it('suggests metric: and fact keys inside a stage-2 reducer (:journal{} | :sum{)', () => {
    const keys = complete(':journal{} | :sum{')!;
    expect(keys).toContain('metric');
    expect(keys).toContain('equipment');
    expect(keys).toContain('effort');

    const metrics = complete(':journal{} | :sum{metric:')!;
    expect(metrics).toContain('reps');
    expect(metrics).toContain('totalVolume');
    expect(metrics).toContain('tis');
  });

  it('suggests chart heads and reducer heads after a stage-2 pipe (:journal{} | :sum{metric:reps} | :)', () => {
    const heads = complete(':journal{} | :sum{metric:reps} | :')!;
    expect(heads).toContain('bar');
    expect(heads).toContain('stacked-bar');
    expect(heads).toContain('timeseries');
    expect(heads).toContain('value');
    expect(heads).toContain('goal-rings');

    const chartParams = complete(':journal{} | :sum{metric:reps} | :bar{')!;
    expect(chartParams).toEqual(['label', 'unit', 'goal', 'limit', 'stack', 'type', 'smooth']);
  });

  it('suggests declared local bindings on show lines, assignment RHS, and formula tails', () => {
    const doc = [
      'defaults by {week} last 8w',
      'bench_notes = :journal{intent:benchmark}',
      'kb_reps = bench_notes | :sum{metric:reps}',
      'show ',
    ].join('\n');
    const showSuggestions = complete(doc)!;
    expect(showSuggestions).toEqual(['bench_notes', 'kb_reps']);

    const showChartSuggestions = complete(`${doc}kb_reps | :`)!;
    expect(showChartSuggestions).toContain('stacked-bar');
    expect(showChartSuggestions).toContain('bar');

    const formulaDoc = [
      'snatch_vol = :segment{effort:snatch} | :sum{metric:totalVolume}',
      'clean_vol = :segment{effort:clean} | :sum{metric:totalVolume}',
      'ratio = snatch_vol / ',
    ].join('\n');
    expect(complete(formulaDoc)).toEqual(['snatch_vol', 'clean_vol']);
  });

  it('suggests $thisnote, $note, and $scope when typing $ tokens', () => {
    expect(complete(':note{note:$')).toEqual(['$thisnote', '$note', '$scope']);
    expect(complete(':segment{note:$this')).toEqual(['$thisnote']);
  });

  it('resolves the active pipeline stage role (source -> reduce -> sink) as cursor moves', () => {
    const line = ':journal{effort:snatch} | :sum{metric:reps} by {equipment} | :bar{unit:reps}';
    const atSource = resolveWqlCursorStage(line, 5);
    expect(atSource.role).toBe('source');
    expect(atSource.stageIndex).toBe(0);
    expect(atSource.head).toBe(':journal');

    const atReduce = resolveWqlCursorStage(line, line.indexOf(':sum') + 2);
    expect(atReduce.role).toBe('reduce');
    expect(atReduce.stageIndex).toBe(1);
    expect(atReduce.reduceIndex).toBe(0);
    expect(atReduce.head).toBe('sum');

    const atSink = resolveWqlCursorStage(line, line.indexOf(':bar') + 2);
    expect(atSink.role).toBe('sink');
    expect(atSink.stageIndex).toBe(2);
    expect(atSink.head).toBe('bar');
  });
});

describe('wqlCompletionSource — show lines and downstream stage heads', () => {
  it('offers prior bindings, not chart heads, at a show binding slot before an existing pipe', () => {
    const doc = 'bench = :journal{}\nshow bench, | :bar{}';
    expect(complete(doc, doc.indexOf('|'))).toEqual(['bench']);
  });

  it('offers reducers/chart heads alongside row operators on a bare downstream pipe, colon applied', () => {
    const labels = complete(':segment{} | ')!;
    expect(labels).toContain('sum');
    expect(labels).toContain('bar');
    expect(labels).toContain('order by');
    expect(labels).toContain('select');
    const picked = source(new CompletionContext(EditorState.create({ doc: ':segment{} | ', extensions: [wqlLanguage] }), ':segment{} | '.length, true))!
      .options.find((o) => o.label === 'sum')!;
    expect(picked.apply).toBe(':sum{'); // bare pipe: the stage colon is written automatically
  });

  it('automatically offers reducers after pipe whitespace', () => {
    const doc = ':segment{} | ';
    const result = source(new CompletionContext(EditorState.create({ doc, extensions: [wqlLanguage] }), doc.length, false));
    expect(result?.options.map((option) => option.label)).toContain('sum');
  });

  it('offers reducers/chart heads alongside row operators after a reducer stage', () => {
    const labels = complete(':journal{} | :sum{metric:reps} | ')!;
    expect(labels).toContain('avg');
    expect(labels).toContain('timeseries');
    expect(labels).toContain('order by');
    expect(labels).toContain('limit');
  });

  it('discovers sum from a typed prefix after a pipe, not just select', () => {
    const labels = complete(':segment{} | s')!;
    expect(labels).toContain('sum');
    expect(labels).toContain('select');
  });
});
