import { describe, it, expect } from 'bun:test'
import { wqlStreamHref } from './wqlLink'

describe('wqlStreamHref', () => {
  it('routes :effort queries to /efforts', () => {
    expect(wqlStreamHref(':effort{discipline:strength}')).toBe(`/efforts?q=${encodeURIComponent(':effort{discipline:strength}')}`)
  })

  it('routes :session queries to /sessions', () => {
    expect(wqlStreamHref(':session{}')).toBe(`/sessions?q=${encodeURIComponent(':session{}')}`)
  })

  it('routes a single notebook filter to the /notebook/:slug landing', () => {
    expect(wqlStreamHref(':notebooks{notebook:crossfit-girls}')).toBe(`/notebook/crossfit-girls?q=${encodeURIComponent(':notebooks{notebook:crossfit-girls}')}`)
    expect(wqlStreamHref(':note{notebook:crossfit-girls}')).toBe(`/notebook/crossfit-girls?q=${encodeURIComponent(':note{notebook:crossfit-girls}')}`)
  })

  it('routes unscoped corpus queries to /notes', () => {
    expect(wqlStreamHref(':note{}')).toBe(`/notes?q=${encodeURIComponent(':note{}')}`)
  })

  it('routes the notebook plane to /notebooks', () => {
    expect(wqlStreamHref(':notebook{}')).toBe(`/notebooks?q=${encodeURIComponent(':notebook{}')}`)
  })

  it('routes :journal and :playground scoped note heads', () => {
    expect(wqlStreamHref(':journal{}')).toBe(`/journal?q=${encodeURIComponent(':journal{}')}`)
    expect(wqlStreamHref(':playground{}')).toBe(`/playgrounds?q=${encodeURIComponent(':playground{}')}`)
  })

  it('encodes grouped queries (spaces survive markdown link parsing only when percent-encoded)', () => {
    const href = wqlStreamHref(':notebooks{notebook:a} by {date}')
    expect(href).toBe(`/notebook/a?q=${encodeURIComponent(':notebooks{notebook:a} by {date}')}`)
  })

  it('returns null for non-queries, invalid WQL, and empty text', () => {
    expect(wqlStreamHref('https://example.com')).toBeNull()
    expect(wqlStreamHref('plain text')).toBeNull()
    expect(wqlStreamHref('')).toBeNull()
    expect(wqlStreamHref(':effort{')).toBeNull()
    expect(wqlStreamHref(':nonsense{}')).toBeNull()
  })
})
