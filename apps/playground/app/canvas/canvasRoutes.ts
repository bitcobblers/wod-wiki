/**
 * Canvas Routes — derived from the seeded corpus
 * (docs/prototypes/seed-data-unification.md § Module 3).
 *
 * Canvas pages (markdown/canvas/**) are parsed from the corpus content file
 * map into typed CanvasRoute objects. The derivation is pure; the
 * `useCanvasRoutes()` hook binds it to the reactive corpus snapshot,
 * so routes appear once the corpus lands and refresh when a newer feed is
 * imported (BroadcastChannel('wodwiki.seed')).
 */

import { useMemo } from 'react'
import { parseCanvasMarkdown, type ParsedCanvasPage } from './parseCanvasMarkdown'
import { findRouteWithCandidatesIn, normalizePathname } from './canvasRouteLookup'
import { ROUTE_PATTERNS } from '../lib/routes'
import { useSeedContent, type SeedContentFiles } from '@/services/content/seedContent'
export { getSectionProse } from './parseCanvasMarkdown'
export { normalizePathname } from './canvasRouteLookup'

export interface CanvasRoute {
  route: string
  page: ParsedCanvasPage
}

/** Pure derivation over the seeded corpus (canvas pages). */
export function buildCanvasRoutes(files: SeedContentFiles): CanvasRoute[] {
  const canvas: CanvasRoute[] = []
  for (const [path, raw] of Object.entries(files)) {
    const canvasMatch = path.match(/^markdown\/canvas\/(.+\.md)$/)
    if (canvasMatch) {
      const page = parseCanvasMarkdown(raw)
      // `/` is bundle-owned (homeSlice); every other canvas page remains
      // corpus-derived. Keeping one route owner also removes the corpus gate
      // from the home route.
      if (page && page.route !== ROUTE_PATTERNS.home) canvas.push({ route: page.route, page })
      continue
    }
  }
  return canvas
}

/** Exact lookup against normalized route keys — rebranded prefixes absorbed. */
export function findCanvasPageIn(routes: CanvasRoute[], pathname: string): ParsedCanvasPage | null {
  return findRouteWithCandidatesIn(routes, pathname)
}

/** Reactive route table — empty until the seeded corpus lands. */
export function useCanvasRoutes(): CanvasRoute[] {
  const files = useSeedContent()
  return useMemo(() => (files ? buildCanvasRoutes(files) : []), [files])
}

/** Reactive page lookup for a pathname — null until the corpus lands. */
export function useFindCanvasPage(pathname: string): ParsedCanvasPage | null {
  const routes = useCanvasRoutes()
  return useMemo(() => findCanvasPageIn(routes, pathname), [routes, pathname])
}
