/**
 * noteContextLinks — shared source-aware contextual links for note views.
 *
 * One place for the per-view interlinking from docs/note-pages-inventory.html:
 *   - noteOwnership  — the note's source family → L1 zone id, owning-list "Up"
 *     link, and the sourceNote stamps journal copies carry in `sourceId`.
 *   - provenanceLink — resolve a stamped sourceId to a routable link.
 *   - effort / related-block / backlink lookups over the existing IDB indexes
 *     (block_efforts, block_index by-note/by-content/by-effort, notes.sourceId).
 *
 * Pure functions are exported for tests; `useNoteContextLinks` + the
 * `NoteContextNav` registration are the view surface every note page composes.
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { storageService } from '@/services/storage'
import type { BlockEffort, BlockIndexRow, Note } from '@/types/storage'
import type { HistoryEntry } from '@/types/history'
import { parseNoteId } from '@/lib/noteIdentity'
import { noteRefToPath } from '../../lib/noteIdentity'
import { useNav } from '../../nav/NavContext'
import type { MenuSpec } from '../../nav/menuModel'
import {
  notebookPath,
  effortPath,
  effortsPath,
  equipmentPath,
  feedPath,
  dayPath,
  notePath,
  pagePath,
  playgroundsPath,
  ROUTE_PATTERNS,
  notebookItemPath,
} from '../../lib/routes'
import { playgroundRouteName } from '../../lib/entryMapper'

/**
 * Routable path for a STORED note id. Composite ids keep their family route
 * (cat/name → /notebook/…, effort/<slug> → /effort/…, journal/<date> → /day/…);
 * bare ids (UUIDs — journal copies, V8 playground notes) have no family
 * route and open in the canonical editor /note/:id, never the `/` fallback.
 */
export function noteLinkPath(noteId: string): string {
  const ref = parseNoteId(noteId)
  if (ref.kind === 'workout' && !ref.category) return notePath(noteId)
  return noteRefToPath(ref)
}

export interface ContextNoteLink {
  id: string
  title: string
  to: string
}

export interface NoteContextData {
  /** Efforts referenced by this note's scripts (`block_efforts` by-note). */
  efforts: ContextNoteLink[]
  /** Other notes sharing a workout-block content id (same script shape). */
  related: ContextNoteLink[]
  /** Notes whose sourceNote stamp (`sourceId`) points at this note. */
  backlinks: ContextNoteLink[]
}

const EMPTY_CONTEXT: NoteContextData = { efforts: [], related: [], backlinks: [] }
/** ponytail: cap related links so the L2 nav section stays scannable; raise when a page wants full lists. */
const MAX_RELATED = 8

// ── Source-aware ownership ───────────────────────────────────────────────────

/** L1 zone ids that exist in the nav tree. The journal and playgrounds
 * views live inside the notebooks zone, so their notes light 'notebooks'. */
export type NoteZone = 'notebooks' | 'feeds' | 'efforts' | 'equipment' | null

export interface NoteOwnership {
  /** L1 zone id to light on the canonical /note/:id route (guarded against the tree). */
  zone: NoteZone
  /** Owning-list link ("Up") derived from the note's source; null when unknown. */
  up: ContextNoteLink | null
  /** sourceNote stamps journal copies may carry for this note (paths or ids). */
  stamps: string[]
}

/**
 * Source-aware ownership for a loaded entry. Kind resolution follows the
 * stored conventions (entryMapper): `type` when present, then the composite-id
 * grammar (journal/:date, playground/:name, effort/:slug, feeds/…, cat/name).
 */
export function noteOwnership(entry: Pick<HistoryEntry, 'id' | 'type' | 'sourceId' | 'journalDate' | 'slug' | 'pageId'>): NoteOwnership {
  const id = entry.id
  const isPlayground = entry.type === 'playground' || entry.sourceId === 'playground' || id.startsWith('playground/')
  const ref = parseNoteId(id)

  if (entry.type === 'journal' || entry.journalDate || (!isPlayground && ref.kind === 'journal')) {
    const date = entry.journalDate ?? (ref.kind === 'journal' ? ref.id : undefined)
    return {
      // The journal is a view within the notebooks zone (ticket 10).
      zone: 'notebooks',
      up: date ? { id: date, title: 'Journal', to: dayPath(date) } : null,
      stamps: [id],
    }
  }
  if (isPlayground || ref.kind === 'playground') {
    const name = playgroundRouteName({ id })
    return {
      // The playground is a view within the notebooks zone (ticket 10).
      zone: 'notebooks',
      up: { id: 'playgrounds', title: 'Playgrounds', to: playgroundsPath() },
      stamps: [`/playground/${name}`],
    }
  }
  if (ref.kind === 'workout') {
    if (ref.category === 'effort') {
      return {
        zone: 'efforts',
        up: { id: 'efforts', title: 'Efforts', to: effortsPath() },
        stamps: [effortPath(ref.id)],
      }
    }
    if (ref.category === 'equipment') {
      return {
        zone: 'equipment',
        up: { id: 'equipment', title: 'Equipment', to: ROUTE_PATTERNS.equipment },
        stamps: [equipmentPath(ref.id)],
      }
    }
    if (ref.category === 'feeds') {
      // Feed runs stamp the ITEM path (`/feeds/<slug>/<date>/<item>`) going
      // forward (feed-level `/feeds/<slug>` stamps predate item attribution
      // and only ever match the feed listing page, never this item).
      const [, feedSlug, feedDate, feedItem] = id.split('/')
      return {
        zone: 'feeds',
        up: feedSlug ? { id: feedSlug, title: feedSlug, to: feedPath(feedSlug) } : null,
        stamps: feedSlug && feedDate && feedItem ? [`/feed/${feedSlug}/${feedDate}/${feedItem}`] : [],
      }
    }
    if (ref.category) {
      return {
        zone: 'feeds',
        up: { id: ref.category, title: ref.category, to: notebookPath(ref.category) },
        stamps: [notebookItemPath(ref.category, ref.id)],
      }
    }
  }
  if (entry.type === 'page' && (entry.pageId ?? entry.slug)) {
    const slug = entry.pageId ?? entry.slug!
    return { zone: null, up: { id: slug, title: `/page/${slug}`, to: pagePath(slug) }, stamps: [] }
  }
  return { zone: null, up: null, stamps: [] }
}

