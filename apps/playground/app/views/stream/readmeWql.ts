/**
 * readmeWql — WQL embeds for notebook README pages.
 *
 * Supports both:
 *   1. Standard ```query fences (YAML `QueryBlockObject` or 1-line WQL), and
 *   2. Legacy `[heading](:query)!` bang-links.
 *
 * Any valid query embed on the README injects live query results in place and
 * suppresses the notebook's default stream below.
 */
import { parseQuery, parseQueryBlock } from '@bitcobblers/wod-wiki-engine'
import { migrateLegacyStoredWql } from '../../lib/routeWqlConfig'

export type ReadmeSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'query'; query: string; heading: string }

// Matches either a fenced ```query[...] block or a `[heading](:query)!` bang-link.
const EMBED_OR_FENCE_RE = /(?:^|\n)```(query[^\n]*)\n([\s\S]*?)\n```|\[([^\]]*)\]\((:[^)]*)\)!/g

function decodeQuery(text: string): string {
  const trimmed = text.trim()
  const decoded = (() => {
    try {
      return decodeURIComponent(trimmed)
    } catch {
      return trimmed
    }
  })()
  return migrateLegacyStoredWql(decoded)
}

function isWqlQuery(text: string): boolean {
  const query = decodeQuery(text)
  return query.startsWith(':') && !parseQuery(query).error
}

export function splitReadmeQueries(prose: string): ReadmeSegment[] {
  const segments: ReadmeSegment[] = []
  let cursor = 0
  for (const match of prose.matchAll(EMBED_OR_FENCE_RE)) {
    const rawMatch = match[0]
    const hasLeadingNewline = rawMatch.startsWith('\n')
    const index = (match.index ?? 0) + (hasLeadingNewline ? 1 : 0)
    const matchLen = rawMatch.length - (hasLeadingNewline ? 1 : 0)

    if (match[1] !== undefined && match[2] !== undefined) {
      const obj = parseQueryBlock(match[2], { fenceTag: match[1] })
      const candidate = obj.query ? migrateLegacyStoredWql(obj.query.trim()) : ''
      if (!candidate || !candidate.startsWith(':') || parseQuery(candidate).error) continue
      if (index > cursor) segments.push({ kind: 'markdown', text: prose.slice(cursor, index) })
      segments.push({ kind: 'query', query: candidate, heading: obj.title ?? '' })
      cursor = index + matchLen
      continue
    }

    const query = decodeQuery(match[4] ?? '')
    if (!isWqlQuery(query)) continue
    if (index > cursor) segments.push({ kind: 'markdown', text: prose.slice(cursor, index) })
    segments.push({ kind: 'query', query: query.trim(), heading: match[3] ?? '' })
    cursor = index + matchLen
  }
  if (cursor < prose.length) segments.push({ kind: 'markdown', text: prose.slice(cursor) })
  const merged: ReadmeSegment[] = []
  for (const segment of segments) {
    const last = merged[merged.length - 1]
    if (segment.kind === 'markdown' && last?.kind === 'markdown') last.text += segment.text
    else merged.push(segment)
  }
  return merged
}

/** Any embed on the page suppresses the notebook's default stream. */
export function hasReadmeQuery(segments: ReadmeSegment[]): boolean {
  return segments.some(s => s.kind === 'query')
}
