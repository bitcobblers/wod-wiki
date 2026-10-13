import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppVersion } from '../../src/components/atoms/AppVersion'

describe('AppVersion', () => {
  it('renders a plain release version as a single line without a link', () => {
    const html = renderToStaticMarkup(<AppVersion version="0.13.1983" />)

    expect(html).toContain('v0.13.1983')
    expect(html).not.toContain('<a')
  })

  it('splits preview versions and links pr.N to the pull request', () => {
    const html = renderToStaticMarkup(<AppVersion version="0.13.211-pr.724" />)

    expect(html).toContain('v0.13.211')
    expect(html).toContain('href="https://github.com/bitcobblers/wod-wiki/pull/724"')
    expect(html).toContain('pr.724')
  })

  it('does not link non-numeric pr suffixes', () => {
    const html = renderToStaticMarkup(<AppVersion version="0.13.211-pr.manual" />)

    expect(html).toContain('v0.13.211-pr.manual')
    expect(html).not.toContain('<a')
  })
})
