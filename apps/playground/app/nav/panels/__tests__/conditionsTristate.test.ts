/**
 * conditionsFacets tristate regression — the include/exclude/off contract the
 * ConditionsNavPanel rows are wired to:
 *   1. include→exclude→off round trip is occurrence-exact and idempotent;
 *   2. exclusion joins one negated occurrence (engine applies negated values
 *      per value — `!key:a|b` ≡ `!key:a` AND `!key:b`);
 *   3. unrelated occurrences (other keys, other values, wildcards) and the
 *      structural clauses (by {}, window, pipes) always survive;
 *   4. the source slot (scoped head `:journal{}`) participates like a
 *      positive occurrence: include reads include, exclude re-authors it as
 *      a negated clause, off clears it.
 */

import { describe, it, expect } from 'bun:test'
import { isFindQuery, parseQuery, serialize, WQL_SOURCE_VALUES, type ParsedFindQuery } from '@bitcobblers/wod-wiki-wql'
import { filterValueState, setFacetValueState } from '../conditionsFacets'
import { conditionSectionConfig } from '../conditionsConfig'

const findOf = (q: string): ParsedFindQuery => {
  const parsed = parseQuery(q)
  if (parsed.error || !isFindQuery(parsed)) throw new Error(`fixture unparsable: ${q} (${parsed.error})`)
  return parsed
}

const tagFilters = (q: ParsedFindQuery, negate?: boolean) =>
  q.filters.filter(f => f.key === 'tags' && (negate === undefined || f.negate === negate))

const structural = (q: ParsedFindQuery) =>
  JSON.stringify({ groupBy: q.groupBy, window: q.window, pipes: q.pipes })

// `by {}` + window + presentation pipes — every edit below must keep all three.
const BASE = serialize(findOf(':notebooks{} by {tag} last 4w | order by date desc | limit 10'))

