/**
 * wqlStreamHref — resolve a WQL query string to the canonical stream page
 * that can run it (`?q=` follows useComposerQueryState on every
 * QueriableStreamView route). Returns null when the text is not a valid find
 * query or targets no routed stream — callers render the raw text instead
 * of a link.
 *
 * Markdown link destinations cannot contain spaces, so grouped queries are
 * percent-encoded by the author (`:feeds{notebook:a}%20by%20{date}`);
 * callers decodeURIComponent before passing the query here.
 */
import { parseQuery, isFindQuery, notebookSlugFromId } from '@bitcobblers/wod-wiki-engine'
import { migrateLegacyCatalogFilter } from './legacyWql'

function singleValue(filters: { key: string; negate: boolean; values: { value: string }[] }[], key: string): string | null {
  const filter = filters.find(f => f.key === key && !f.negate)
  return filter && filter.values.length === 1 ? filter.values[0].value : null
}

export function wqlStreamHref(rawQuery: string): string | null {
  const query = rawQuery.trim()
  if (!query.startsWith(':')) return null
  // Legacy `catalog:` filters still route to their notebook landing — the
  // migration decides the target; the original text rides the query param.
  const parsed = parseQuery(migrateLegacyCatalogFilter(query))
  if (parsed.error || !isFindQuery(parsed)) return null
  const q = `?q=${encodeURIComponent(query)}`
  switch (parsed.target) {
    case 'effort':
      return `/efforts${q}`
    case 'session':
    case 'segment':
    case 'event':
      return `/sessions${q}`
    case 'notebook':
      return `/notebooks${q}`
    case 'page':
      return `/pages${q}`
    case 'tag':
      return `/tags${q}`
    case 'equipment':
      return `/equipment${q}`
    case 'note':
    case 'block': {
      // Scoped note heads parse to target 'note' plus injected filters
      // (`:feed{…}` → source:feeds, `:journal{…}` → source:journal).
      const notebookFilter = singleValue(parsed.filters, 'notebook')
      if (notebookFilter) {
        const slug = notebookSlugFromId(notebookFilter)
        if (slug === 'journal') return `/journal${q}`
        if (slug === 'playground') return `/playgrounds${q}`
        return `/notebook/${encodeURIComponent(slug)}${q}`
      }
      const source = singleValue(parsed.filters, 'source')
      if (source === 'journal') return `/journal${q}`
      if (source === 'playground') return `/playgrounds${q}`
      if (source === 'feeds' || source === 'notebooks' || source === 'notebook' || source === 'guides') return `/notes${q}`
      if (singleValue(parsed.filters, 'type') === 'dashboard') return `/dashboards${q}`
      return `/notes${q}`
    }
    default:
      return null
  }
}
