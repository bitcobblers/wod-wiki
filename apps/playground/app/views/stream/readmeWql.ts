/**
 * readmeWql — WQL embed links for notebook README pages.
 *
 * A standard markdown link whose destination is a WQL query, immediately
 * followed by a bang (`[Recent](:notebooks{notebook:xyz})!`), injects that
 * query's results into the notebook page in place of the link; the link
 * text becomes the block's heading (`[]` renders no heading). Several
 * embeds may appear on one page. Without the bang the link stays a plain
 * navigation link (CanvasProse routes it). Query spaces arrive
 * percent-encoded (`%20`) — markdown destinations cannot contain them.
 * Retired-grammar embeds (legacy `catalog:` filters, feed/collection
 * heads) rewrite to the notebook vocabulary (tickets 08/12). Anything
 * else, invalid queries included, passes through as markdown.
 */
import { parseQuery } from '@bitcobblers/wod-wiki-engine'
import { migrateLegacyStoredWql } from '../../lib/routeWqlConfig'

export type ReadmeSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'query'; query: string; heading: string }

// [text](:query)! — the destination is everything up to the first `)`.
const EMBED_RE = /\[([^\]]*)\]\((:[^)]*)\)!/g

function decodeQuery(text: string): string {
  const trimmed = text.trim()
  const decoded = (() => {
    try {
      return decodeURIComponent(trimmed)
    } catch {
      return trimmed
    }
  })()
  // Legacy migration (tickets 08/12): old corpus embeds keep their scope
  // instead of failing to parse against the notebook plane.
  return migrateLegacyStoredWql(decoded)
}

function isWqlQuery(text: string): boolean {
  const query = decodeQuery(text)
  return query.startsWith(':') && !parseQuery(query).error
}

export function splitReadmeQueries(prose: string): ReadmeSegment[] {
  const segments: ReadmeSegment[] = []
  let cursor = 0
  for (const match of prose.matchAll(EMBED_RE)) {
    const index = match.index ?? 0
    const query = decodeQuery(match[2])
    if (!isWqlQuery(query)) continue // not an embed — leave as markdown
    if (index > cursor) segments.push({ kind: 'markdown', text: prose.slice(cursor, index) })
    segments.push({ kind: 'query', query: query.trim(), heading: match[1] })
    cursor = index + match[0].length
  }
  if (cursor < prose.length) segments.push({ kind: 'markdown', text: prose.slice(cursor) })
  // Merge adjacent markdown runs so each renders as one CanvasProse instance.
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