describe('setFacetValueState include→exclude→off', () => {
  it('round-trips one value with structural clauses intact', () => {
    const base = structural(findOf(BASE))
    expect(filterValueState(BASE, 'tags', 'strength')).toBe('off')

    const included = setFacetValueState(BASE, 'tags', 'strength', 'include')
    expect(filterValueState(included, 'tags', 'strength')).toBe('include')
    expect(structural(findOf(included))).toBe(base)
    expect(tagFilters(findOf(included), false)[0]!.values.map(v => v.value)).toEqual(['strength'])

    const excluded = setFacetValueState(included, 'tags', 'strength', 'exclude')
    expect(filterValueState(excluded, 'tags', 'strength')).toBe('exclude')
    expect(structural(findOf(excluded))).toBe(base)
    expect(tagFilters(findOf(excluded), false)).toHaveLength(0)
    expect(tagFilters(findOf(excluded), true)[0]!.values.map(v => v.value)).toEqual(['strength'])

    const off = setFacetValueState(excluded, 'tags', 'strength', 'off')
    expect(filterValueState(off, 'tags', 'strength')).toBe('off')
    expect(structural(findOf(off))).toBe(base)
    expect(findOf(off).filters.some(f => f.key === 'tags')).toBe(false)
  })

  it('is idempotent — a repeated state write returns the same query', () => {
    const included = setFacetValueState(BASE, 'tags', 'strength', 'include')
    expect(setFacetValueState(included, 'tags', 'strength', 'include')).toBe(included)
    const excluded = setFacetValueState(included, 'tags', 'strength', 'exclude')
    expect(setFacetValueState(excluded, 'tags', 'strength', 'exclude')).toBe(excluded)
  })

  it('exclude→include removes the negation instead of ANDing both polarities', () => {
    const excluded = setFacetValueState(BASE, 'tags', 'strength', 'exclude')
    const included = setFacetValueState(excluded, 'tags', 'strength', 'include')
    const parsed = findOf(included)
    expect(tagFilters(parsed, true)).toHaveLength(0)
    expect(tagFilters(parsed, false)[0]!.values.map(v => v.value)).toEqual(['strength'])
  })

  it('joins multiple exclusions into one negated occurrence (engine per-value AND-of-NOTs)', () => {
    let q = setFacetValueState(BASE, 'tags', 'strength', 'exclude')
    q = setFacetValueState(q, 'tags', 'endurance', 'exclude')
    const negated = tagFilters(findOf(q), true)
    expect(negated).toHaveLength(1)
    expect(negated[0]!.values.map(v => v.value).sort()).toEqual(['endurance', 'strength'])
    expect(structural(findOf(q))).toBe(structural(findOf(BASE)))
  })

  it('excluding one value keeps an unrelated positive multi-value occurrence', () => {
    const included = setFacetValueState(BASE, 'tags', 'strength', 'include')
    const joined = setFacetValueState(included, 'tags', 'endurance', 'include')
    const excluded = setFacetValueState(joined, 'tags', 'cardio', 'exclude')
    const parsed = findOf(excluded)
    expect(tagFilters(parsed, false)[0]!.values.map(v => v.value).sort()).toEqual(['endurance', 'strength'])
    expect(tagFilters(parsed, true)[0]!.values.map(v => v.value)).toEqual(['cardio'])
  })

  it('matches values exactly — `fran` and `fran*` are independent states', () => {
    const wild = setFacetValueState(BASE, 'tags', 'fran*', 'include')
    expect(filterValueState(wild, 'tags', 'fran')).toBe('off')
    const both = setFacetValueState(wild, 'tags', 'fran', 'exclude')
    const parsed = findOf(both)
    expect(tagFilters(parsed, false)[0]!.values[0]).toEqual({ value: 'fran', wildcard: true })
    expect(tagFilters(parsed, true)[0]!.values[0]).toEqual({ value: 'fran', wildcard: false })
    const off = setFacetValueState(both, 'tags', 'fran', 'off')
    const rested = findOf(off)
    expect(tagFilters(rested, true)).toHaveLength(0)
    expect(tagFilters(rested, false)[0]!.values[0]).toEqual({ value: 'fran', wildcard: true })
  })

  it('off removes duplicate occurrences of the value but not its co-values', () => {
    const dup = serialize(findOf(':note{tags:strength,tags:strength|endurance} last 4w'))
    const off = setFacetValueState(dup, 'tags', 'strength', 'off')
    expect(tagFilters(findOf(off), false)[0]!.values.map(v => v.value)).toEqual(['endurance'])
  })

  it('treats the scoped-head source slot as include; exclude re-authors it negated', () => {
    const head = serialize(findOf(':journal{} by {tag} last 4w'))
    expect(filterValueState(head, 'source', 'journal')).toBe('include')
    const excluded = setFacetValueState(head, 'source', 'journal', 'exclude')
    const parsed = findOf(excluded)
    expect(parsed.sourceScope).toBeUndefined()
    expect(parsed.filters.some(f => f.key === 'source' && !f.negate)).toBe(false)
    expect(parsed.filters.some(f => f.key === 'source' && f.negate && f.values.some(v => v.value === 'journal'))).toBe(true)
    expect(filterValueState(excluded, 'source', 'journal')).toBe('exclude')
    const off = setFacetValueState(excluded, 'source', 'journal', 'off')
    expect(findOf(off).filters.some(f => f.key === 'source')).toBe(false)
    expect(structural(findOf(off))).toBe(structural(findOf(head)))
  })

  it('returns unparsable queries untouched and reads them as off', () => {
    expect(filterValueState(':bogus{}', 'tags', 'strength')).toBe('off')
    expect(setFacetValueState(':bogus{}', 'tags', 'strength', 'include')).toBe(':bogus{}')
  })
})

describe('conditionSectionConfig', () => {
  it('always resolves; unknown keys inherit panel defaults', () => {
    expect(conditionSectionConfig('tags')).toEqual({})
    expect(conditionSectionConfig('nonsense')).toEqual({})
  })

  it('defaults only constrain closed vocabularies — values are engine values', () => {
    const source = conditionSectionConfig('source')
    expect(source.expectedValues!.map(v => v.value)).toEqual([...WQL_SOURCE_VALUES])
    expect(conditionSectionConfig('page').expectedValues!.map(v => v.value)).toEqual(['true', 'false'])
    // Open-ended facets stay result-ranked.
    expect(conditionSectionConfig('effort').expectedValues).toBeUndefined()
    expect(conditionSectionConfig('tags').enabled).not.toBe(false)
  })
})
