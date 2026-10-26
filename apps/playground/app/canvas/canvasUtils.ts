import { stripFrontmatter } from '@/lib/frontmatter'
import type { CanvasSection } from './parseCanvasMarkdown'

export const STICKY_NAV_HEIGHT = 104
export const MOBILE_STICKY_TOP = 65
export const MOBILE_BREAKPOINT_PX = 1023
export const INITIAL_SOURCE_KEY = '__initial__'

export function getCanvasNoteId(route: string): string {
  return route === '/' ? 'canvas:home' : `canvas:${route.replace(/^\//, '')}`
}

export function resolveSource(dslPath: string, wodFiles: Record<string, string>): string {
  // Blank-note source used by canvas CTAs (e.g. home "New Workout Note").
  // Match must be exact; 'query:' is not a general scheme here.
  if (dslPath === 'query:new') return ''

  // wodFiles keys come from import.meta.glob anchors that shift whenever the
  // app directory moves within the monorepo, so look entries up by logical
  // path suffix instead of reconstructing a fragile '../../markdown/…' prefix.
  const bySuffix = (logical: string): string | null => {
    const wanted = `/${logical}`
    for (const k of Object.keys(wodFiles)) {
      if (k === logical || k.endsWith(wanted)) return k
    }
    return null
  }
  const read = (logical: string): string | null => {
    const k = bySuffix(logical)
    return k === null ? null : stripFrontmatter(wodFiles[k] as string)
  }

  if (dslPath.startsWith('markdown/')) {
    const hit = read(dslPath)
    if (hit !== null) return hit
  }

  let logical = dslPath
  if (dslPath.startsWith('wods/examples/')) {
    logical = 'markdown/canvas/' + dslPath.replace(/^wods\/examples\//, '')
  } else if (dslPath.startsWith('wods/')) {
    logical = 'markdown/canvas/' + dslPath.replace(/^wods\//, '')
  } else if (dslPath.startsWith('canvas/')) {
    logical = 'markdown/canvas/' + dslPath.replace(/^canvas\//, '')
  } else {
    const canvasHit = read('markdown/canvas/' + dslPath)
    if (canvasHit !== null) return canvasHit

    logical = 'markdown/' + dslPath
  }
  const hit = read(logical)
  return hit ?? `# Source not found\n\nPath: \`${dslPath}\`\nResolved: \`${logical}\``
}
/** True when a section declares its own example(s) or a command with at least one step. */
export function sectionOwnsContent(section: CanvasSection): boolean {
  return (section.examples ?? []).length > 0 || section.commands.some((cmd) => cmd.pipeline.length > 0)
}

/**
 * Maps every content section (in document order) to whichever section
 * *owns* the code sample it should be showing: itself, if it declares an
 * example/command with real steps, otherwise the nearest earlier section
 * that does — or `null` if none precede it (meaning the panel's original
 * `view` source applies).
 *
 * Resolving ownership from document position — rather than "whichever
 * section's side effect last fired" — is what lets scrolling back UP
 * correctly restore earlier content instead of leaving it stuck on
 * whatever a later section set on the way down.
 */
export function resolveContentOwners(contentSections: CanvasSection[]): Map<string, CanvasSection | null> {
  const map = new Map<string, CanvasSection | null>()
  let owner: CanvasSection | null = null
  for (const section of contentSections) {
    if (sectionOwnsContent(section)) owner = section
    map.set(section.id, owner)
  }
  return map
}
