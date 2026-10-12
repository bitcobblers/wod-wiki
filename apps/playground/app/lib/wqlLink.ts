/**
 * wqlStreamHref — resolve a WQL query string to the canonical stream page
 * that can run it (`?q=` follows useComposerQueryState on every
 * QueriableStreamView route). Returns null when the text is not a valid find
 * query or targets no routed stream — callers render the raw text instead
 * of a link.
 *
 * Markdown link destinations cannot contain spaces, so grouped queries are
 * percent-encoded by the author (`:feed{catalog:a}%20by%20{date}`); callers
 * decodeURIComponent before passing the query here.
 */
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine'

function singleValue(filters: { key: string; negate: boolean; values: { value: string }[] }[], key: string): string | null {
  const filter = filters.find(f => f.key === key && !f.negate)
  return filter && filter.values.length === 1 ? filter.values[0].value : null
}

export function wqlStreamHref(rawQuery: string): string | null {
  const query = rawQuery.trim()
  if (!query.startsWith(':')) return null
  const parsed = parseQuery(query)
  if (parsed.error || !isFindQuery(parsed)) return null
  const q = `?q=${encodeURIComponent(query)}`
  switch (parsed.target) {
    case 'effort':
      return `/efforts${q}`
    case 'session':
    case 'segment':
    case 'event':
      return `/sessions${q}`
    case 'note':
    case 'block': {
      // Scoped note heads parse to target 'note' plus injected filters
      // (`:feed{…}` → source:feeds, `:journal{…}` → source:journal).
      const catalog = singleValue(parsed.filters, 'catalog')
      if (catalog) return `/c/${encodeURIComponent(catalog)}${q}`
      const source = singleValue(parsed.filters, 'source')
      if (source === 'journal') return `/journal${q}`
      if (source === 'playground') return `/playgrounds${q}`
      if (source === 'feeds' || source === 'guides') return `/feeds${q}`
      if (singleValue(parsed.filters, 'type') === 'dashboard') return `/dashboards${q}`
      return `/journal${q}`
    }
    default:
      return null
  }
}
