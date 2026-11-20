import { describe, expect, it } from 'vitest';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import { astToPills } from '../src/composer/queryAst';
import {
  buildAddableFilterGroups,
  buildScopeZones,
  formatHumanQuerySummary,
  getClauseSupportError,
  getClauseZone,
} from '../src/composer/queryZones';

describe('queryZones', () => {
  it('maps clause types to canonical WHAT / WHERE / WHEN / GROUP zones', () => {
    expect(getClauseZone('target')).toBe('what');
    expect(getClauseZone('agg')).toBe('what');
    expect(getClauseZone('metric')).toBe('what');
    expect(getClauseZone('tag')).toBe('where');
    expect(getClauseZone('effort')).toBe('where');
    expect(getClauseZone('time')).toBe('when');
    expect(getClauseZone('groupby')).toBe('group');
    expect(getClauseZone('rollup')).toBe('group');
    expect(getClauseZone('unit')).toBe('group');
  });

  it('flags unsupported filters for the current target via capabilities', () => {
    const tagAst = parseQuery(':tag{effort:snatch,tags:crossfit}');
    const pills = astToPills(tagAst)!;
    const effortPill = pills.find((p) => p.type === 'effort')!;
    const tagPill = pills.find((p) => p.type === 'tag')!;
    expect(getClauseSupportError(effortPill, tagAst)).toMatch(/ignored on :tag/);
    expect(getClauseSupportError(tagPill, tagAst)).toBeUndefined();

    const effortAst = parseQuery(':effort{source:journal,effort:snatch}');
    const effortPills = astToPills(effortAst)!;
    const sourcePill = effortPills.find((p) => p.type === 'source')!;
    expect(getClauseSupportError(sourcePill, effortAst)).toMatch(/ignored on :effort/);
  });

  it('builds 4 zones with explicit implicit time/groupby slots and ignored flags', () => {
    const ast = parseQuery(':tag{effort:snatch,tags:crossfit}');
    const pills = astToPills(ast)!.filter((p) => p.type !== 'time' && p.type !== 'groupby');
    const allowed = new Set(['target', 'tag', 'effort', 'time', 'groupby']);
    const zones = buildScopeZones(pills, ast, allowed, new Set());
    expect(zones.map((z) => z.zone)).toEqual(['what', 'where', 'when', 'group']);

    const whenZone = zones.find((z) => z.zone === 'when')!;
    expect(whenZone.implicitSlots).toHaveLength(1);
    expect(whenZone.implicitSlots[0]?.placeholder).toBe('Any time');

    const groupZone = zones.find((z) => z.zone === 'group')!;
    expect(groupZone.implicitSlots).toHaveLength(1);
    expect(groupZone.implicitSlots[0]?.placeholder).toBe('No grouping');

    const whereZone = zones.find((z) => z.zone === 'where')!;
    const invalidEffort = whereZone.clauses.find((c) => c.type === 'effort');
    expect(invalidEffort?.invalid).toBe(true);
    expect(invalidEffort?.invalidReason).toMatch(/ignored on :tag/);
  });

  it('groups addable filter catalog and filters by search needle', () => {
    const all = buildAddableFilterGroups(['notebook', 'tag', 'effort', 'time', 'groupby'], '');
    expect(all.map((g) => g.group)).toEqual(['Scope', 'Training', 'Shape']);

    const filtered = buildAddableFilterGroups(['notebook', 'tag', 'effort', 'time', 'groupby'], 'eff');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.group).toBe('Training');
    expect(filtered[0]?.items.map((i) => i.type)).toEqual(['effort']);
  });

  it('formats concise human summaries for find, aggregate, wildcard, and empty drafts', () => {
    expect(formatHumanQuerySummary('', 'Search…')).toBe('Search…');
    expect(formatHumanQuerySummary(':note{notebook:*}')).toBe('All notebooks');
    expect(formatHumanQuerySummary(':effort{tags:crossfit} last 4w')).toBe('Efforts · crossfit · Last 4w');
    expect(formatHumanQuerySummary('sum:totalVolume{effort:snatch} by {week}')).toBe(
      'SUM totalVolume · snatch · By week',
    );
  });
});
