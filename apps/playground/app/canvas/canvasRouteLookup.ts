/**
 * canvasRouteLookup — the glob-free seam for canvas route resolution.
 *
 * Split out of canvasRoutes.ts so unit tests can exercise the lookup logic
 * under bun: canvasRoutes.ts depends on Vite's `import.meta.glob` (markdown
 * baked in at build time), which does not exist outside Vite. This module is
 * pure — routes go in, page comes out — and owns the pathname normalization
 * that makes trailing-slash deep links resolve (#1005): GitHub Pages
 * 301-redirects every hard load to a trailing slash, so lookups must not
 * depend on the exact spelling.
 */

export interface CanvasRouteRef {
  route: string
  page: unknown
}

/** Trim, ensure leading slash, collapse duplicate slashes, drop trailing slash (root `/` keeps it). */
export function normalizePathname(pathname: string): string {
  if (!pathname) return '/'
  let normalized = pathname.trim()
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }
  normalized = normalized.replace(/\/+/g, '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

/** Exact lookup against normalized route keys. */
export function findRouteIn<T>(
  routes: ReadonlyArray<{ route: string; page: T }>,
  pathname: string,
): T | null {
  const normalized = normalizePathname(pathname)
  for (const r of routes) {
    if (r.route === normalized) return r.page
  }
  return null
}

/**
 * Candidate keys a pathname may resolve to. Under the ticket-09 scheme the
 * canvas page's declared route IS its address (guides declare
 * `/page/guide-*`), so the only candidate is the normalized pathname itself.
 * The retired `/p/<slug>` alias no longer resolves.
 */
export function lookupCandidates(pathname: string): string[] {
  return [normalizePathname(pathname)]
}

/** First route whose key matches any lookup candidate of the pathname. */
export function findRouteWithCandidatesIn<T>(
  routes: ReadonlyArray<{ route: string; page: T }>,
  pathname: string,
): T | null {
  for (const candidate of lookupCandidates(pathname)) {
    const hit = findRouteIn(routes, candidate)
    if (hit !== null) return hit
  }
  return null
}
