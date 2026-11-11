/**
 * noteContextLinks — shared source-aware contextual links for note views.
 *
 * One place for per-view contextual L2 interlinking:
 *   - noteOwnership  — the note's source family → L1 zone id, owning-list "Up"
 *     link, and the sourceNote stamps journal copies carry in `sourceId`.
 *   - provenanceLink — resolve a stamped sourceId to a routable link.
 *   - container membership (Collections → `/notebook/:slug`, Pages → `/page/:slug`
 *     or `/day/:date`, 1-part links de-duplicated against Up/Source).
 *   - facet navigation (Tags → `/t/:type/:tag`, Efforts → `/effort/:slug`,
 *     Equipment → `/equipment/:slug`, all as 2-part rows whose secondary filter
 *     button opens `/notes?q=:note{...}`).
 *   - live content sync + Unrecognized label creation via `useLiveNoteFacets`
 *     and `openCreateReferenceDialog`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { orderPlacements, type Page, type PageNote, type Tag } from '@bitcobblers/wod-wiki-core'
import { WQL_TYPED_TAG_KEYS } from '@bitcobblers/wod-wiki-wql'
import { storageService } from '@/services/storage'
import type { BlockEffort, BlockEquipment, BlockIndexRow, Note } from '@/types/storage'
import type { HistoryRecord } from '@/types/history'
import { parseNoteId, noteRefToPath } from '@/lib/noteIdentity'
import { openCreateReferenceDialog } from '../../components/organisms/references/CreateReferenceFromLabelDialog'
import { useOptionalEffortRegistry } from '../../contexts/EffortRegistryContext'
import { useOptionalEquipmentRegistry } from '../../contexts/EquipmentRegistryContext'
import { useNav } from '../../nav/NavContext'
import type { MenuSpec } from '../../nav/menuModel'
import {
  notebookPath,
  effortPath,
  effortsPath,
  equipmentPath,
  dayPath,
  notePath,
  pagePath,
  playgroundsPath,
  ROUTE_PATTERNS,
  notebookItemPath,
  tagPath,
} from '../../lib/routes'
import { playgroundRouteName } from '../../lib/entryMapper'
import { formatDateKey } from '../../services/dateUtils'
import {
  subscribeReferenceCatalogChanged,
  useLiveNoteFacets,
  type LiveNoteFacets,
} from './useLiveNoteFacets'

const TYPED_WQL_KEYS = new Set<string>(WQL_TYPED_TAG_KEYS)
const INTERNAL_NOTEBOOKS = new Set(['journal', 'playground', 'guides', 'efforts', 'equipment', 'dashboards'])

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

function formatWqlValue(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return '""'
  if (/^[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed
  return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Canonical `/notes?q=:note{<key>:<value>}` filter URL for 2-part facet links. */
export function notesFacetFilterPath(key: string, value: string): string {
  const wql = `:note{${key}:${formatWqlValue(value)}}`
  return `${ROUTE_PATTERNS.notes}?q=${encodeURIComponent(wql)}`
}

export interface ContextNoteLink {
  id: string
  title: string
  to?: string
  onSelect?: () => void
  badge?: string
  filterTo?: string
  filterLabel?: string
}

export interface NoteContextData {
  /** Notebooks/collections this note belongs to (1-part → `/notebook/:slug`). */
  collections?: ContextNoteLink[]
  /** Named/date pages this note is placed on (1-part → `/page/:slug` or `/day/:date`). */
  pages?: ContextNoteLink[]
  /** Non-effort/non-equipment tags on this note (2-part → `/t/:type/:tag` | `/notes?q=...`). */
  tags?: ContextNoteLink[]
  /** Efforts referenced by this note (2-part → `/effort/:slug` | `/notes?q=:note{effort:...}`). */
  efforts: ContextNoteLink[]
  /** Equipment referenced by this note (2-part → `/equipment/:slug` | `/notes?q=:note{equipment:...}`). */
  equipment?: ContextNoteLink[]
  /** Unrecognized labels in live content (click → Define dialog | filter → `/notes?q=:note{text:...}`). */
  unrecognized?: ContextNoteLink[]
  /** Other notes sharing a workout-block content id (same script shape). */
  related: ContextNoteLink[]
  /** Notes whose sourceNote stamp (`sourceId`) points at this note. */
  backlinks: ContextNoteLink[]
}

