import { describe, expect, it } from 'vitest';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import { astToPills, editQueryClause, pivotQuery, resolveQueryDraft } from '../src/composer/queryAst';

function edit(query: string, type: string, value: string | null, occurrence = 0) {
  const clauses = astToPills(parseQuery(query));
  expect(clauses).not.toBeNull();
  const clause = clauses?.filter((item) => item.type === type)[occurrence];
  if (!clause) throw new Error(`Missing ${type} occurrence ${occurrence}`);
  return editQueryClause(query, clause, value);
}

function semantics(query: string) {
  const { raw: _raw, advisories: _advisories, ...ast } = parseQuery(query);
  return ast;
}

describe('lossless targeted WQL edits', () => {
  it('retains grouping, unit and every pipe after changing only the window', () => {
    const query = ':segment{effort:snatch} by {effort} in lb | select resistance in lb, effort | order by resistance desc, effort | limit 5 offset 2';
    const result = edit(query, 'time', 'last 3w');
    expect(result.valid).toBe(true);
    expect(semantics(result.wql)).toEqual({ ...semantics(query), window: { kind: 'relative', size: 3, unit: 'w' } });
  });

  it('edits a repeated-key occurrence without merging its sibling', () => {
    const query = ':note{tags:strength,tags:benchmark}';
    const result = edit(query, 'tag', 'competition', 1);
    expect(result.ast.filters).toEqual([
      { key: 'tags', negate: false, values: [{ value: 'strength', wildcard: false }] },
      { key: 'tags', negate: false, values: [{ value: 'competition', wildcard: false }] },
    ]);
  });

  it('storage scope does not change target or unrelated filters', () => {
    const query = ':block{source:journal,text:snatch}';
    const result = edit(query, 'source', 'notebooks|guides');
    expect(result.ast).toMatchObject({ family: 'find', target: 'block', filters: [
      { key: 'source', values: [{ value: 'notebooks', wildcard: false }, { value: 'guides', wildcard: false }] },
      { key: 'text', values: [{ value: 'snatch', wildcard: false }] },
    ] });
  });

  it('retains negation, wildcard and civil range during an unrelated edit', () => {
    const query = ':note{!tags:back*} from 2026-01-01 to 2026-02-01';
    const result = edit(query, 'tag', 'front*');
    expect(result.ast).toMatchObject({ window: { kind: 'range', start: '2026-01-01', end: '2026-02-01' }, filters: [{ negate: true, values: [{ value: 'front', wildcard: true }] }] });
  });

  it('preserves exact untouched and invalid text', () => {
    for (const query of [':segment{effort:snatch}  by {effort} in lb | offset 2', ':note{tags:']) {
      expect(resolveQueryDraft(query).wql).toBe(query);
    }
    expect(resolveQueryDraft(':note', ':note{tags:').valid).toBe(false);
  });

  it('repeated free-search edits replace the intended text occurrence only', () => {
    const first = resolveQueryDraft(':note{tags:strength}', 'snatch');
    const second = resolveQueryDraft(first.wql, 'clean');
    expect(second.ast.filters).toEqual([
      { key: 'tags', negate: false, values: [{ value: 'strength', wildcard: false }] },
      { key: 'text', negate: false, values: [{ value: 'clean', wildcard: false }] },
    ]);
  });

  it('keeps quoted phrase typing guided and preserves the search scope', () => {
    const scope = ':note{source:journal,tags:strength} last 4w';
    const phrase = '"workout in the park"';
    for (let end = 1; end <= phrase.length; end++) {
      const result = resolveQueryDraft(scope, phrase.slice(0, end));
      expect(result.valid).toBe(true);
      expect(astToPills(result.ast)).not.toBeNull();
    }
    expect(resolveQueryDraft(scope, phrase).ast).toMatchObject({
      window: { kind: 'relative', size: 4, unit: 'w' },
      filters: [
        { key: 'source', values: [{ value: 'journal', wildcard: false }] },
        { key: 'tags', values: [{ value: 'strength', wildcard: false }] },
        { key: 'text', values: [{ value: 'workout in the park', wildcard: false }] },
      ],
    });
  });

  it('rejects quote-containing literals instead of changing their meaning', () => {
    const query = ':note{text:snatch}';
    const result = edit(query, 'text', 'a"quoted" value');
    expect(result.valid).toBe(false);
    expect(result.wql).toBe(query);
  });

  it('reports unsupported target suffixes and preserves compatible joins', () => {
    const query = ':note{tags:strength} by {week} last 2w where sum:tis{} > 0';
    const block = pivotQuery(query, 'target', 'block');
    expect(block.removed).toEqual([]);
    expect(block.draft.ast).toMatchObject({ target: 'block', join: parseQuery(query).join, groupBy: ['week'] });
    const effort = pivotQuery(query, 'target', 'effort');
    expect(effort.draft.valid).toBe(true);
    expect(effort.draft.ast.window).toBeUndefined();
    expect(effort.draft.ast.join).toBeUndefined();
    expect(effort.draft.ast.groupBy).toEqual(['week']);
  });

  it('parser-recognized fragments change only their field', () => {
    const query = ':segment{effort:snatch} by {effort} in lb | limit 5';
    expect(resolveQueryDraft(query, 'last 7d').ast).toMatchObject({ window: { kind: 'relative', size: 7, unit: 'd' }, groupBy: ['effort'], displayUnit: 'lb', pipes: { limit: 5 } });
    expect(resolveQueryDraft(query, 'effort:clean').ast.filters).toEqual([{ key: 'effort', negate: false, values: [{ value: 'clean', wildcard: false }] }]);
  });
});
