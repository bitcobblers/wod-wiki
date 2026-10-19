import { describe, it, expect } from 'bun:test'
import { wqlStreamHref } from './wqlLink'

describe('wqlStreamHref', () => {
  it('routes :effort queries to /efforts', () => {
    expect(wqlStreamHref(':effort{discipline:strength}')).toBe(`/efforts?q=${encodeURIComponent(':effort{discipline:strength}')}`)
  })

  it('routes :session queries to /sessions', () => {
    expect(wqlStreamHref(':session{}')).toBe(`/sessions?q=${encodeURIComponent(':session{}')}`)
  })

  it('routes a single catalog or notebook filter to the /c/:slug landing', () => {
    expect(wqlStreamHref(':feed{catalog:crossfit-girls}')).toBe(`/c/crossfit-girls?q=${encodeURIComponent(':feed{catalog:crossfit-girls}')}`)
    expect(wqlStreamHref(':note{notebook:crossfit-girls}')).toBe(`/c/crossfit-girls?q=${encodeURIComponent(':note{notebook:crossfit-girls}')}`)
  })

  it('routes unscoped feed queries to /feeds', () => {
    expect(wqlStreamHref(':feed{}')).toBe(`/feeds?q=${encodeURIComponent(':feed{}')}`)
  })

  it('routes :journal and :playground scoped note heads', () => {
    expect(wqlStreamHref(':journal{}')).toBe(`/journal?q=${encodeURIComponent(':journal{}')}`)
    expect(wqlStreamHref(':playground{}')).toBe(`/playgrounds?q=${encodeURIComponent(':playground{}')}`)
  })

  it('encodes grouped queries (spaces survive markdown link parsing only when percent-encoded)', () => {
    const href = wqlStreamHref(':feed{catalog:a} by {date}')
    expect(href).toBe(`/c/a?q=${encodeURIComponent(':feed{catalog:a} by {date}')}`)
  })

  it('returns null for non-queries, invalid WQL, and empty text', () => {
    expect(wqlStreamHref('https://example.com')).toBeNull()
    expect(wqlStreamHref('plain text')).toBeNull()
    expect(wqlStreamHref('')).toBeNull()
    expect(wqlStreamHref(':effort{')).toBeNull()
    expect(wqlStreamHref(':nonsense{}')).toBeNull()
  })
})