/** Relationship-free context — pages whose L2 is Up/calendar/recent only. */
export const EMPTY_NOTE_CONTEXT: NoteContextData = {
  collections: [],
  pages: [],
  tags: [],
  efforts: [],
  equipment: [],
  unrecognized: [],
  related: [],
  backlinks: [],
}

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
 * Source-aware ownership for a loaded entry.
 * Resolves L1 zone, owning-list "Up" link, and provenance stamps
 * across journal, playground, notebook, and page entities.
 */
export function noteOwnership(entry: Pick<HistoryRecord, 'id' | 'type' | 'sourceId' | 'journalDate' | 'slug' | 'pageId' | 'notebookId'>): NoteOwnership {
  const id = entry.id
  const isPlayground = entry.type === 'playground' || entry.sourceId === 'playground' || entry.notebookId === 'notebook/playground' || id.startsWith('playground/')
  const ref = parseNoteId(id)

  if (isPlayground || ref.kind === 'playground') {
    const name = playgroundRouteName({ id, slug: entry.slug })
    return {
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
    if (ref.category === 'notebook') {
      return {
        zone: 'notebooks',
        up: ref.id ? { id: ref.id, title: ref.id, to: notebookPath(ref.id) } : null,
        stamps: [],
      }
    }
    if (ref.category) {
      return {
        zone: 'notebooks',
        up: { id: ref.category, title: ref.category, to: notebookPath(ref.category) },
        stamps: [notebookItemPath(ref.category, ref.id)],
      }
    }
  }
  if (entry.notebookId?.startsWith('notebook/')) {
    const slug = entry.notebookId.slice('notebook/'.length)
    if (slug && slug !== 'journal' && slug !== 'playground' && slug !== 'guides') {
      return {
        zone: 'notebooks',
        up: { id: slug, title: slug, to: notebookPath(slug) },
        stamps: [notebookItemPath(slug, id)],
      }
    }
  }
  if (entry.type === 'journal' || entry.journalDate || ref.kind === 'journal') {
    const date = entry.journalDate ?? (ref.kind === 'journal' ? ref.id : undefined)
    return {
      zone: 'notebooks',
      up: date ? { id: date, title: 'Journal', to: dayPath(date) } : null,
      stamps: [id],
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

/** 1-part collection links (`/notebook/:slug`) for any notebook/collection a note belongs to. */
export function collectionLinks(
  note: Pick<Note, 'id' | 'notebookId' | 'sourceId' | 'tags'> | undefined,
  fallbackNoteId?: string,
): ContextNoteLink[] {
  const slugs: string[] = []
  const pushSlug = (raw: string | undefined) => {
    const clean = raw?.trim()
    if (!clean || INTERNAL_NOTEBOOKS.has(clean.toLowerCase())) return
    if (!slugs.includes(clean)) slugs.push(clean)
  }

  if (note?.notebookId?.startsWith('notebook/')) {
    pushSlug(note.notebookId.slice('notebook/'.length))
  }
  if (note?.tags) {
    for (const tag of note.tags) {
      if (tag.startsWith('notebook:') || tag.startsWith('notebook/')) {
        pushSlug(tag.slice('notebook:'.length))
      }
    }
  }
  const src = note?.sourceId
  if (src?.startsWith('/notebook/')) {
    const seg = src.slice('/notebook/'.length).split('/')[0]
    if (seg) {
      try {
        pushSlug(decodeURIComponent(seg))
      } catch {
        pushSlug(seg)
      }
    }
  } else if (src?.startsWith('notebook:')) {
    const seg = src.slice('notebook:'.length).split('/')[0]
    if (seg && seg !== '_root') pushSlug(seg)
  }

  const targetId = note?.id ?? fallbackNoteId
  if (targetId) {
    const ref = parseNoteId(targetId)
    if (ref.kind === 'workout' && ref.category && ref.category !== 'notebook') {
      pushSlug(ref.category)
    } else if (targetId.startsWith('notebook/')) {
      const seg = targetId.slice('notebook/'.length).split('/')[0]
      pushSlug(seg)
    }
  }

  return slugs.map(slug => ({
    id: slug,
    title: slug,
    to: notebookPath(slug),
  }))
}

/** 1-part page placement links (`/page/:slug` and canonical `/day/:date`) for a note. */
export function pagePlacementLinks(
  links: readonly PageNote[],
  pagesById: ReadonlyMap<string, Page>,
): ContextNoteLink[] {
  const ordered = orderPlacements([...links])
  const out: ContextNoteLink[] = []
  const seen = new Set<string>()
  for (const link of ordered) {
    const page = pagesById.get(link.pageId)
    if (!page) continue
    if (page.date) {
      const to = dayPath(page.date)
      if (seen.has(to)) continue
      seen.add(to)
      out.push({
        id: page.id,
        title: page.date,
        to,
      })
      continue
    }
    if (page.slug) {
      if (page.slug.startsWith('playground/') || page.slug.startsWith('e/')) continue
      const to = pagePath(page.slug)
      if (seen.has(to)) continue
      seen.add(to)
      out.push({
        id: page.id,
        title: page.title || `/page/${page.slug}`,
        to,
      })
    }
  }
  return out
}

/** 2-part tag links (`/t/:type/:tag` + `/notes?q=...`) for non-effort/non-equipment tags. */
export function tagLinks(tags: readonly Pick<Tag, 'label' | 'type'>[]): ContextNoteLink[] {
  const out: ContextNoteLink[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const label = tag.label.trim()
    if (!label || label.startsWith('notebook:') || label.startsWith('notebook/')) continue
    const rawType = (tag.type ?? '').trim()
    const lowerType = rawType.toLowerCase()
    if (lowerType === 'effort' || lowerType === 'equipment') continue
    const type = rawType || 'general'
    const key = `${type.toLowerCase()}:${label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const filterKey = TYPED_WQL_KEYS.has(lowerType) && lowerType !== 'effort' && lowerType !== 'equipment'
      ? lowerType
      : 'tags'
    out.push({
      id: `${type}:${label}`,
      title: `#${label}`,
      to: tagPath(type, label),
      filterTo: notesFacetFilterPath(filterKey, label),
      filterLabel: `Filter notes by #${label}`,
    })
  }
  return out
}

/** Efforts referenced by a note, from its block_efforts rows (de-duped, in order).
 *  Slugs absent from the catalog link to the efforts search (`?q=slug`) —
 *  a direct detail route would 404 for an uncataloged effort. */
export function effortLinks(
  rows: BlockEffort[],
  knownSlugs?: ReadonlySet<string>,
  labelsBySlug?: ReadonlyMap<string, string>,
): ContextNoteLink[] {
  const seen = new Set<string>()
  const out: ContextNoteLink[] = []
  for (const row of rows) {
    if (!row.effortSlug || seen.has(row.effortSlug)) continue
    seen.add(row.effortSlug)
    const isKnown = !knownSlugs || knownSlugs.has(row.effortSlug)
    const title = labelsBySlug?.get(row.effortSlug) || row.effortSlug
    out.push({
      id: row.effortSlug,
      title,
      to: isKnown ? effortPath(row.effortSlug) : `${effortsPath()}?q=${encodeURIComponent(row.effortSlug)}`,
      filterTo: notesFacetFilterPath('effort', row.effortSlug),
      filterLabel: `Filter notes by ${title}`,
    })
  }
  return out
}

/** 2-part equipment links (`/equipment/:slug` + `/notes?q=:note{equipment:<slug>}`). */
export function equipmentLinks(
  rows: readonly Pick<BlockEquipment, 'equipmentSlug'>[],
  knownSlugs?: ReadonlySet<string>,
  labelsBySlug?: ReadonlyMap<string, string>,
): ContextNoteLink[] {
  const seen = new Set<string>()
  const out: ContextNoteLink[] = []
  for (const row of rows) {
    if (!row.equipmentSlug || seen.has(row.equipmentSlug)) continue
    seen.add(row.equipmentSlug)
    const isKnown = !knownSlugs || knownSlugs.has(row.equipmentSlug)
    const title = labelsBySlug?.get(row.equipmentSlug) || row.equipmentSlug
    out.push({
      id: row.equipmentSlug,
      title,
      to: isKnown
        ? equipmentPath(row.equipmentSlug)
        : `${ROUTE_PATTERNS.equipment}?q=${encodeURIComponent(`:equipment{text:${formatWqlValue(row.equipmentSlug)}}`)}`,
      filterTo: notesFacetFilterPath('equipment', row.equipmentSlug),
      filterLabel: `Filter notes by ${title}`,
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
export function effortUsageLinks(rows: BlockEffort[], excludeNoteId?: string, notes?: readonly Pick<Note, 'id' | 'title'>[]): ContextNoteLink[] {
  const titles = notes ? new Map(notes.map(n => [n.id, n.title])) : undefined
  const byNote = new Map<string, ContextNoteLink>()
  for (const row of rows) {
    if (row.noteId === excludeNoteId || byNote.has(row.noteId)) continue
    byNote.set(row.noteId, {
      id: row.noteId,
      title: titles?.get(row.noteId) || row.noteId,
      to: noteLinkPath(row.noteId),
    })
  }
  return [...byNote.values()]
}

function liveFacetsToLinks(live: LiveNoteFacets, noteId?: string): Pick<NoteContextData, 'tags' | 'efforts' | 'equipment' | 'unrecognized'> {
  return {
    tags: tagLinks(live.tags.map(t => ({ label: t.label, type: t.type }))),
    efforts: live.efforts.map(e => ({
      id: e.slug,
      title: e.label || e.slug,
      to: effortPath(e.slug),
      filterTo: notesFacetFilterPath('effort', e.slug),
      filterLabel: `Filter notes by ${e.label || e.slug}`,
    })),
    equipment: live.equipment.map(eq => ({
      id: eq.slug,
      title: eq.label || eq.slug,
      to: equipmentPath(eq.slug),
      filterTo: notesFacetFilterPath('equipment', eq.slug),
      filterLabel: `Filter notes by ${eq.label || eq.slug}`,
    })),
    unrecognized: live.unrecognized.map(item => {
      const display = item.suggestedKind === 'tag' ? `#${item.rawLabel}` : item.rawLabel
      return {
        id: `${item.suggestedKind}:${item.candidateSlug}`,
        title: display,
        badge: 'define',
        onSelect: () => openCreateReferenceDialog({ item, noteId: noteId || undefined }),
        filterTo: notesFacetFilterPath('text', item.rawLabel),
        filterLabel: `Search notes mentioning ${item.rawLabel}`,
      }
    }),
  }
}

// ── Data hook ────────────────────────────────────────────────────────────────

export interface UseNoteContextLinksOptions {
  noteId: string
  /** sourceNote stamps journal copies may carry for this note. */
  stamps: string[]
  /** When the page IS an effort, also resolve notes whose scripts use it. */
  effortSlug?: string
  /** Live editor content — drives real-time Tags, Efforts, Equipment & Unrecognized rows. */
  liveContent?: string
  /** Bump when note placements, revisions, or metadata change so container links re-query IDB. */
  revision?: string | number
}

/** Load contextual container & relationship links from IDB and merge live content facets. */
export function useNoteContextLinks({
  noteId,
  stamps,
  effortSlug,
  liveContent,
  revision,
}: UseNoteContextLinksOptions): NoteContextData {
  const stampKey = stamps.join('\n')
  const effortCtx = useOptionalEffortRegistry()
  const equipmentCtx = useOptionalEquipmentRegistry()
  const effortsReady = effortCtx ? effortCtx.isReady : true
  const equipmentReady = equipmentCtx ? equipmentCtx.isReady : true
  const effortRevision = effortCtx?.revision ?? 0
  const equipmentRevision = equipmentCtx?.revision ?? 0
  const liveFacets = useLiveNoteFacets(liveContent, {
    enabled: liveContent !== undefined,
  })
  const [catalogVersion, setCatalogVersion] = useState(0)
  useEffect(() => subscribeReferenceCatalogChanged(() => setCatalogVersion(v => v + 1)), [])

  // Key results by route identity (not revision) so incremental edits update smoothly without flashing empty.
  const [result, setResult] = useState<{ key: string; data: NoteContextData }>({ key: '', data: EMPTY_NOTE_CONTEXT })
  const identityKey = `${noteId}\u0000${stampKey}\u0000${effortSlug ?? ''}`
  const stored = result.key === identityKey ? result.data : EMPTY_NOTE_CONTEXT

  useEffect(() => {
    if (!noteId) return
    let cancelled = false
    const stampList = stampKey ? stampKey.split('\n') : []
    Promise.all([
      storageService.getNote(noteId).catch(() => undefined),
      storageService.getNotePages(noteId).catch(() => [] as PageNote[]),
      storageService.getTagsForNote(noteId).catch(() => [] as Tag[]),
      storageService.getAllFromIndex('block_efforts', 'by-note', noteId) as Promise<BlockEffort[]>,
      (storageService.getAllFromIndex('block_equipment', 'by-note', noteId) as Promise<BlockEquipment[]>).catch(
        () => [] as BlockEquipment[],
      ),
      storageService.getAllFromIndex('block_index', 'by-note', noteId) as Promise<BlockIndexRow[]>,
      storageService.getAllNotes(),
      storageService.getAllEfforts(),
      storageService.getAllEquipment().catch(() => [] as Array<{ slug: string; label?: string }>),
      effortSlug
        ? (storageService.getAllFromIndex('block_efforts', 'by-effort', effortSlug) as Promise<BlockEffort[]>)
        : Promise.resolve([]),
    ])
      .then(async ([
        noteRecord,
        notePageLinks,
        noteTags,
        effortRows,
        equipmentRows,
        blockRows,
        notes,
        allEfforts,
        allEquipment,
        usageRows,
      ]) => {
        if (cancelled) return null
        const resolvedPages = await Promise.all(
          notePageLinks.map(l => storageService.getPage(l.pageId).catch(() => undefined)),
        )
        if (cancelled) return null
        const pagesById = new Map<string, Page>()
        for (const p of resolvedPages) {
          if (p) pagesById.set(p.id, p)
        }

        const knownEffortSlugs = new Set(allEfforts.map(e => e.slug))
        const effortLabels = new Map<string, string>(
          allEfforts.map((e): [string, string] => [e.slug, e.label || e.slug]),
        )
        const knownEquipmentSlugs = new Set(allEquipment.map(eq => eq.slug))
        const equipmentLabels = new Map<string, string>(
          allEquipment.map((eq): [string, string] => [eq.slug, eq.label || eq.slug]),
        )

        // Merge effort-typed and equipment-typed note_tags into canonical Efforts / Equipment
        // so `/t/effort/*` and `/t/equipment/*` never leak and facets never duplicate.
        const mergedEffortRows: BlockEffort[] = [...effortRows]
        const mergedEquipmentRows: Pick<BlockEquipment, 'equipmentSlug'>[] = [...equipmentRows]
        for (const t of noteTags) {
          const tType = t.type?.trim().toLowerCase()
          const slug = t.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          if (!slug) continue
          if (tType === 'effort') {
            mergedEffortRows.push({ id: `tag:${slug}`, noteId, blockId: '', effortSlug: slug, createdAt: 0 })
          } else if (tType === 'equipment') {
            mergedEquipmentRows.push({ equipmentSlug: slug })
          }
        }

        const ownContentIds = [...new Set(
          blockRows.filter(r => r.dataType === 'wod' && r.blockContentId).map(r => r.blockContentId as string),
        )]
        const siblingRows = await Promise.all(
          ownContentIds.map(cid => storageService.getAllFromIndex('block_index', 'by-content', cid) as Promise<BlockIndexRow[]>),
        )
        if (cancelled) return null
        const related = relatedBlockLinks([...blockRows, ...siblingRows.flat()], noteId)
        if (effortSlug) {
          const seen = new Set(related.map(r => r.id))
          for (const usage of effortUsageLinks(usageRows, noteId, notes)) {
            if (!seen.has(usage.id)) {
              seen.add(usage.id)
              related.push(usage)
            }
          }
        }
        return {
          collections: collectionLinks(noteRecord, noteId),
          pages: pagePlacementLinks(notePageLinks, pagesById),
          tags: tagLinks(noteTags),
          efforts: effortLinks(mergedEffortRows, knownEffortSlugs, effortLabels),
          equipment: equipmentLinks(mergedEquipmentRows, knownEquipmentSlugs, equipmentLabels),
          unrecognized: [],
          related,
          backlinks: backlinkNotes(notes, stampList, noteId),
        } satisfies NoteContextData
      })
      .then(next => {
        if (!cancelled && next) setResult({ key: identityKey, data: next })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [noteId, stampKey, effortSlug, identityKey, revision, catalogVersion, effortRevision, equipmentRevision])

  return useMemo(() => {
    if (liveContent === undefined || !effortsReady || !equipmentReady || !liveFacets.ready) {
      return stored
    }
    const liveLinks = liveFacetsToLinks(liveFacets, noteId)
    return {
      ...stored,
      tags: liveLinks.tags,
      efforts: liveLinks.efforts,
      equipment: liveLinks.equipment,
      unrecognized: liveLinks.unrecognized,
    }
  }, [liveContent, effortsReady, equipmentReady, liveFacets, noteId, stored])
}

// ── L2 registration ──────────────────────────────────────────────────────────

export type PartialNoteContextData = Pick<NoteContextData, 'efforts' | 'related' | 'backlinks'> &
  Partial<Pick<NoteContextData, 'collections' | 'pages' | 'tags' | 'equipment' | 'unrecognized'>>

export interface NoteContextSpecOptions {
  data: PartialNoteContextData
  /** Owning-list link ("Up") — first section when present. */
  up?: ContextNoteLink | null
  /** Provenance link for a stamped sourceId — section after Up when present. */
  source?: ContextNoteLink | null
  /** Label override for the `related` section (e.g. "Used in" on effort pages). */
  relatedLabel?: string
  /**
   * Calendar widget entry rendered right after Up/Source (journal and
   * notebook-date L2s); any renderable node (CalendarCard).
   */
  calendar?: ReactNode
  /**
   * Leading discovery sections (recent items, sibling lists) — placed after
   * Up/Source/calendar, before the relationship sections.
   */
  sections?: MenuSpec
  /** Trailing sections appended after the relationship sections (e.g.
   *  "recent efforts last"). */
  trailingSections?: MenuSpec
}

/**
 * Pure L2 spec builder so ordering stays testable.
 * De-duplicates `collections` and `pages` against `up` / `source` so a primary
 * container never renders twice in the same L2 panel.
 */
export function buildNoteContextSpec({
  data,
  up,
  source,
  relatedLabel = 'Related workouts',
  calendar,
  sections,
  trailingSections,
}: NoteContextSpecOptions): MenuSpec {
  const spec: MenuSpec = []
  const excludedUrls = new Set<string>(
    [up?.to, source?.to].filter((u): u is string => Boolean(u)),
  )

  const section = (id: string, label: string, items: readonly ContextNoteLink[] | undefined, dedupeContainers = false) => {
    if (!items || items.length === 0) return
    const filtered = dedupeContainers
      ? items.filter(item => !item.to || !excludedUrls.has(item.to))
      : items
    if (filtered.length === 0) return
    spec.push({
      kind: 'section',
      id,
      label,
      entries: filtered.map(item => ({
        kind: 'link' as const,
        id: `${id}:${item.id}`,
        label: item.title,
        ...(item.to ? { to: item.to } : {}),
        ...(item.onSelect ? { onSelect: item.onSelect } : {}),
        ...(item.badge ? { badge: item.badge } : {}),
        ...(item.filterTo ? { filterTo: item.filterTo } : {}),
        ...(item.filterLabel ? { filterLabel: item.filterLabel } : {}),
      })),
    })
  }

  section('note-context-up', 'Up', up ? [up] : [])
  section('note-context-source', 'Source', source ? [source] : [])
  if (calendar) spec.push({ kind: 'widget', id: 'note-context-calendar', render: () => calendar })
  if (sections) spec.push(...sections)
  section('note-context-collections', 'Collections', data.collections, true)
  section('note-context-pages', 'Pages', data.pages, true)
  section('note-context-tags', 'Tags', data.tags)
  section('note-context-efforts', 'Efforts', data.efforts)
  section('note-context-equipment', 'Equipment', data.equipment)
  section('note-context-unrecognized', 'Unrecognized', data.unrecognized)
  section('note-context-related', relatedLabel, data.related)
  section('note-context-backlinks', 'Journal copies', data.backlinks)
  if (trailingSections) spec.push(...trailingSections)
  return spec
}

export interface NoteContextNavProps extends NoteContextSpecOptions {}

/** Registers the note's relationships as the L2 sidebar content for the
 *  current route (replacing the listing panel). Renders nothing itself: the
 *  sidebar consumes the static MenuSpec. Links navigate to their canonical
 *  `to` — no history.back. */
export function NoteContextNav(props: NoteContextNavProps) {
  const { setContextNav } = useNav()
  const location = useLocation()
  const calendarRef = useRef(props.calendar)
  calendarRef.current = props.calendar
  const hasCalendar = Boolean(props.calendar)

  const spec = useMemo(
    () =>
      buildNoteContextSpec({
        ...props,
        calendar: hasCalendar ? <>{calendarRef.current}</> : undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.data, props.up, props.source, props.relatedLabel, hasCalendar, props.sections, props.trailingSections],
  )

  useEffect(() => {
    return () => {
      setContextNav(prev => (prev?.pathname === location.pathname ? undefined : prev))
    }
  }, [location.pathname, setContextNav])

  useEffect(() => {
    setContextNav({ pathname: location.pathname, spec })
  }, [spec, location.pathname, setContextNav])

  return null
}

// ── L2 calendars ─────────────────────────────────────────────────────────────

/** Local YYYY-MM-DD keys of notes that belong to the journal (or, with a
 *  slug, to that notebook) and carry a domain date — CalendarCard dots. */
function noteDates(notes: Note[], notebookSlug?: string): Set<string> {
  const keys = new Set<string>()
  for (const note of notes) {
    if (note.date === undefined) continue
    const wanted = notebookSlug === undefined ? 'notebook/journal' : `notebook/${notebookSlug}`
    if (note.notebookId !== wanted) continue
    keys.add(formatDateKey(new Date(note.date)))
  }
  return keys
}

/** Journal entry dates for the note L2 calendar ("journal calendar when
 *  applicable"). */
export function useJournalEntryDates(): Set<string> {
  const [dates, setDates] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let cancelled = false
    storageService.getAllNotes().then((notes) => {
      if (!cancelled) setDates(noteDates(notes))
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return dates
}

/** Dates with notes in one notebook — the notebook-date L2 calendar dots. */
export function useNotebookEntryDates(slug: string): Set<string> {
  const [dates, setDates] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let cancelled = false
    storageService.getAllNotes().then((notes) => {
      if (!cancelled) setDates(noteDates(notes, slug))
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug])
  return dates
}