/**
 * Resolve a stamped `sourceId` to a provenance link: app paths link
 * directly (that's what journal-copy stamping writes); bare values are note
 * ids the caller resolves through the content provider. Stamps are
 * user-editable storage data — decoding is throw-safe on malformed input.
 */
export function provenanceLink(sourceId: string): ContextNoteLink | null {
  if (!sourceId.startsWith('/')) return null
  const to = sourceId.split('#')[0]
  const segs = to.replace(/\/+$/, '').split('/').filter(Boolean)
  const rawLabel = segs[segs.length - 1]
  let label = rawLabel
  if (label) {
    try {
      label = decodeURIComponent(label)
    } catch {
      // Malformed percent-encoding in a stored stamp — keep the raw segment.
    }
  }
  return { id: to, title: label || to, to }
}

// ── Index-derived link builders (pure) ───────────────────────────────────────

/** Efforts referenced by a note, from its block_efforts rows (de-duped, in order).
 *  Slugs absent from the catalog link to the efforts search (`?q=slug`) —
 *  a direct detail route would 404 for an uncataloged effort. */
export function effortLinks(rows: BlockEffort[], knownSlugs?: ReadonlySet<string>): ContextNoteLink[] {
  const seen = new Set<string>()
  const out: ContextNoteLink[] = []
  for (const row of rows) {
    if (!row.effortSlug || seen.has(row.effortSlug)) continue
    seen.add(row.effortSlug)
    const isKnown = !knownSlugs || knownSlugs.has(row.effortSlug)
    out.push({
      id: row.effortSlug,
      title: row.effortSlug,
      to: isKnown ? effortPath(row.effortSlug) : `${effortsPath()}?q=${encodeURIComponent(row.effortSlug)}`,
    })
  }
  return out
}

/** Other notes sharing any of this note's workout-block content ids — "same
 * block ideas". Reads the full row set (this note's rows + sibling rows
 * fetched by-content by the hook), de-dupes by noteId, caps the list. Only
 * `wod` rows count: a frontmatter row sharing a content id is not a workout. */
export function relatedBlockLinks(rows: BlockIndexRow[], noteId: string, cap = MAX_RELATED): ContextNoteLink[] {
  const own = new Set(
    rows.filter(r => r.noteId === noteId && r.dataType === 'wod' && r.blockContentId)
      .map(r => r.blockContentId as string),
  )
  if (own.size === 0) return []
  const byNote = new Map<string, ContextNoteLink>()
  for (const row of rows) {
    if (row.dataType !== 'wod') continue
    if (!row.blockContentId || !own.has(row.blockContentId) || row.noteId === noteId) continue
    if (byNote.has(row.noteId)) continue
    byNote.set(row.noteId, {
      id: row.noteId,
      title: row.noteTitle || row.noteId,
      to: noteLinkPath(row.noteId),
    })
    if (byNote.size >= cap) break
  }
  return [...byNote.values()]
}

/**
 * Journal copies stamped with one of these sourceNote stamps. Matches exact
 * stamps and their `#segment` variants (entryOpenHref appends block anchors).
 */
export function backlinkNotes(notes: Note[], stamps: string[], excludeNoteId?: string): ContextNoteLink[] {
  if (stamps.length === 0) return []
  const matched = notes.filter(n =>
    n.id !== excludeNoteId && !!n.sourceId &&
    stamps.some(s => n.sourceId === s || n.sourceId.startsWith(`${s}#`)),
  )
  matched.sort((a, b) => b.createdAt - a.createdAt)
  return matched.map(n => ({
    id: n.id,
    title: n.title || n.id,
    to: noteLinkPath(n.id),
  }))
}

