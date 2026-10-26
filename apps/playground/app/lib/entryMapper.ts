/**
 * toEntry — the pure mapper from the engine's `Note[]` to the Library's
 * `Entry[]`. This is the single place that touches `sourceId` discrimination
 * (per the spec); the rest of the Library never inspects `Note.sourceId`.
 *
 * Entry shape is locked by #807: identity = `{ sourceNotebook, sourceNote }`,
 * kind = `Note` plus execution/effort/dashboard/equipment specializations.
 * Every notebook member — journal note, corpus note, dated program post —
 * is a note (ticket 05); notes carry a journal-date when they have one.
 */
import type { BlockIndexRow, Note } from '@/types/storage'
import type { IEffort, RowsRun, RowsQueryResult } from '@bitcobblers/wod-wiki-wql'
import { isNoteEditable, notebookOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql'
import type { NotePlacement } from '@bitcobblers/wod-wiki-core'
import { formatDateKey } from '../services/dateUtils'
import { parseNoteId } from '@/lib/noteIdentity'

/** Presentation kinds. Corpus notes and dated posts are notes in a
 *  notebook (ticket 05) — there is no separate session/post kind; the
 *  notebook the note belongs to (`notebookId`) and its corpus route carry
 *  the distinction the old kinds encoded. */
export type EntryKind = 'note' | 'result' | 'segment' | 'effort' | 'event' | 'dashboard' | 'equipment' | 'tag'

/** Block-level payload on an Entry produced from a :block hit (#855):
 *  the card shows the parent note's identity plus the block's own type and
 *  a content preview, so count and presentation describe the same entity. */
export interface EntryBlock {
  /** Section id of the block within its note — the open-at-block anchor. */
  blockId: string
  dataType: string
  /** Up to 3 non-empty preview lines from the block's raw content. */
  preview: string[]
}

/** Payload carried when an Entry represents an executed session or segment */
export interface EntryExecutionData {
  resultId: string
  noteId: string
  timestamp: number
  outputType: string
  effortSlug?: string
  elapsedMs?: number
  reps?: number
  loadLbs?: number
  distanceMeters?: number
  tis?: number
  segmentCount?: number
  events?: EventRecord[]
  metrics?: StoredOutputStatement['metrics']
}

/** Payload carried when an Entry represents a registered effort */
export interface EntryEffortData {
  slug: string
  label: string
  discipline?: string
  met?: number
  intensityTier?: string
  aliases?: string[]
  registrySource?: string
}

export interface Entry {
  id: string
  kind: EntryKind
  sourceNotebook: string
  sourceNote: string
  /** Original Note.sourceId (undefined for journal notes). Carried on the
   *  Entry so the Library can pass it through to derived records (e.g. the
   *  `sourceId` of a cloned "Add to today" journal note). The Library never
   *  inspects this for kind classification; that's the mapper's job. */
  sourceId?: string
  title: string
  /** YYYY-MM-DD for date-grouped stream; null for undated shelf sessions & efforts. */
  date: string | null
  /** Creation instant — the chronological tiebreaker for undated entries (feed). */
  createdAt?: number
  subtitle?: string
  detail?: string
  tags?: string[]
  /** Preview lines from the authored Note source. */
  excerpt?: string[]
  /** First validated workout occurrence and its unfenced Run source. */
  wodBlock?: { blockId: string; blockVersion: number; blockContentId: string; content: string }
  blockContentId?: string
  /** Set when the Entry represents one block (:block), not a whole note. */
  block?: EntryBlock
  execution?: EntryExecutionData
  effort?: EntryEffortData
  /** The note's page id — the Page UUID (hydrated from page_notes by the
   *  search layer). Route decisions NEVER use this; Open uses
   *  {@link Entry.pageSlug}. */
  pageId?: string
  /** Named Page.slug — the /p/:slug route slug. Sources: projected note
   *  slug fields at map time, page_notes hydration in entrySearch. */
  pageSlug?: string
  /** Every page the note is placed on, in canonical placement order —
   *  hydrated from the `page_notes` junction in entrySearch. `pageId` and
   *  `pageSlug` above are the deterministic primary projections of this
   *  list, never the membership itself. */
  placements?: NotePlacement[]
  /** Original Note.sourcePath (e.g. `markdown/notebooks/girls/fran.md`) —
   *  route data for corpus surfaces (dashboards/efforts/feeds), never a title. */
  sourcePath?: string
  /** Executor-exact `Note.type` — what the WQL `type:` / `page:` / source
   *  playground-legacy predicates match. Distinct from the presentation
   *  `kind` (a notebook page maps to kind 'note', never a type value). */
  noteType?: string
  /** Canonical `notebook/{slug}` identifier ('notebook/journal', 'notebook/playground', 'notebook/guides', etc.). */
  notebookId?: string
  /** Application-level editability flag: true only for user-created notes (`seedOrigin !== 'seed'`). */
  editable?: boolean
  /** Original Note.id — the stored identity `note:` filters match through
   *  this field (Entry.id keeps the note id verbatim). */
  noteId?: string
  /** The note's junction tags WITH their configured type — the property
   *  plane `by {<type>}` grouping resolves against (domain, equipment, any
   *  custom tag type). Flat `tags` above stays label-only. */
  typedTags?: Array<{ label: string; type?: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A route slug: a non-empty string that is not a storage UUID. */
function namedSlug(value: unknown): string | undefined {
  return typeof value === 'string' && value && !UUID_RE.test(value) ? value : undefined
}

function isNotebookNote(note: Note): boolean {
  return !!note.sourceId?.startsWith('notebook:')
    || note.sourcePath?.startsWith('markdown/notebooks/') === true
}

/** Dashboard note: typed (post-repair/new vault dashboards), sourceId-stamped,
 *  or a legacy sourceless seed row addressed by its corpus path. */
function isDashboardNote(note: Note): boolean {
  return note.type === 'dashboard'
    || note.sourceId === 'dashboards'
    || note.sourcePath?.startsWith('markdown/dashboards/') === true
}

/** Effort-corpus note (the note twin of the IEffort registry entry). */
function isEffortNote(note: Note): boolean {
  return note.sourceId === 'efforts' || note.sourcePath?.startsWith('markdown/efforts/') === true
}

/** Equipment note (gear definitions; new source — legacy rows are sourceless). */
function isEquipmentNote(note: Note): boolean {
  return note.sourceId === 'equipment' || note.sourcePath?.startsWith('markdown/equipment/') === true
}

/** Synthetic tag-plane row (`:tag{}`) — the tag catalogue record rendered as
 *  one note-shaped result (runFindTag). Identity is `tag/{type}/{label}`;
 *  the row carries what the tag contributes in its body. */
function isTagRow(note: Note): boolean {
  return note.type === 'tag' && note.id.startsWith('tag/')
}

/** The tag row's `/t/:type/:tag` segments — [type, label]. */
export function tagRowSegments(note: Pick<Note, 'id'>): { type: string; label: string } | undefined {
  const match = /^tag\/([^/]+)\/(.+)$/.exec(note.id)
  return match ? { type: match[1]!, label: match[2]! } : undefined
}

/** Slug of a corpus note — `<slug>.md` (dashboards/equipment) or
 *  `<discipline>/<slug>.md` (efforts); `undefined` for UUID-keyed rows. */
function corpusSlug(note: Note, depth: 1 | 2): string | undefined {
  const stem = note.sourcePath?.replace(/^markdown\/[^/]+\//, '').replace(/\.md$/, '')
  if (!stem) return undefined
  const segs = stem.split('/')
  return segs.length === depth ? segs[depth - 1] : undefined
}

/** Notebook route (slug/item) from the sourceId declaration
 *  (`notebook:<slug>[/<item>]`, mirroring the executor's route derivation)
 *  with the imported-note fallback to the corpus path
 *  `markdown/notebooks/<slug>/<item>.md` (README = landing). Never derived
 *  from the note UUID or title. */
function notebookRoute(note: Note): { slug: string; item: string } {
  const sourceId = note.sourceId
  if (sourceId?.startsWith('notebook:')) {
    const route = sourceId.slice('notebook:'.length)
    if (route && route !== '_root') {
      const slash = route.indexOf('/')
      return slash === -1
        ? { slug: route, item: '' }
        : { slug: route.slice(0, slash), item: route.slice(slash + 1) }
    }
  }
  const m = /^markdown\/notebooks\/([^/]+)\/(.+)\.md$/.exec(note.sourcePath ?? '')
  if (m) {
    return { slug: m[1]!, item: m[2]!.toLowerCase() === 'readme' ? '' : m[2]! }
  }
  // Legacy path-keyed ids (`<slug>/<item>`) predate sourceId. UUID ids
  // carry no route — degrade to the journal note editor.
  const stem = note.id
  if (UUID_RE.test(stem)) return { slug: '', item: '' }
  const [slug, ...rest] = stem.split('/')
  return { slug: slug!, item: rest.join('/') }
}

/** Playground entries: the intake convention is sourceId 'playground'; legacy
 *  playground pages carry type 'playground' (or a `playground/` composite id)
 *  with no sourceId. */
function isPlaygroundNote(note: Note): boolean {
  return note.sourceId === 'playground' || note.type === 'playground' || note.id.startsWith('playground/')
}

/** Route-visible name of a playground note — the `/playground/:id` segment
 *  (the id itself for UUID-keyed notes). */
export function playgroundRouteName(note: Pick<Note, 'id'>): string {
  return note.id.startsWith('playground/') ? note.id.slice('playground/'.length) : note.id
}

export function toEntry(note: Note): Entry {
  // Executor-exact metadata (the fields WQL note-plane filters match) rides
  // on every mapped entry so facet consumers never re-derive presentation
  // approximations. One wrap — the branch logic below stays untouched.
  return {
    ...toEntryBase(note),
    noteType: note.type,
    notebookId: notebookOfItem(note),
    editable: isNoteEditable(note, notebookOriginOfItem(note)),
    noteId: note.id,
  }
}

function toEntryBase(note: Note): Entry {
  const id = note.id
  const title = note.title
  const tags = note.tags && note.tags.length > 0 ? note.tags : undefined

  if (isPlaygroundNote(note)) {
    return {
      id,
      kind: 'note',
      sourceNotebook: 'playground',
      sourceNote: playgroundRouteName(note),
      sourceId: note.sourceId,
      title,
      date: null,
      createdAt: note.createdAt,
      ...(tags ? { tags } : {}),
    }
  }

  if (isNotebookNote(note)) {
    // Route identity (slug/item) comes from the sourceId route or corpus
    // path — never from a UUID noteId. Dated items carry their date as the
    // item's first segment (`<date>/<item>`).
    const { slug, item } = notebookRoute(note)
    const isLanding = !item
    const segs = item.split('/')
    const date = segs.length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(segs[0]!) ? segs[0]! : null
    return {
      id,
      kind: 'note',
      sourceNotebook: slug,
      sourceNote: isLanding ? '' : item,
      sourceId: note.sourceId,
      sourcePath: note.sourcePath,
      title,
      date: date ?? (note.date ? formatDateKey(new Date(note.date)) : null),
      createdAt: note.createdAt,
      subtitle: slug,
      ...(tags ? { tags } : {}),
    }
  }

  // Dashboard note — its own kind so All-view rows carry the dashboard icon
  // and open at /d/<slug> instead of masquerading as journal entries.
  if (isDashboardNote(note)) {
    const slug = corpusSlug(note, 1) ?? id
    return {
      id,
      kind: 'dashboard',
      sourceNotebook: 'dashboards',
      sourceNote: slug,
      sourceId: note.sourceId,
      sourcePath: note.sourcePath,
      title,
      date: null,
      createdAt: note.createdAt,
      subtitle: 'dashboards',
      ...(tags ? { tags } : {}),
    }
  }

  // Effort-corpus note — the note twin of the registry entry; opens at
  // /e/<slug> like a registry effort. Never classified as journal.
  if (isEffortNote(note)) {
    const slug = corpusSlug(note, 2) ?? id
    const discipline = note.sourcePath?.match(/^markdown\/efforts\/([^/]+)\//)?.[1]
    return {
      id,
      kind: 'effort',
      sourceNotebook: 'efforts',
      sourceNote: slug,
      sourceId: note.sourceId,
      sourcePath: note.sourcePath,
      title,
      date: null,
      createdAt: note.createdAt,
      subtitle: discipline,
      effort: { slug },
      ...(tags ? { tags } : {}),
    }
  }

  // Equipment note — gear definitions; opens in the canonical note editor.
  if (isEquipmentNote(note)) {
    return {
      id,
      kind: 'equipment',
      sourceNotebook: 'equipment',
      sourceNote: corpusSlug(note, 1) ?? id,
      sourceId: note.sourceId,
      sourcePath: note.sourcePath,
      title,
      date: null,
      createdAt: note.createdAt,
      subtitle: 'equipment',
      ...(tags ? { tags } : {}),
    }
  }

  // Synthetic tag-plane row — one tag per row; the contribution summary the
  // executor wrote into the body is what the row shows it carries.
  if (isTagRow(note)) {
    const segments = tagRowSegments(note)
    return {
      id,
      kind: 'tag',
      sourceNotebook: 'tags',
      sourceNote: segments?.label ?? title,
      title: title || segments?.label || id,
      date: null,
      createdAt: note.createdAt,
      subtitle: ('tagType' in note && typeof note.tagType === 'string' ? note.tagType : undefined) ?? segments?.type,
      detail: note.rawContent || undefined,
      ...(tags ? { tags } : {}),
    }
  }

  // Guide (canvas-corpus) note: sourceId `guides:<declared-route>` — the
  // /page/ slug (pageSlug) is the declared route minus the leading slash and
  // the page/ prefix (guides declare /page/guide-*); sourceNote stays the
  // declared path.
  if (note.sourceId?.startsWith('guides:')) {
    const declared = note.sourceId.slice('guides:'.length) || id
    return {
      id,
      kind: 'note',
      sourceNotebook: 'guides',
      sourceNote: declared,
      sourceId: note.sourceId,
      sourcePath: note.sourcePath,
      pageSlug: namedSlug(declared.replace(/^\//, '').replace(/^page\//, '')),
      title,
      date: null,
      createdAt: note.createdAt,
      ...(tags ? { tags } : {}),
    }
  }

  // Journal note
  let journalDate: string | null = null
  if ('journalDate' in note && typeof note.journalDate === 'string') {
    journalDate = note.journalDate
  } else if ('date' in note && typeof note.date === 'string') {
    journalDate = note.date
  } else if ('targetDate' in note && Boolean(note.targetDate) && (typeof note.targetDate === 'number' || typeof note.targetDate === 'string')) {
    journalDate = formatDateKey(new Date(note.targetDate))
  } else if (note.createdAt) {
    journalDate = formatDateKey(new Date(note.createdAt))
  }
  return {
    id,
    kind: 'note',
    sourceNotebook: 'journal',
    sourceNote: id,
    sourceId: note.sourceId,
    sourcePath: note.sourcePath,
    pageId: 'pageId' in note && typeof note.pageId === 'string' ? note.pageId : undefined,
    pageSlug: 'slug' in note ? namedSlug(note.slug) : undefined,
    title,
    date: journalDate,
    createdAt: note.createdAt,
    ...(tags ? { tags } : {}),
  }
}

/** Synthesize a minimal Note for a block hit — the input to {@link toEntry}
 *  for block-level results. Lives here so entryMapper stays the single place
 *  that touches sourceId classification. */
export function noteFromBlock(block: {
  noteId: string
  noteTitle: string
  createdAt: number
  sourceId?: string
  sourcePath?: string
}): Note {
  return {
    id: block.noteId,
    title: block.noteTitle,
    createdAt: block.createdAt,
    type: 'note',
    sourceId: block.sourceId,
    sourcePath: block.sourcePath,
    rawContent: '',
    sourceRevision: 1,
    blocks: {},
  }
}

const PREVIEW_LINE_CAP = 3
const PREVIEW_CHAR_CAP = 120

/** First non-empty lines of a block's raw content, each truncated — the
 *  card preview that makes a block hit inspectable without opening it. */
export function blockPreview(rawContent: string): string[] {
  return rawContent
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, PREVIEW_LINE_CAP)
    .map(line => (line.length > PREVIEW_CHAR_CAP ? `${line.slice(0, PREVIEW_CHAR_CAP - 1)}…` : line))
}

/**
 * Map one :block hit to an Entry (#855). The Entry keeps the PARENT
 * note's identity (id, kind, notebook, date — Open/Add-to-today act on the
 * parent) and carries the block's own type/preview/anchor on `entry.block`.
 */
export function blockToEntry(block: BlockIndexRow): Entry {
  const base = toEntry(noteFromBlock(block))
  return {
    ...base,
    blockContentId: block.blockContentId ?? base.blockContentId,
    block: {
      blockId: block.blockId,
      dataType: block.dataType,
      preview: blockPreview(block.rawContent),
    },
  }
}

export function formatEffortName(slug: string): string {
  if (!slug) return ''
  return slug
    .split('-')
    .map(word => {
      const lower = word.toLowerCase()
      if (lower === 'c2b') return 'C2B'
      if (lower === 't2b') return 'T2B'
      if (lower === 'ghd') return 'GHD'
      if (lower === 'hspu') return 'HSPU'
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  if (mins >= 60) {
    const hours = Math.floor(mins / 60)
    const remMins = mins % 60
    return `${hours}:${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function deriveTitleFromNoteId(noteId: string): string {
  if (!noteId) return 'Workout Session'
  const ref = parseNoteId(noteId)
  if (ref.kind === 'journal') {
    return ref.id ? `Journal: ${ref.id}` : 'Journal Entry'
  }
  if (ref.kind === 'workout') {
    return formatEffortName(ref.id) || ref.id
  }
  return ref.id ? formatEffortName(ref.id) : noteId
}

export function effortToEntry(effort: IEffort): Entry {
  const discipline = effort.baseAttributes?.discipline
  const met = effort.baseAttributes?.met != null ? `MET ${effort.baseAttributes.met.toFixed(1)}` : undefined
  const intensity = effort.baseAttributes?.intensityTier
  const subtitleParts = [discipline, met, intensity].filter(Boolean)

  return {
    id: effort.slug,
    kind: 'effort',
    sourceNotebook: effort.registrySource ?? 'effort',
    sourceNote: effort.slug,
    title: effort.label,
    date: null,
    subtitle: subtitleParts.join(' • '),
    detail: effort.aliases && effort.aliases.length > 0 ? `Aliases: ${effort.aliases.join(', ')}` : undefined,
    effort: {
      slug: effort.slug,
      label: effort.label,
      discipline: effort.baseAttributes?.discipline,
      met: effort.baseAttributes?.met,
      intensityTier: effort.baseAttributes?.intensityTier,
      aliases: effort.aliases,
      registrySource: effort.registrySource,
    },
  }
}
interface MetricLike {
  type?: string
  name?: string
  value?: unknown
}

function classifyMetric(m: MetricLike) {
  const type = (m.type ?? '').toLowerCase()
  const name = ('name' in m && typeof m.name === 'string' ? m.name : '').toLowerCase()
  const val = typeof m.value === 'number' ? m.value : Number(m.value)
  if (!Number.isFinite(val)) return null

  if (type === 'rep' || name === 'reps' || name === 'rep') return { kind: 'rep' as const, val }
  if (type === 'weight' || type === 'load' || name === 'load' || name === 'weight' || name === 'volume') return { kind: 'load' as const, val }
  if (type === 'distance' || name === 'distance') return { kind: 'distance' as const, val }
  if (type === 'tis' || name === 'tis') return { kind: 'tis' as const, val }
  if (type === 'duration' || name === 'duration') return { kind: 'duration' as const, val }
  return null
}

function extractRunMetrics(run: RowsRun) {
  let minStart = Infinity
  let maxEnd = -Infinity
  let totalReps = 0
  let totalLoad = 0
  let maxTis = 0
  let segmentCount = 0
  const effortSlugs = new Set<string>()

  for (const event of run.events) {
    if (event.outputType === 'segment') {
      segmentCount++
    }
    if (event.effortSlug) {
      effortSlugs.add(event.effortSlug)
    }
    if (event.timeSpan?.started != null) {
      if (event.timeSpan.started < minStart) minStart = event.timeSpan.started
      if (event.timeSpan.ended != null && event.timeSpan.ended > maxEnd) {
        maxEnd = event.timeSpan.ended
      }
    }
    if (Array.isArray(event.metrics)) {
      for (const m of event.metrics) {
        const classified = classifyMetric(m)
        if (!classified) continue
        if (classified.kind === 'rep') totalReps += classified.val
        else if (classified.kind === 'load') totalLoad += classified.val
        else if (classified.kind === 'tis' && classified.val > maxTis) maxTis = classified.val
      }
    }
  }
  const elapsedMs = (Number.isFinite(minStart) && Number.isFinite(maxEnd) && maxEnd > minStart)
    ? maxEnd - minStart
    : undefined

  return {
    elapsedMs,
    reps: totalReps > 0 ? totalReps : undefined,
    loadLbs: totalLoad > 0 ? totalLoad : undefined,
    tis: maxTis > 0 ? maxTis : undefined,
    segmentCount: segmentCount > 0 ? segmentCount : undefined,
    effortSlugs: Array.from(effortSlugs),
  }
}

export function rowsRunToEntry(run: RowsRun, options?: { noteTitle?: string }): Entry {
  const metrics = extractRunMetrics(run)
  const subtitleParts: string[] = []

  if (metrics.elapsedMs != null) {
    subtitleParts.push(formatDuration(metrics.elapsedMs))
  }
  if (metrics.tis != null) {
    subtitleParts.push(`TIS ${metrics.tis.toFixed(1)}`)
  }
  if (metrics.loadLbs != null) {
    subtitleParts.push(`Volume: ${metrics.loadLbs.toLocaleString()} lbs`)
  }
  if (metrics.reps != null) {
    subtitleParts.push(`${metrics.reps} reps`)
  }
  if (metrics.segmentCount != null) {
    subtitleParts.push(`${metrics.segmentCount} splits`)
  }

  const movements = metrics.effortSlugs.map(formatEffortName)
  const dateStr = formatDateKey(new Date(run.timestamp))
  const blockContentId = run.events.find(e => !!e.blockContentId)?.blockContentId

  return {
    id: run.resultId,
    kind: 'result',
    sourceNotebook: 'results',
    sourceNote: run.resultId,
    title: options?.noteTitle ?? deriveTitleFromNoteId(run.noteId),
    date: dateStr,
    blockContentId,
    subtitle: subtitleParts.join(' • '),
    detail: movements.length > 0 ? movements.join(', ') : undefined,
    execution: {
      resultId: run.resultId,
      noteId: run.noteId,
      timestamp: run.timestamp,
      outputType: 'all',
      elapsedMs: metrics.elapsedMs,
      reps: metrics.reps,
      loadLbs: metrics.loadLbs,
      tis: metrics.tis,
      segmentCount: metrics.segmentCount,
      events: run.events,
    },
  }
}

export function unifiedEventToEntry(
  event: EventRecord,
  options?: { index?: number },
): Entry {
  let elapsedMs: number | undefined
  if (event.timeSpan?.started != null && event.timeSpan?.ended != null) {
    elapsedMs = event.timeSpan.ended - event.timeSpan.started
  }
  let reps: number | undefined
  let loadLbs: number | undefined
  let distanceMeters: number | undefined
  let tis: number | undefined

  if (Array.isArray(event.metrics)) {
    for (const m of event.metrics) {
      const classified = classifyMetric(m)
      if (!classified) continue
      if (classified.kind === 'rep') reps = classified.val
      else if (classified.kind === 'load') loadLbs = classified.val
      else if (classified.kind === 'distance') distanceMeters = classified.val
      else if (classified.kind === 'tis') tis = classified.val
      else if (classified.kind === 'duration' && !elapsedMs) elapsedMs = classified.val
    }
  }

  const kind: EntryKind = event.outputType === 'segment' ? 'segment' : 'event'
  const index = options?.index ?? 0
  const title = event.effortSlug
    ? formatEffortName(event.effortSlug)
    : event.outputType === 'segment'
      ? `Round ${index + 1}`
      : `${event.outputType.charAt(0).toUpperCase() + event.outputType.slice(1)} ${index + 1}`

  const subtitleParts: string[] = []
  if (elapsedMs != null) {
    subtitleParts.push(formatDuration(elapsedMs))
  }
  if (reps != null && loadLbs != null) {
    subtitleParts.push(`${reps} reps @ ${loadLbs} lbs`)
  } else if (reps != null) {
    subtitleParts.push(`${reps} reps`)
  } else if (loadLbs != null) {
    subtitleParts.push(`${loadLbs} lbs`)
  }
  if (distanceMeters != null) {
    subtitleParts.push(`${distanceMeters}m`)
  }
  if (tis != null) {
    subtitleParts.push(`TIS ${tis.toFixed(1)}`)
  }

  const dateStr = formatDateKey(new Date(event.timestamp))

  return {
    id: event.id,
    kind,
    sourceNotebook: 'results',
    sourceNote: event.id,
    title,
    date: dateStr,
    blockContentId: event.blockContentId,
    subtitle: subtitleParts.join(' • '),
    detail: event.effortSlug ? formatEffortName(event.effortSlug) : undefined,
    execution: {
      resultId: event.resultId,
      noteId: event.noteId,
      timestamp: event.timestamp,
      outputType: event.outputType,
      effortSlug: event.effortSlug,
      elapsedMs,
      reps,
      loadLbs,
      distanceMeters,
      tis,
      metrics: event.metrics,
    },
  }
}

export function rowsQueryResultToEntries(
  result: RowsQueryResult,
  options?: { noteTitles?: Map<string, string> },
): Entry[] {
  if (!result || result.error || !result.runs) return []

  const planeFilter = result.parsed?.filters?.find(f => f.key === 'plane' && !f.negate);
  const target = (result.parsed as any)?.outputType ?? planeFilter?.values[0]?.value;

  if (target === 'segment') {
    const entries: Entry[] = []
    for (const run of result.runs) {
      let idx = 0
      for (const event of run.events) {
        if (event.outputType === 'segment') {
          entries.push(unifiedEventToEntry(event, { index: idx++ }))
        }
      }
    }
    return entries
  }

  if (target && target !== 'all') {
    const entries: Entry[] = []
    for (const run of result.runs) {
      let idx = 0
      for (const event of run.events) {
        if (event.outputType === target) {
          entries.push(unifiedEventToEntry(event, { index: idx++ }))
        }
      }
    }
    return entries
  }

  return result.runs.map(run =>
    rowsRunToEntry(run, { noteTitle: options?.noteTitles?.get(run.noteId) }),
  )
}
