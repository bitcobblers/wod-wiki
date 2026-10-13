import { describe, expect, it } from 'bun:test'
import { releaseUrlFor, RELEASES_URL } from './appVersion'

describe('releaseUrlFor', () => {
  it('links plain releases to their vX.Y.Z tag', () => {
    expect(releaseUrlFor('1.2.3')).toBe(`${RELEASES_URL}/tag/v1.2.3`)
  })

  it('links PR previews to the releases listing (no tag exists)', () => {
    expect(releaseUrlFor('1.2.3-pr.7')).toBe(RELEASES_URL)
  })
})
