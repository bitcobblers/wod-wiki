/**
 * conditionsFacets result-identity regression — a target's own result rows
 * are never offered as a filter catalog on their library page:
 *   1. canonical planes map to their identity key (`note`, `effort`);
 *      block/session planes have none (their note/block/result keys are
 *      cross-target relations and stay);
 *   2. notebook/journal/playground heads parse to target 'note' + an
 *      injected source scope, so the note plane covers all three pages —
 *      the per-result Note identity (`:notebooks{} by {tag}` listing every
 *      notebook row) must read as suppressed;
 *   3. suppression is occurrence-aware: an explicitly authored identity
 *      filter keeps its section so tri-state rows stay removable.
 */

import { describe, it, expect } from 'bun:test'
import { isFindQuery, parseQuery, type ParsedFindQuery } from '@bitcobblers/wod-wiki-wql'
import { occurrencesForKey, resultIdentityKey, toggleGroupDimension } from '../conditionsFacets'

const findOf = (q: string): ParsedFindQuery => {
  const parsed = parseQuery(q)
  if (parsed.error || !isFindQuery(parsed)) throw new Error(`fixture unparsable: ${q} (${parsed.error})`)
  return parsed
}

describe('resultIdentityKey target-aware suppression', () => {
  it('maps canonical planes to their own identity key only', () => {
    expect(resultIdentityKey('note')).toBe('note')
    expect(resultIdentityKey('effort')).toBe('effort')
    expect(resultIdentityKey('block')).toBeNull()
    expect(resultIdentityKey('session')).toBeNull()
  })

  it('suppresses the note catalog on scoped note pages unless authored', () => {
    for (const q of [':notebooks{} by {tag}', ':journal{}', ':note{source:playground}']) {
      const parsed = findOf(q)
      expect(parsed.target).toBe('note')
      expect(occurrencesForKey(parsed, resultIdentityKey(parsed.target)!)).toHaveLength(0)
    }
    expect(occurrencesForKey(findOf(':note{note:abc}'), 'note').length).toBeGreaterThan(0)
  })
})
