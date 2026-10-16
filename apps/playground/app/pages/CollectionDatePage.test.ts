import { describe, expect, it } from 'bun:test'
import { entryDateKey } from './CollectionDatePage'

const NOON = 'T12:00:00Z'

describe('entryDateKey — collection date route placement', () => {
  it('places a dated seed post on its authored frontmatter day, not its import day', () => {
    const entry = { targetDate: Date.parse(`2026-10-16${NOON}`), createdAt: Date.parse(`2026-10-20${NOON}`) }
    expect(entryDateKey(entry)).toBe('2026-10-16')
  })

  it('places an undated post at its import day (createdAt fallback)', () => {
    const entry = { targetDate: Date.parse(`2026-10-20T09:30:00Z`), createdAt: Date.parse(`2026-10-20T09:30:00Z`) }
    expect(entryDateKey(entry)).toBe('2026-10-20')
  })
})
