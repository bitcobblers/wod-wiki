import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'

import { ROUTE_PATTERNS } from '../lib/routes'
import { buildCanvasRoutes } from './canvasRoutes'
import { findRouteIn, findRouteWithCandidatesIn, normalizePathname } from './canvasRouteLookup'

const homeMarkdown = readFileSync(new URL('../../../../markdown/canvas/home/README.md', import.meta.url), 'utf8')

describe('home route governance', () => {
  it('keeps the bundle-owned home page out of corpus-derived routes', () => {
    expect(ROUTE_PATTERNS.home).toBe('/')
    const routes = buildCanvasRoutes({
      'markdown/canvas/home/README.md': homeMarkdown,
      'markdown/canvas/guide/demo.md': `---\ntemplate: canvas\nroute: /guide/demo\n---\n## Demo\n`,
    })
    expect(routes.map(route => route.route)).toEqual(['/guide/demo'])
  })
})

describe('canvas route normalization (#1005)', () => {
  it('normalizes pathnames correctly', () => {
    expect(normalizePathname('/guide/syntax/basics/')).toBe('/guide/syntax/basics')
    expect(normalizePathname('/guide/syntax/basics')).toBe('/guide/syntax/basics')
    expect(normalizePathname(' //guide/syntax/basics// ')).toBe('/guide/syntax/basics')
    expect(normalizePathname('/')).toBe('/')
    expect(normalizePathname('')).toBe('/')
  })

  it('resolves trailing-slash guide routes to the lesson page', () => {
    const basics = { route: '/guide/syntax/basics', page: { route: '/guide/syntax/basics' } }
    const behaviors = { route: '/guide/behaviors', page: { route: '/guide/behaviors' } }
    const routes = [basics, behaviors]

    const withSlash = findRouteIn(routes, '/guide/syntax/basics/')
    const withoutSlash = findRouteIn(routes, '/guide/syntax/basics')
    expect(withSlash).not.toBeNull()
    expect(withSlash).toBe(basics.page)
    expect(withSlash).toBe(withoutSlash)

    expect(findRouteIn(routes, '/guide/behaviors/')).toBe(behaviors.page)
    expect(findRouteIn(routes, '/guide/missing')).toBeNull()
  })

  it('resolves /p/<slug> aliases to declared guide and collection pages', () => {
    const basics = { route: '/guide/syntax/basics', page: { route: '/guide/syntax/basics' } }
    const readme = { route: '/c/dan-john', page: { route: '/c/dan-john' } }
    const routes = [basics, readme]

    // slug = declared route minus the leading slash and optional guide/ prefix
    expect(findRouteWithCandidatesIn(routes, '/p/syntax/basics')).toBe(basics.page)
    expect(findRouteWithCandidatesIn(routes, '/p/guide/syntax/basics')).toBe(basics.page)
    // collection READMEs are declared at the /c prefix and resolve directly
    expect(findRouteWithCandidatesIn(routes, '/c/dan-john')).toBe(readme.page)
    // declared routes still win directly, unknown paths stay null
    expect(findRouteWithCandidatesIn(routes, '/guide/syntax/basics')).toBe(basics.page)
    expect(findRouteWithCandidatesIn(routes, '/p/missing')).toBeNull()
  })
})