/** Notes whose scripts use an effort, from block_efforts by-effort rows. */
export function effortUsageLinks(rows: BlockEffort[], excludeNoteId?: string): ContextNoteLink[] {
  const byNote = new Map<string, ContextNoteLink>()
  for (const row of rows) {
    if (row.noteId === excludeNoteId || byNote.has(row.noteId)) continue
    byNote.set(row.noteId, {
      id: row.noteId,
      title: row.noteId,
      to: noteLinkPath(row.noteId),
    })
  }
  return [...byNote.values()]
}

// ── Data hook ────────────────────────────────────────────────────────────────

export interface UseNoteContextLinksOptions {
  noteId: string
  /** sourceNote stamps journal copies may carry for this note. */
  stamps: string[]
  /** When the page IS an effort, also resolve notes whose scripts use it. */
  effortSlug?: string
}

/** Load the three context datasets over the existing IDB indexes. */
export function useNoteContextLinks({ noteId, stamps, effortSlug }: UseNoteContextLinksOptions): NoteContextData {
  const stampKey = stamps.join('\n')
  // Key results by route inputs: while inputs change, render EMPTY_CONTEXT —
  // a new note never shows the previous note's still-in-flight relationships.
  const [result, setResult] = useState<{ key: string; data: NoteContextData }>({ key: '', data: EMPTY_CONTEXT })
  const routeKey = `${noteId}\u0000${stampKey}\u0000${effortSlug ?? ''}`
  const data = result.key === routeKey ? result.data : EMPTY_CONTEXT

  useEffect(() => {
    let cancelled = false
    const stampList = stampKey ? stampKey.split('\n') : []
    Promise.all([
      storageService.getAllFromIndex('block_efforts', 'by-note', noteId) as Promise<BlockEffort[]>,
      storageService.getAllFromIndex('block_index', 'by-note', noteId) as Promise<BlockIndexRow[]>,
      storageService.getAllNotes(),
      storageService.getAllEfforts(),
      effortSlug
        ? (storageService.getAllFromIndex('block_efforts', 'by-effort', effortSlug) as Promise<BlockEffort[]>)
        : Promise.resolve([]),
    ])
      .then(async ([effortRows, blockRows, notes, allEfforts, usageRows]) => {
        if (cancelled) return EMPTY_CONTEXT
        const knownEffortSlugs = new Set(allEfforts.map(e => e.slug))
        const ownContentIds = [...new Set(
          blockRows.filter(r => r.dataType === 'wod' && r.blockContentId).map(r => r.blockContentId as string),
        )]
        const siblingRows = await Promise.all(
          ownContentIds.map(cid => storageService.getAllFromIndex('block_index', 'by-content', cid) as Promise<BlockIndexRow[]>),
        )
        if (cancelled) return EMPTY_CONTEXT
        const related = relatedBlockLinks([...blockRows, ...siblingRows.flat()], noteId)
        if (effortSlug) {
          const seen = new Set(related.map(r => r.id))
          for (const usage of effortUsageLinks(usageRows, noteId)) {
            if (!seen.has(usage.id)) {
              seen.add(usage.id)
              related.push(usage)
            }
          }
        }
        return {
          efforts: effortLinks(effortRows, knownEffortSlugs),
          related,
          backlinks: backlinkNotes(notes, stampList, noteId),
        }
      })
      .then(next => {
        if (!cancelled && next) setResult({ key: routeKey, data: next })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [noteId, stampKey, effortSlug, routeKey])

  return data
}

// ── L2 registration ──────────────────────────────────────────────────────────

export interface NoteContextNavProps {
  data: NoteContextData
  /** Owning-list link ("Up") — first section when present. */
  up?: ContextNoteLink | null
  /** Provenance link for a stamped sourceId — section after Up when present. */
  source?: ContextNoteLink | null
  /** Label override for the `related` section (e.g. "Used in" on effort pages). */
  relatedLabel?: string
}

/** Registers the note's relationships as the L2 sidebar content for the
 *  current route (replacing the listing panel). Renders nothing itself: the
 *  sidebar consumes the static MenuSpec. Links navigate to their canonical
 *  `to` — no history.back. */
export function NoteContextNav({ data, up, source, relatedLabel = 'Related workouts' }: NoteContextNavProps) {
  const { setContextNav } = useNav()
  const location = useLocation()

  useEffect(() => {
    const spec: MenuSpec = []
    const section = (id: string, label: string, items: ContextNoteLink[]) => {
      if (items.length === 0) return
      spec.push({
        kind: 'section',
        id,
        label,
        entries: items.map(item => ({ kind: 'link' as const, id: `${id}:${item.id}`, label: item.title, to: item.to })),
      })
    }
    section('note-context-up', 'Up', up ? [up] : [])
    section('note-context-source', 'Source', source ? [source] : [])
    section('note-context-efforts', 'Efforts', data.efforts)
    section('note-context-backlinks', 'Journal copies', data.backlinks)
    section('note-context-related', relatedLabel, data.related)
    setContextNav({ pathname: location.pathname, spec })
    return () => setContextNav(undefined)
  }, [data, up, source, relatedLabel, location.pathname, setContextNav])

  return null
}
