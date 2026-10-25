/**
 * WQL grammar tests — the Lezer grammar (src/grammar/wql.grammar) behind the
 * Wod Query Language (CONTEXT.md glossary).
 *
 * Defends the observable contracts:
 *   1. The full WQL surface parses without error nodes:
 *      aggregators, dotted metric namespaces, negated/wildcard tag filters,
 *      group-by dimensions, day/week rollups.
 *   2. Words that collide with structural literals still parse — Lezer
 *      resolves tokens contextually (metric `session` in `count:session`,
 *      `d`/`w`-prefixed words like `week`/`walking`, a dimension named `by`).
 *   3. Malformed input recovers: the parser never throws, always returns a
 *      tree, and marks the damage with error nodes so parseQuery can reject.
 */
import { describe, it, expect } from 'bun:test';
import type { SyntaxNode, Tree } from '@lezer/common';
import { wqlParser as parser } from '@bitcobblers/wod-wiki-engine';

const parse = (source: string): Tree => parser.parse(source);

function errorSpans(tree: Tree, source: string): string[] {
  const spans: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.type.isError) spans.push(source.slice(node.from, node.to));
    },
  });
  return spans;
}

/** Recovered subtree text, or null when the node is absent. */
function text(source: string, node: SyntaxNode | null | undefined): string | null {
  return node ? source.slice(node.from, node.to) : null;
}

/** The mapper's walk (queryStageNode in packages/wql/src/wql.ts):
 *  a single query wraps its stage as Query → Single → Stage. */
function queryStage(top: SyntaxNode): SyntaxNode | null {
  return top.getChild('Single')?.getChild('Stage') ?? top.getChild('Stage') ?? null;
}

function filterValues(source: string): (string | null)[] {
  const filters = queryStage(parse(source).topNode)?.getChild('Filters');
  return filters?.getChildren('Filter').flatMap(filter =>
    filter.getChildren('TagValue').flatMap(tag =>
      tag.getChildren('Value').map(value => text(source, value)),
    ),
  ) ?? [];
}

describe('wql.grammar', () => {
  describe('full surface', () => {
    const valid = [
      'sum:totalVolume{discipline:strength,!effort:burpee} by {week,effort}.rollup(1w)',
      'max:tis{effort:back*}',
      'avg:tis{}.rollup(7d)',
      'count:totalReps',
      'avg:wod.rep_rate{effort:thruster, note:friday-benchmark} by {round}',
      'avg:back-squat.reps{} by {day, week, session, round}',
      'last:wod.time.total{note:friday-benchmark} by {session}',
      'avg:wod.load.acwr{}.rollup(1d)',
      'sum:wod.session_load{} by {intensity}.rollup(1w)',
      // Whitespace-tolerant authoring style.
      'sum:totalVolume{discipline:strength, !effort:burpee} by {week, effort} .rollup(1w)',
      // Multi-value tag filters.
      'sum:totalVolume{note:a|b|c}',
      'max:tis{effort:back*|squat*}',
      'avg:tis{effort:thruster|burpee,note:monday} by {week}',
    ];

    for (const source of valid) {
      it(`parses cleanly: ${source}`, () => {
        expect(errorSpans(parse(source), source)).toEqual([]);
      });
    }

    it('exposes the structural nodes the AST mapper walks', () => {
      const source = 'sum:totalVolume{discipline:strength,!effort:burpee} by {week,effort}.rollup(1w)';
      const tree = parse(source);
      // A single query wraps its stage: GroupBy/Rollup are siblings of Stage
      // under Single, not children of Query.
      // Node access along the mapper's walk (queryStageNode in src/wql.ts).
      const single = tree.topNode.getChild('Single');
      const stage = queryStage(tree.topNode);
      const head = stage?.getChild('Head');
      expect(head?.name).toBe('Head');
      expect(text(source, head?.getChild('Aggregator'))).toBe('sum');
      expect(text(source, head?.getChild('Metric'))).toBe('totalVolume');
      expect(text(source, single?.getChild('GroupBy')?.getChild('Dimension'))).toBe('week');
      // `.rollup(1w)` splits lexically into the magnitude and the unit word.
      const rollup = single?.getChild('Rollup');
      expect(text(source, rollup?.getChild('Int'))).toBe('1');
      expect(text(source, rollup?.getChild('Word'))).toBe('w');
    });

    it('exposes repeated TagValue words for multi-value filters', () => {
      expect(filterValues('sum:totalVolume{note:a|b|c}')).toEqual(['a', 'b', 'c']);
      expect(filterValues('max:tis{effort:back*|squat*}')).toEqual(['back*', 'squat*']);
      expect(filterValues('sum:totalVolume{!effort:thruster|burpee}')).toEqual(['thruster', 'burpee']);
      const filter = queryStage(parse('sum:totalVolume{!effort:thruster|burpee}').topNode)
        ?.getChild('Filters')?.getChild('Filter');
      expect(filter?.getChild('Negate')).not.toBeNull();
    });
  });

  describe('contextual token resolution', () => {
    const colliding = [
      // A metric named like a virtual dimension.
      'count:session',
      // Metric segments starting with rollup units (d/w).
      'sum:distance{effort:walking}',
      'avg:delta.reps by {week,day}',
      // A dimension named like the `by` keyword.
      'sum:x by {by}',
      // Aggregator-named metrics.
      'count:count',
    ];

    for (const source of colliding) {
      it(`parses cleanly: ${source}`, () => {
        expect(errorSpans(parse(source), source)).toEqual([]);
      });
    }
  });

  describe('error recovery', () => {
    it('recovers from garbage with error nodes, never throwing', () => {
      const source = 'not a query';
      const tree = parse(source);
      expect(tree.topNode.name).toBe('Query');
      expect(errorSpans(tree, source).length).toBeGreaterThan(0);
      // Recovery salvages the leading word as a legacy `word:` head; only the
      // stray trailing words are marked erroneous.
      const head = queryStage(tree.topNode)?.getChild('Head');
      expect(text(source, head?.getChild('Aggregator'))).toBe('not');
      expect(errorSpans(tree, source)).toEqual(['a', 'query']);
    });

    it('marks an empty document as erroneous', () => {
      expect(errorSpans(parse(''), '').length).toBeGreaterThan(0);
    });

    it('keeps valid subtrees around the damage', () => {
      const source = 'sum:tis{effort:thruster, !!!} by {week}';
      const tree = parse(source);
      expect(errorSpans(tree, source).length).toBeGreaterThan(0);
      // The head and group-by survive intact around the broken filter,
      // carrying their original text.
      const stage = queryStage(tree.topNode);
      expect(text(source, stage?.getChild('Head')?.getChild('Metric'))).toBe('tis');
      expect(text(source, tree.topNode.getChild('Single')?.getChild('GroupBy')?.getChild('Dimension'))).toBe('week');
    });

    it('rejects an unterminated filter list without losing the head', () => {
      const source = 'sum:tis{effort:thruster';
      const tree = parse(source);
      expect(errorSpans(tree, source).length).toBeGreaterThan(0);
      const head = queryStage(tree.topNode)?.getChild('Head');
      expect(text(source, head?.getChild('Aggregator'))).toBe('sum');
      expect(text(source, head?.getChild('Metric'))).toBe('tis');
    });
  });
});
