/** formatDateHeader (#858) — date headers always render in English (UTC). */
import { describe, expect, it } from 'bun:test'
import { formatDateHeader } from '@/lib/dateFormat'

describe('formatDateHeader', () => {
  it('formats a YYYY-MM-DD key as an English long date', () => {
    expect(formatDateHeader('2026-01-12')).toBe('Jan 12, 2026')
    expect(formatDateHeader('2026-12-31')).toBe('Dec 31, 2026')
  })
})
