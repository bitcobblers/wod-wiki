/**
 * groupByOptions — the shared grouping-dimension vocabulary, the favorites
 * resolution and the group sort order.
 *
 * Asserts:
 *   1. The favorites list is a PRIORITY list — it reorders the offered
 *      dimensions without hiding any the target supports.
 *   2. An absent favorites list offers the target's dimensions in canonical
 *      order; an explicitly empty one offers the same (no favorite to fall
 *      back to).
 *   3. The fallback arrangement dimension is the first favorite the target
 *      supports, else the level default.
 *   4. Normalization keeps canonical ids only, de-duplicated, in priority
 *      order, and reports the rest.
 *   5. The sort order is deterministic for every dimension — no dimension
 *      falls back to the executor's row order.
 */
import { describe, expect, it } from 'bun:test'
import {
  GROUP_BY_DIMENSIONS,
  GROUP_BY_DIMENSION_IDS,
  groupSortRule,
  normalizeGroupByFavorites,
  resolveFallbackGroupDimension,
  resolveGroupByOptions,
  sortGroupBuckets,
} from './groupByOptions'

describe('groupByOptions — vocabulary', () => {
  it('offers one canonical list of dimensions', () => {
    expect(GROUP_BY_DIMENSIONS.map(d => d.id)).toEqual([
      'date',
      'week',
      'month',
      'year',
      'tag',
      'type',
      'discipline',
      'source',
      'origin',
    ])
    expect(GROUP_BY_DIMENSION_IDS).toEqual(GROUP_BY_DIMENSIONS.map(d => d.id))
  })
})

describe('groupByOptions — resolveGroupByOptions', () => {
  const supported = ['date', 'week', 'month', 'year', 'tag', 'type', 'discipline', 'source', 'origin']

  it('offers the target dimensions in canonical order when nothing is stored', () => {
    expect(resolveGroupByOptions(supported).map(d => d.id)).toEqual(supported)
  })

  it('offers the same dimensions when the stored list is explicitly empty', () => {
    expect(resolveGroupByOptions(supported, []).map(d => d.id)).toEqual(supported)
  })

  it('puts the favorites first, in the stored priority order', () => {
    const resolved = resolveGroupByOptions(supported, ['week', 'discipline'])
    expect(resolved.map(d => d.id).slice(0, 2)).toEqual(['week', 'discipline'])
  })

  it('never hides a dimension the target supports', () => {
    const resolved = resolveGroupByOptions(supported, ['week'])
    expect(resolved.map(d => d.id)).toHaveLength(supported.length)
    expect(resolved.map(d => d.id)).toContain('date')
    expect(resolved.map(d => d.id)).toContain('origin')
  })

  it('drops a favorite the target cannot group by — it is not this target’s business', () => {
    const resolved = resolveGroupByOptions(['date', 'week'], ['origin', 'week'])
    expect(resolved.map(d => d.id)).toEqual(['week', 'date'])
  })
})

describe('groupByOptions — resolveFallbackGroupDimension', () => {
  it('falls back to the level default when nothing is stored', () => {
    expect(resolveFallbackGroupDimension(undefined, ['date', 'week'], 'date')).toBe('date')
  })

  it('uses the first stored favorite the target supports', () => {
    expect(resolveFallbackGroupDimension(['week', 'date'], ['date', 'week'], 'date')).toBe('week')
  })

  it('skips a favorite the target cannot group by', () => {
    expect(resolveFallbackGroupDimension(['origin', 'week'], ['date', 'week'], 'date')).toBe('week')
  })

  it('keeps the level default when the stored list is empty', () => {
    expect(resolveFallbackGroupDimension([], ['date', 'week'], 'date')).toBe('date')
  })
})

describe('groupByOptions — normalizeGroupByFavorites', () => {
  it('keeps canonical ids only, de-duplicated, in priority order', () => {
    expect(normalizeGroupByFavorites(['week', 'date', 'week'])).toEqual({
      options: ['week', 'date'],
      invalid: [],
    })
  })

  it('reports ids outside the vocabulary instead of dropping them silently', () => {
    expect(normalizeGroupByFavorites(['week', 'nonsense', 'rows'])).toEqual({
      options: ['week'],
      invalid: ['nonsense', 'rows'],
    })
  })

  it('treats an absent list as no favorites', () => {
    expect(normalizeGroupByFavorites(undefined)).toEqual({ options: [], invalid: [] })
  })
})

describe('groupByOptions — sort order', () => {
  it('sorts the date family newest first', () => {
    const buckets: [string, number][] = [['2026-01-01', 1], ['2026-09-04', 2], ['2026-05-05', 3]]
    expect(sortGroupBuckets(buckets, groupSortRule('date')).map(([k]) => k)).toEqual([
      '2026-09-04',
      '2026-05-05',
      '2026-01-01',
    ])
  })

  it('sorts by the fixed priority before alphabetical', () => {
    const buckets: [string, number][] = [['Running', 1], ['General', 2], ['Strength', 3]]
    const sorted = sortGroupBuckets(buckets, groupSortRule('discipline'), {
      priority: ['Strength', 'Gymnastics', 'Cardio', 'Running'],
    })
    expect(sorted.map(([k]) => k)).toEqual(['Strength', 'Running', 'General'])
  })

  it('sorts the plain dimensions alphabetically', () => {
    const buckets: [string, number][] = [['Other', 1], ['Feeds', 2], ['Journal', 3]]
    expect(sortGroupBuckets(buckets, groupSortRule('source')).map(([k]) => k)).toEqual([
      'Feeds',
      'Journal',
      'Other',
    ])
  })

  it('sinks the empty-value bucket to the end', () => {
    const buckets: [string, number][] = [['Unassigned', 1], ['strength', 2]]
    expect(
      sortGroupBuckets(buckets, groupSortRule('domain'), { sink: 'Unassigned' }).map(([k]) => k),
    ).toEqual(['strength', 'Unassigned'])
  })

  it('gives every dimension a deterministic rule — none falls back to row order', () => {
    for (const dim of GROUP_BY_DIMENSION_IDS) {
      expect(groupSortRule(dim)).toBeTruthy()
    }
  })
})
