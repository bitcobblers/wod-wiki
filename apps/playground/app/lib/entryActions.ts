/**
 * Entry action helpers — the pure seam between an Entry and the URL the
 * Open / Compare row action should navigate to. The LibraryRow consumes
 * these; the test seam is the URL the row would visit on click.
 *
 * URL shapes (ticket 09 — one spelled-out prefix per concept):
 *   Open  Note         → /note/:noteId (named pages → /page/:pageSlug);
 *                        notebook members keep their corpus routes —
 *                        notebook items → /notebook/:slug[/:item],
 *                        feed posts → /feed/:feedSlug/:date/:item
 *   Open  Effort       → /effort/:slug
 *   Open  Equipment    → /equipment/:slug
 *   Open  Result       → /results/:sessionId
 *   Open  Dashboard    → /dashboard/:slug (corpus) or /note/:noteId (vault)
 *   Compare (any)      → /dashboards?q=:blockContentId
 *
 * Run is NOT a URL: WallClockPage only consumes pendingRuntimes, so the Run
 * action stages a runtime through startEntryRun (./entryRun) and navigates
 * to /run/:runtimeId itself.
 *
 * Add-to-today is not a URL (it's a creation flow); the Library page wires it
 * via `addEntryToTodayInput`. The shape is exposed as a boolean
 * (`entryCanAddToToday`) so the LibraryRow can render the button.
 */
import type { Entry } from './entryMapper'
import { notePath, sessionDetailPath, analyticsExplorerPath } from './routes'

/** Per-path-segment encoding — slashes stay separators. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Open: the Entry's deep-link per its kind; block Entries anchor to their
 *  section within the parent note (#855 — honored wherever the target
 *  surface exposes section DOM ids; degrades to the plain note elsewhere).
 *  Named pages open at /page/<pageSlug>; plain notes open in the canonical
 *  editor /note/<uuid>. Route identity comes from sourceId/sourcePath —
 *  never a UUID pageId or note title. */
export function entryOpenHref(entry: Entry): string {
  const href = (() => {
    switch (entry.kind) {
      case 'note': {
        // Guide notes render at their declared sourceId route; the pageSlug
        // lookup in canvasRouteLookup resolves it.
        if (entry.sourceCatalog === 'guides') {
          return entry.pageSlug ? `/page/${encodePath(entry.pageSlug)}` : `/${encodePath(entry.sourceItem.replace(/^\//, ''))}`
        }
        // Playground entries open in the playground editor.
        if (entry.sourceCatalog === 'playground') {
          return `/playground/${encodeURIComponent(entry.sourceItem)}`
        }
        // Known corpus surfaces route by sourcePath, never by note UUID:
        //   markdown/dashboards/<slug>.md            → /dashboard/<slug>
        //   markdown/efforts/<discipline>/<slug>.md  → /effort/<slug>
        const dash = /^markdown\/dashboards\/(.+)\.md$/.exec(entry.sourcePath ?? '')
        if (dash?.[1]) return `/dashboard/${encodePath(dash[1])}`
        const effort = /^markdown\/efforts\/[^/]+\/(.+)\.md$/.exec(entry.sourcePath ?? '')
        if (effort?.[1]) return `/effort/${encodePath(effort[1])}`
        // Notebook members (ticket 05) — collection items and feed posts
        // keep their corpus routes; identity comes from sourceId/sourcePath
        // (noteType for legacy rows), never a UUID.
        const sid = entry.sourceId ?? ''
        const spath = entry.sourcePath ?? ''
        if (sid.startsWith('page:collection:') || sid.startsWith('collection:')
          || spath.startsWith('markdown/collections/')
          || entry.noteType === 'feed' || entry.noteType === 'page') {
          return !entry.sourceItem
            ? `/notebook/${encodeURIComponent(entry.sourceCatalog)}`
            : `/notebook/${encodeURIComponent(entry.sourceCatalog)}/${encodeURIComponent(entry.sourceItem)}`
        }
        if (sid.startsWith('feed:') || spath.startsWith('markdown/feeds/')) {
          const date = entry.date ?? ''
          return `/feed/${encodeURIComponent(entry.sourceCatalog)}/${encodeURIComponent(date)}/${encodeURIComponent(entry.sourceItem)}`
        }
        // Named pages open at their slug; everything else in the canonical
        // single-note editor.
        if (entry.pageSlug) return `/page/${encodePath(entry.pageSlug)}`
        return notePath(entry.id)
      }
      case 'dashboard':
        // Corpus dashboards route by page slug (/dashboard/<slug>); vault
        // dashboards with no corpus path fall back to the canonical note editor.
        return entry.sourceCatalog === 'dashboards' && entry.sourceItem
          ? `/dashboard/${encodePath(entry.sourceItem)}`
          : notePath(entry.id)
      case 'equipment': {
        // Dedicated equipment route; the same note stays reachable through
        // the canonical note editor for non-equipment contexts.
        const raw = entry.sourceItem ?? entry.id
        const slug = raw.startsWith('equipment/') ? raw.slice('equipment/'.length) : raw
        const isNoteId = /^(?:uuid-|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$)/i.test(slug)
        return slug && !isNoteId ? `/equipment/${encodePath(slug)}` : notePath(entry.id)
      }
      case 'effort':
        return `/effort/${encodeURIComponent(entry.effort?.slug ?? entry.id)}`
      case 'result':
        return sessionDetailPath(entry.id)
      case 'segment':
      case 'event':
        // Table-plane rows (:segment/:event) carry no execution
        // payload — their session identity lives in sourceItem (__resultId).
        return sessionDetailPath(
          entry.execution?.resultId ?? (entry.sourceCatalog === 'results' ? entry.sourceItem : entry.id),
        )
      default:
        return '/'
    }
  })()
  return entry.block ? `${href}#${encodeURIComponent(entry.block.blockId)}` : href
}

/** True when the entry already lives in the playground (Open is the playground
 *  action — the feed's "Playground" action targets non-playground content). */
export function entryIsPlayground(entry: Entry): boolean {
  return entry.sourceCatalog === 'playground' || entry.sourceId === 'playground'
}

/** Notebook deep link for collection definition entries — a note with no
 * item is a notebook landing (every kind fills sourceItem except landings). */
export function entryCollectionFeedHref(entry: Entry): string | null {
  if (entry.kind === 'note' && !entry.sourceItem) {
    return `/notebooks?q=${encodeURIComponent(`:notebook{notebook:${entry.sourceCatalog}}`)}`
  }
  return null
}

/** Compare: any row with a blockContentId; routes to the WQL explorer on the
 *  dashboards list (the ?q= deep link pre-fills the query). */
export function entryCompareHref(entry: Entry): string | null {
  if (!entry.blockContentId) return null
  return analyticsExplorerPath({ q: entry.blockContentId })
}

/** Add to today: any note (journal, collection item, feed post), and
 *  Result + Segment when associated with a noteId. */
export function entryCanAddToToday(entry: Entry): boolean {
  if (entry.kind === 'note') return true
  if ((entry.kind === 'result' || entry.kind === 'segment') && !!entry.execution?.noteId) {
    return true
  }
  return false
}
