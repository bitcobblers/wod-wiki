import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SyntheticEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BeakerIcon,
  BookOpenIcon,
  DocumentTextIcon,
  SparklesIcon,
  TagIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid'
import { CalendarPlus, ChevronDown, Loader2, Play, Search } from 'lucide-react'
import { EditorDialog, WqlComposer } from '@bitcobblers/wod-wiki-ui'
import { effortToDocument, tagRecordToDocument } from '@bitcobblers/wod-wiki-lang'
import {
  isSystemReadOnlyNotebook,
  notebookSlugFromId,
  resolveNoteOwnership,
  type Note,
  type Tag,
} from '@bitcobblers/wod-wiki-core'
import { parseRemoteNoteId } from '@bitcobblers/wod-wiki-engine'
import { notebookOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql'
import { isFeedSubscribed } from '@/services/feed/feedSubscriptions'
import {
  lookupRemoteRecord,
  playgroundFeedCatalogStore,
  resolveRemoteWorkout,
} from '@/services/feed/feedCatalog'
import { resolveFeedDisplayLabel } from '@/components/molecules/PublicationPill'
import { createJournalNoteFromWorkout } from '../../../services/journalWorkout'
import { startEntryRun } from '../../../lib/entryRun'
import { entryOpenHref } from '../../../lib/entryActions'
import type { Entry } from '../../../lib/entryMapper'
import { dayPath } from '../../../lib/routes'
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { TEST_IDS } from '@/lib/testIds'
import { storageService } from '@/services/storage'
import { notebookService } from '@/services/NotebookService'
import { commitReferenceNote } from '@/repositories/referenceNotes'
import { getAppEffortRegistry, hydrateAppEffortRegistry } from '@/services/effortRegistry'
import { getAppEquipmentRegistry, hydrateAppEquipmentRegistry } from '@/services/equipmentRegistry'
import { getScriptNotebooks, type ScriptNotebook } from '@/repositories/script-notebooks'
import type { HistoryRecord } from '@/types/history'
import type { Notebook } from '@/types/notebook'
import { formatDateHeader, localDateKey } from '@/lib/dateFormat'
import { useOptionalEffortRegistry } from '../../../contexts/EffortRegistryContext'
import { useOptionalEquipmentRegistry } from '../../../contexts/EquipmentRegistryContext'
import {
  effortPath,
  equipmentPath,
  notePath,
  notebookItemPath,
  notebookPath,
  playgroundPath,
  tagPath,
} from '../../../lib/routes'
import { blankEquipmentDocument } from '../../../hooks/useEquipmentContent'
import { createPlaygroundPage } from '../../../services/createPlaygroundPage'
import { getTodayDateKey } from '../../../services/dateUtils'
import { parseJournalDate } from '../../../services/parseJournalDate'
import { journalNotes, type CreateJournalNoteInput } from '../../../services/journalNotes'
import { DEFAULT_PLAYGROUND_CONTENT } from '../../../templates/defaultPlaygroundContent'

export type ResourceKind = 'journal' | 'note' | 'playground' | 'notebook' | 'page' | 'effort' | 'equipment' | 'tag'
export type ComposerKind = 'note' | 'playground' | 'notebook' | 'effort' | 'equipment' | 'tag'
export type StartMode = 'blank' | 'notebook' | 'source'

export interface CreateJournalNoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselected resource kind; defaults to 'journal'. */
  defaultKind?: ResourceKind
  /** Preselected journal date (YYYY-MM-DD); defaults to today. */
  defaultDate?: string
  /** Preselected target notebook slug (e.g. when inside /notebook/:slug). */
  defaultNotebookSlug?: string
  /** Preselected mode; defaults to 'blank'. */
  defaultMode?: StartMode
  /** Preselected dialog tab inside Note creation ('write' vs 'pick'); defaults to 'write'. */
  defaultNoteMode?: 'write' | 'pick'
  /** Called with the created entry after a successful note create. */
  onCreated?: (entry: HistoryRecord) => void
}

const WORKOUT_FENCE_RE = /```(?:wod|time|log|whiteboard)/i

export interface TemplateOption {
  key: string
  label: string
  group: string
  groupKey?: string
  categories?: readonly string[]
  isTemplateTagged?: boolean
}

function isResultsCategory(categories?: readonly string[], slug?: string, path?: string): boolean {
  if (categories?.some((c) => c.toLowerCase() === 'results')) return true
  if (slug && (slug === 'results' || slug === 'athletics-results')) return true
  if (path && (path.startsWith('markdown/results/') || path.includes('/athletics-results/'))) return true
  return false
}

/** Curate template dropdown options: exclude results notebooks, cap unsearched items per group, and keep full search intact. */
export function curateTemplateOptions(
  allOptions: readonly TemplateOption[],
  rawQuery: string,
  maxPerGroup = 3,
  maxUnsearched = 30,
): { visibleTemplateOptions: TemplateOption[]; truncatedMatches: number } {
  const curated = allOptions.filter(
    (opt) => !isResultsCategory(opt.categories, opt.groupKey, opt.key),
  )
  const q = rawQuery.trim().toLowerCase()
  if (!q) {
    const blank = curated.find((o) => o.key === '') ?? curated[0]
    const rest = curated.filter((o) => o !== blank)
    const userAndTagged = rest
      .filter((o) => o.group === 'Your Notebook Notes' || o.isTemplateTagged)
      .slice(0, 12)
    const seen = new Set<string>([...(blank ? [blank.key] : []), ...userAndTagged.map((o) => o.key)])
    const perGroupCount = new Map<string, number>()
    const featured: TemplateOption[] = []
    for (const opt of rest) {
      if (seen.has(opt.key)) continue
      const gKey = opt.groupKey ?? opt.group
      const count = perGroupCount.get(gKey) ?? 0
      if (count >= maxPerGroup) continue
      perGroupCount.set(gKey, count + 1)
      seen.add(opt.key)
      featured.push(opt)
      if ((blank ? 1 : 0) + userAndTagged.length + featured.length >= maxUnsearched) break
    }
    const visible = [...(blank ? [blank] : []), ...userAndTagged, ...featured]
    return {
      visibleTemplateOptions: visible,
      truncatedMatches: Math.max(0, curated.length - visible.length),
    }
  }
  const matches = curated.filter(
    (opt) => opt.label.toLowerCase().includes(q) || opt.group.toLowerCase().includes(q),
  )
  const MAX_RESULTS = 50
  return {
    visibleTemplateOptions: matches.slice(0, MAX_RESULTS),
    truncatedMatches: Math.max(0, matches.length - MAX_RESULTS),
  }
}

export interface CuratablePickerItem {
  id: string
  isMine: boolean
  notebookSlug: string
  categories?: readonly string[]
  rawContent?: string
  isRemotePreview?: boolean
  searchText: string
}

/** Curate Pick / Log workout items: require a workout fence when content is available, exclude results, cap per-notebook when unsearched. */
export function curatePickerWorkouts<T extends CuratablePickerItem>(
  items: readonly T[],
  rawQuery: string,
  maxPerGroup = 4,
  maxUnsearched = 24,
): T[] {
  const eligible = items.filter((it) => {
    if (isResultsCategory(it.categories, it.notebookSlug)) return false
    if (it.rawContent !== undefined) return WORKOUT_FENCE_RE.test(it.rawContent)
    return Boolean(it.isRemotePreview)
  })
  const q = rawQuery.trim().toLowerCase()
  if (q) {
    return eligible.filter((it) => it.searchText.includes(q))
  }
  const picked: T[] = []
  const perGroup = new Map<string, number>()
  for (const it of eligible) {
    if (it.isMine) {
      picked.push(it)
      continue
    }
    const count = perGroup.get(it.notebookSlug) ?? 0
    if (count >= maxPerGroup) continue
    perGroup.set(it.notebookSlug, count + 1)
    picked.push(it)
    if (picked.length >= maxUnsearched) break
  }
  return picked
}

const NOTEBOOK_ICONS = ['📓', '🏋️', '🔥', '💪', '⭐', '🎯', '🏃', '🧘', '🥊', '🚴']

interface KindOption {
  kind: ComposerKind
  label: string
  subtitle: string
  group: 'workspace' | 'catalog'
  icon: ComponentType<{ className?: string }>
}

const KIND_OPTIONS: KindOption[] = [
  { kind: 'note', label: 'Note', subtitle: 'Journal, notebook, or page', group: 'workspace', icon: DocumentTextIcon },
  { kind: 'playground', label: 'Playground', subtitle: 'Scratchpad timer session', group: 'workspace', icon: BeakerIcon },
  { kind: 'notebook', label: 'Notebook', subtitle: 'Collection of notes', group: 'workspace', icon: BookOpenIcon },
  { kind: 'effort', label: 'Effort', subtitle: 'Movement definition', group: 'catalog', icon: SparklesIcon },
  { kind: 'equipment', label: 'Equipment', subtitle: 'Gear definition', group: 'catalog', icon: WrenchScrewdriverIcon },
  { kind: 'tag', label: 'Tag', subtitle: 'Reusable script contribution', group: 'catalog', icon: TagIcon },
]

export function slugifyRoute(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toComposerKind(kind: ResourceKind): ComposerKind {
  if (kind === 'journal' || kind === 'note' || kind === 'page') return 'note'
  return kind
}

interface NotebookNoteChoice {
  id: string
  title: string
  rawContent: string
  tags: string[]
}

interface SourceState {
  notebooks: ScriptNotebook[]
  /** Exact Note.sourcePath → note id, from raw storage rows. */
  sourceIdByPath: Record<string, string>
}

const fieldClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function CreateJournalNoteDialog({
  open,
  onOpenChange,
  defaultKind = 'journal',
  defaultDate,
  defaultNotebookSlug,
  defaultMode: _defaultMode = 'blank',
  defaultNoteMode = 'write',
  onCreated,
}: CreateJournalNoteDialogProps) {
  const navigate = useNavigate()
  // WW-035: the new effort/equipment note lands in storage via
  // commitReferenceNote, but the destination /effort/:slug page reads the
  // in-memory registry — re-hydrate it before navigating so the fresh
  // definition resolves immediately instead of flashing not-found.
  const effortRegistry = useOptionalEffortRegistry()
  const equipmentRegistry = useOptionalEquipmentRegistry()
  const refreshEffortRegistry = useCallback(
    () => (effortRegistry ? effortRegistry.refresh() : hydrateAppEffortRegistry(getAppEffortRegistry())),
    [effortRegistry],
  )
  const refreshEquipmentRegistry = useCallback(
    () => (equipmentRegistry ? equipmentRegistry.refresh() : hydrateAppEquipmentRegistry(getAppEquipmentRegistry())),
    [equipmentRegistry],
  )
  const [kind, setKind] = useState<ComposerKind>(() => toComposerKind(defaultKind))
  const [date, setDate] = useState(() => getTodayDateKey())
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [description, setDescription] = useState('')
  const [notebookIcon, setNotebookIcon] = useState('📓')
  const [creating, setCreating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [noteMode, setNoteMode] = useState<'write' | 'pick'>(defaultNoteMode)
  const [advancedOpen, setAdvancedOpen] = useState(defaultKind === 'page')
  const [workoutSearchQuery, setWorkoutSearchQuery] = useState('')
  const [myWorkoutNotes, setMyWorkoutNotes] = useState<Note[] | null>(null)
  const [remoteFeedWorkouts, setRemoteFeedWorkouts] = useState<
    Array<{ nbName: string; nbSlug: string; feedId: string; categories?: string[]; note: Note }>
  >([])
  const [pickerBusyId, setPickerBusyId] = useState<string | null>(null)
  const [pickerError, setPickerError] = useState<string | null>(null)

  // Optional Page route (/page/<slug>) — can be attached to any note being created.
  const [enablePageRoute, setEnablePageRoute] = useState(defaultKind === 'page')
  const [customPageSlug, setCustomPageSlug] = useState('')
  const [pageSlugTouched, setPageSlugTouched] = useState(false)

  // Unified template selection: '' = Blank, 'nb:<id>' = notebook note, 'src:<groupId>::<path>' = feed workout
  const [templateKey, setTemplateKey] = useState('')
  const [templateQuery, setTemplateQuery] = useState('')
  const [wqlScope, setWqlScope] = useState('')
  const [notebookNotes, setNotebookNotes] = useState<NotebookNoteChoice[] | null>(null)
  const [sources, setSources] = useState<SourceState | null>(null)
  const templatesReq = useRef(0)
  const inFlight = useRef(false)

  // The TARGET notebook — where the new note lands. '' = the journal.
  const [targetNotebookId, setTargetNotebookId] = useState('')
  const [targetNotebooks, setTargetNotebooks] = useState<Notebook[] | null>(null)
  const [targetNotebooksError, setTargetNotebooksError] = useState<string | null>(null)
  const targetsReq = useRef(0)

  // Fresh form on every open.
  useEffect(() => {
    if (!open) return
    templatesReq.current++
    targetsReq.current++
    setKind(toComposerKind(defaultKind))
    setNoteMode(defaultNoteMode)
    setAdvancedOpen(defaultKind === 'page')
    setWorkoutSearchQuery('')
    setPickerBusyId(null)
    setPickerError(null)
    setDate(defaultDate && parseJournalDate(defaultDate) ? defaultDate : getTodayDateKey())
    setTitle('')
    setBody('')
    setDescription('')
    setNotebookIcon('📓')
    setEnablePageRoute(defaultKind === 'page')
    setCustomPageSlug('')
    setPageSlugTouched(false)
    setTemplateKey('')
    setWqlScope('')
    setCreating(false)
    setSubmitError(null)
    setTargetNotebookId(defaultNotebookSlug ? `notebook/${defaultNotebookSlug}` : '')
    setTargetNotebooks(null)
    setTargetNotebooksError(null)
    setNotebookNotes(null)
    setMyWorkoutNotes(null)
    setRemoteFeedWorkouts([])
    setSources(null)
  }, [open, defaultKind, defaultDate, defaultNotebookSlug, _defaultMode, defaultNoteMode])

  // Load writable user notebooks for the Location ("Place in") dropdown.
  useEffect(() => {
    if (!open) return
    const token = ++targetsReq.current
    notebookService
      .getAll()
      .then(notebooks => {
        if (targetsReq.current === token) {
          setTargetNotebooks(
            notebooks.filter(
              nb =>
                !isSystemReadOnlyNotebook(nb.notebookId ?? nb.id ?? nb.slug) &&
                !isSystemReadOnlyNotebook(nb.slug) &&
                nb.origin !== 'feed',
            ),
          )
        }
      })
      .catch(() => {
        if (targetsReq.current === token) setTargetNotebooksError('Could not load your notebooks.')
      })
    return () => {
      targetsReq.current++
    }
  }, [open])

  const supportsTemplates = kind === 'note' || kind === 'playground'
  const supportsDateAndTarget = kind === 'note'
  const requiresTitle = kind === 'notebook' || kind === 'tag'
  // ponytail: effort/equipment allow empty title to land on /effort/new?mode=create or /equipment/new?mode=create; upgrade to inline schema validation if reference creation drops the editor create route.

  // Load starter templates and feed sources in background when creating a Note or Playground.
  useEffect(() => {
    if (!open || !supportsTemplates) return
    if (notebookNotes !== null && sources !== null) return
    const token = ++templatesReq.current
    void Promise.all([
      storageService.getAllNotes().catch(() => []),
      notebookService.getAll().catch(() => []),
      getScriptNotebooks().catch(() => []),
    ]).then(([notes, userNotebooks, scriptNotebooks]) => {
      if (templatesReq.current !== token) return
      setMyWorkoutNotes(notes)
      const userSlugs = new Set(
        userNotebooks
          .filter(nb => !isSystemReadOnlyNotebook(nb.id ?? nb.slug))
          .map(nb => nb.slug),
      )
      setNotebookNotes(
        notes
          .filter(n => {
            const slug = n.notebookId?.startsWith('notebook/') ? n.notebookId.slice('notebook/'.length) : undefined
            return !!slug && userSlugs.has(slug) && !n.id.startsWith('notebook/')
          })
          .map(n => ({
            id: n.id,
            title: n.title,
            rawContent: n.rawContent,
            tags: n.tags ?? [],
          })),
      )
      const sourceIdByPath: Record<string, string> = {}
      for (const note of notes) {
        if (note.sourcePath) sourceIdByPath[note.sourcePath] = note.id
      }
      setSources({ notebooks: scriptNotebooks, sourceIdByPath })
      void (async () => {
        try {
          const allCatalogNbs = await playgroundFeedCatalogStore.getAllNotebooks().catch(() => [])
          if (templatesReq.current !== token) return
          const subFeedNbs = allCatalogNbs.filter(nb => nb.origin === 'feed' && isFeedSubscribed(nb.feedId))
          const loadedRemote = await Promise.all(
            subFeedNbs.map(async nb => {
              const remoteNotes = await playgroundFeedCatalogStore
                .getRemoteNotebookNotes(nb.slug, nb.feedId)
                .catch(() => [] as Note[])
              return remoteNotes.map(note => ({
                nbName: nb.name || nb.slug,
                nbSlug: nb.slug,
                feedId: nb.feedId,
                categories: nb.category ? [nb.category] : undefined,
                note,
              }))
            }),
          )
          if (templatesReq.current !== token) return
          setRemoteFeedWorkouts(loadedRemote.flat())
        } catch {
          // Ignore catalog preview failures during dialog mount
        }
      })()
    })
    return () => {
      templatesReq.current++
    }
  }, [open, supportsTemplates, notebookNotes, sources])

  const selectedTemplate = useMemo(() => {
    if (!templateKey) return null
    if (templateKey.startsWith('nb:')) {
      const id = templateKey.slice(3)
      const found = notebookNotes?.find(t => t.id === id)
      return found ? { kind: 'notebook' as const, note: found } : null
    }
    if (templateKey.startsWith('src:')) {
      const rest = templateKey.slice(4)
      const sep = rest.indexOf('::')
      if (sep === -1 || !sources) return null
      const groupId = rest.slice(0, sep)
      const itemPath = rest.slice(sep + 2)
      const group = sources.notebooks.find(n => n.id === groupId)
      const item = group?.items.find(i => i.path === itemPath)
      if (!item) return null
      return { kind: 'source' as const, item, sourceId: sources.sourceIdByPath[item.path] }
    }
    return null
  }, [templateKey, notebookNotes, sources])

  const allTemplateOptions = useMemo<TemplateOption[]>(() => {
    const blank: TemplateOption = { key: '', label: 'Blank note', group: 'Default' }
    const userOptions: TemplateOption[] = [...(notebookNotes ?? [])]
      .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id))
      .map(n => ({
        key: `nb:${n.id}`,
        label: n.title || n.id,
        group: 'Your Notebook Notes',
        groupKey: 'user',
        isTemplateTagged: n.tags.some(t => t.toLowerCase() === 'template'),
      }))

    const sourceOptions: TemplateOption[] = []
    for (const group of sources?.notebooks ?? []) {
      const sortedItems = [...group.items].sort((a, b) => a.name.localeCompare(b.name))
      for (const item of sortedItems) {
        sourceOptions.push({
          key: `src:${group.id}::${item.path}`,
          label: item.date ? `${item.name} — ${item.date}` : item.name,
          group: group.name,
          groupKey: group.id,
          categories: group.categories,
        })
      }
    }
    return [blank, ...userOptions, ...sourceOptions]
  }, [notebookNotes, sources])

  const { visibleTemplateOptions, truncatedMatches } = useMemo(
    () => curateTemplateOptions(allTemplateOptions, templateQuery),
    [allTemplateOptions, templateQuery],
  )

  const dateParsed = parseJournalDate(date)
  const dateInvalid = supportsDateAndTarget && date !== '' && !dateParsed
  const isNotebookTarget = Boolean(targetNotebookId)

  const fallbackTitle =
    kind === 'note'
      ? enablePageRoute
        ? 'Untitled page'
        : isNotebookTarget
          ? 'Untitled note'
          : `Journal — ${formatDateHeader(dateParsed?.dateKey ?? getTodayDateKey())}`
      : kind === 'playground'
        ? 'New playground'
        : kind === 'notebook'
          ? 'e.g., Morning Routines'
          : kind === 'effort'
            ? 'e.g., Kettlebell Swing'
            : kind === 'equipment'
              ? 'e.g., Kettlebell'
              : 'e.g., heavy'

  const suggestedPageSlug = useMemo(() => {
    const fromTitle = slugifyRoute(title)
    if (fromTitle) return fromTitle
    const fromTemplate =
      selectedTemplate?.kind === 'notebook'
        ? slugifyRoute(selectedTemplate.note.title)
        : selectedTemplate?.kind === 'source'
          ? slugifyRoute(selectedTemplate.item.name)
          : ''
    if (fromTemplate) return fromTemplate
    return `page-${(dateParsed?.dateKey ?? getTodayDateKey()).replace(/-/g, '')}`
  }, [title, selectedTemplate, dateParsed])

  const resolvedPageSlug = enablePageRoute
    ? slugifyRoute(pageSlugTouched ? customPageSlug : suggestedPageSlug)
    : ''

  const submitDisabled =
    creating ||
    (supportsDateAndTarget && !dateParsed) ||
    (requiresTitle && !title.trim()) ||
    (kind === 'note' && enablePageRoute && !resolvedPageSlug)

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight.current || submitDisabled) return

    inFlight.current = true
    setCreating(true)
    setSubmitError(null)
    try {
      if (kind === 'notebook') {
        const created = await notebookService.create(title.trim(), description.trim(), notebookIcon)
        onOpenChange(false)
        void navigate(notebookPath(created.slug))
        return
      }

      if (kind === 'playground') {
        let content = DEFAULT_PLAYGROUND_CONTENT.content
        if (selectedTemplate?.kind === 'notebook') {
          content = selectedTemplate.note.rawContent
        } else if (selectedTemplate?.kind === 'source') {
          content = selectedTemplate.item.content
        } else if (title.trim()) {
          content = `# ${title.trim()}\n`
        }
        const pageId = await createPlaygroundPage(content)
        onOpenChange(false)
        void navigate(playgroundPath(pageId))
        return
      }

      if (kind === 'tag') {
        const slug = slugifyRoute(title)
        const tag: Tag = {
          id: `tag-user-${crypto.randomUUID()}`,
          label: slug,
          contributions: [],
          createdAt: Date.now(),
        }
        await commitReferenceNote({
          kind: 'tag',
          slug,
          title: slug,
          rawContent: tagRecordToDocument(tag),
          expectedSourceRevision: 0,
        })
        onOpenChange(false)
        void navigate(tagPath('tag', slug))
        return
      }

      if (kind === 'effort') {
        const slug = slugifyRoute(title)
        if (!slug) {
          onOpenChange(false)
          void navigate(effortPath('new', undefined, { mode: 'create' }))
          return
        }
        const label = title.trim()
        const rawContent = effortToDocument({
          id: `effort-user-${crypto.randomUUID()}`,
          slug,
          label,
          aliases: [slug.replace(/[-_]+/g, ' ')],
          baseAttributes: { met: 5.0 },
          registrySource: 'user',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        await commitReferenceNote({
          kind: 'effort',
          slug,
          rawContent,
          title: label,
          expectedSourceRevision: 0,
        })
        await refreshEffortRegistry()
        onOpenChange(false)
        void navigate(effortPath(slug))
        return
      }

      if (kind === 'equipment') {
        const slug = slugifyRoute(title)
        if (!slug) {
          onOpenChange(false)
          void navigate(`${equipmentPath('new')}?mode=create`)
          return
        }
        const label = title.trim()
        const rawContent = blankEquipmentDocument(slug, label)
        await commitReferenceNote({
          kind: 'equipment',
          slug,
          rawContent,
          title: label,
          expectedSourceRevision: 0,
        })
        await refreshEquipmentRegistry()
        onOpenChange(false)
        void navigate(equipmentPath(slug))
        return
      }

      // kind === 'note' (unifies Journal entry, Notebook note, and Page-routed note)
      const parsed = parseJournalDate(date)
      if (!parsed) return
      const effectiveType = isNotebookTarget || enablePageRoute ? 'note' : 'journal'
      const slugForNote = enablePageRoute && resolvedPageSlug ? resolvedPageSlug : undefined

      const trimmedBody = body.trim()
      const withOptionalBody = (base: string): string => {
        if (!trimmedBody) return base
        return base.trimEnd() ? `${base.trimEnd()}\n\n${body}` : body
      }

      let input: CreateJournalNoteInput
      if (selectedTemplate?.kind === 'notebook') {
        input = {
          journalDate: parsed.dateKey,
          title: title.trim() || selectedTemplate.note.title || fallbackTitle,
          rawContent: withOptionalBody(selectedTemplate.note.rawContent),
          tags: selectedTemplate.note.tags,
          sourceId: selectedTemplate.note.id,
          slug: slugForNote,
          type: effectiveType,
        }
      } else if (selectedTemplate?.kind === 'source') {
        if (!selectedTemplate.sourceId) {
          setSubmitError('No stored source note matches this item. Your input is kept — pick another item or use Blank.')
          return
        }
        input = {
          journalDate: parsed.dateKey,
          title: title.trim() || selectedTemplate.item.name,
          rawContent: withOptionalBody(selectedTemplate.item.content),
          tags: [],
          sourceId: selectedTemplate.sourceId,
          slug: slugForNote,
          type: effectiveType,
        }
      } else {
        const resolvedTitle = title.trim() || fallbackTitle
        const needsHeading = isNotebookTarget || enablePageRoute
        const trimmedWql = wqlScope.trim()
        const wqlFence = trimmedWql ? `\n\`\`\`query\n${trimmedWql}\n\`\`\`\n` : ''
        const heading = needsHeading ? `# ${resolvedTitle}${trimmedBody ? '\n\n' : '\n'}` : ''
        const bodyAndWql = trimmedBody
          ? `${body}${wqlFence ? `\n${wqlFence}` : ''}`
          : wqlFence
        input = {
          journalDate: parsed.dateKey,
          title: resolvedTitle,
          rawContent: heading + bodyAndWql,
          tags: [],
          slug: slugForNote,
          type: effectiveType,
        }
      }

      const entry = await journalNotes.create(input)
      if (targetNotebookId) {
        await notebookService.moveNote(entry.id, targetNotebookId)
      }
      if (onCreated) {
        onCreated(entry)
      } else if (targetNotebookId && !enablePageRoute) {
        const nbSlug = targetNotebookId.startsWith('notebook/') ? targetNotebookId.slice('notebook/'.length) : targetNotebookId
        void navigate(notebookItemPath(nbSlug, entry.id))
      } else {
        void navigate(`${notePath(entry.id)}?edit=1`)
      }
      onOpenChange(false)
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message.includes('read-only')
          ? 'That notebook is read-only. Choose another one — your input is kept.'
          : err instanceof Error && err.message
            ? err.message
            : 'Could not create the item. Your input is kept — try again.',
      )
    } finally {
      inFlight.current = false
      setCreating(false)
    }
  }

  const activeKindOption = KIND_OPTIONS.find(k => k.kind === kind) ?? KIND_OPTIONS[0]!
  const workspaceKinds = KIND_OPTIONS.filter(k => k.group === 'workspace')
  const catalogKinds = KIND_OPTIONS.filter(k => k.group === 'catalog')
  const isPickWorkoutMode = kind === 'note' && noteMode === 'pick'

  interface PickerWorkoutItem {
    id: string
    title: string
    sourceBadge: string
    isMine: boolean
    subtitle: string
    searchText: string
    entry: Entry
    rawContent?: string
    notebookSlug: string
    sourceNotePath?: string
  }

  const pickerWorkouts = useMemo<PickerWorkoutItem[]>(() => {
    type RawPickerItem = PickerWorkoutItem & CuratablePickerItem
    const items: RawPickerItem[] = []
    const seenIds = new Set<string>()
    for (const note of myWorkoutNotes ?? []) {
      if (note.id.startsWith('notebook/')) continue
      const nbId = notebookOfItem(note)
      const nbSlug = nbId ? notebookSlugFromId(nbId) : 'journal'
      if (isSystemReadOnlyNotebook(nbSlug)) continue
      const ownership = resolveNoteOwnership(note, notebookOriginOfItem(note), nbId)
      if (ownership.kind !== 'user') continue
      if (!WORKOUT_FENCE_RE.test(note.rawContent ?? '')) continue
      seenIds.add(note.id)
      const title = note.title || 'Untitled workout'
      const noteDate = note.date ? localDateKey(new Date(note.date)) : undefined
      const subtitle = nbSlug === 'journal' ? (noteDate || 'Journal') : nbSlug
      items.push({
        id: note.id,
        title,
        sourceBadge: 'Mine',
        isMine: true,
        subtitle,
        searchText: `${title} mine ${subtitle}`.toLowerCase(),
        entry: {
          id: note.id,
          kind: 'note',
          sourceNotebook: nbSlug,
          sourceNote: note.id,
          title,
          date: noteDate ?? null,
          editable: true,
          ownership,
          notebookId: nbId,
        },
        rawContent: note.rawContent,
        notebookSlug: nbSlug,
      })
    }

    for (const remoteItem of remoteFeedWorkouts) {
      const { note, nbName, nbSlug, feedId, categories } = remoteItem
      const parsed = parseRemoteNoteId(note.id)
      const uuid = parsed.isRemote ? parsed.uuid : note.id
      const remoteId = parsed.isRemote ? note.id : `remote:${feedId}:${uuid}`
      if (seenIds.has(remoteId) || seenIds.has(uuid)) continue
      seenIds.add(remoteId)
      const feedLabel = resolveFeedDisplayLabel(feedId) ?? feedId
      const title = note.title || 'Workout'
      items.push({
        id: remoteId,
        title,
        sourceBadge: feedLabel,
        isMine: false,
        isRemotePreview: true,
        subtitle: nbName,
        categories,
        searchText: `${title} ${feedLabel} ${nbName}`.toLowerCase(),
        entry: {
          id: remoteId,
          kind: 'note',
          sourceNotebook: nbSlug,
          sourceNote: uuid,
          title,
          date: null,
          feedId,
          isRemotePreview: true,
          editable: false,
          sourcePath: note.sourcePath,
        },
        rawContent: note.rawContent || undefined,
        notebookSlug: nbSlug,
        sourceNotePath: note.sourcePath,
      })
    }

    if (sources) {
      for (const nb of sources.notebooks) {
        const feedLabel = nb.name
        for (const nbItem of nb.items) {
          const itemId = sources.sourceIdByPath[nbItem.path] ?? `notebook/${nb.id}/${nbItem.date}/${nbItem.id}`
          if (seenIds.has(itemId)) continue
          seenIds.add(itemId)
          items.push({
            id: itemId,
            title: nbItem.name,
            sourceBadge: feedLabel,
            isMine: false,
            subtitle: nb.name,
            categories: nb.categories,
            searchText: `${nbItem.name} ${feedLabel} ${nb.name}`.toLowerCase(),
            entry: {
              id: itemId,
              kind: 'note',
              sourceNotebook: nb.id,
              sourceNote: nbItem.id,
              title: nbItem.name,
              date: nbItem.date ?? null,
              feedId: 'core',
              editable: false,
              sourcePath: `/notebook/${encodeURIComponent(nb.id)}/${nbItem.date}/${encodeURIComponent(nbItem.id)}`,
            },
            rawContent: nbItem.content,
            notebookSlug: nb.id,
            sourceNotePath: `/notebook/${encodeURIComponent(nb.id)}/${nbItem.date}/${encodeURIComponent(nbItem.id)}`,
          })
        }
      }
    }

    return curatePickerWorkouts(items, workoutSearchQuery)
  }, [myWorkoutNotes, remoteFeedWorkouts, sources, workoutSearchQuery])

  const handleOpenOrRunPickedWorkout = async (item: PickerWorkoutItem) => {
    if (pickerBusyId) return
    setPickerBusyId(item.id)
    setPickerError(null)
    try {
      try {
        await startEntryRun(item.entry, navigate)
      } catch {
        void navigate(entryOpenHref(item.entry))
      }
      onOpenChange(false)
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Could not open workout.')
    } finally {
      setPickerBusyId(null)
    }
  }

  const handleSchedulePickedWorkout = async (item: PickerWorkoutItem) => {
    if (pickerBusyId) return
    setPickerBusyId(item.id)
    setPickerError(null)
    try {
      const targetDate = dateParsed?.date ?? new Date()
      let wodContent = item.rawContent ?? ''
      let resolvedPayload: Awaited<ReturnType<typeof resolveRemoteWorkout>> | undefined
      if (!wodContent && item.entry.isRemotePreview) {
        resolvedPayload = await resolveRemoteWorkout(item.id, { storage: storageService.storage })
        wodContent = resolvedPayload?.row.content ?? ''
      }
      const created = await createJournalNoteFromWorkout({
        workoutName: item.title,
        category: item.notebookSlug,
        sourceNoteId: item.id,
        sourceNoteLabel: item.isMine ? 'My Notes' : item.sourceBadge,
        sourceNotePath: item.sourceNotePath ?? entryOpenHref(item.entry),
        wodContent,
        date: targetDate,
        resolveRemoteWorkout: async (id) => {
          const res = resolvedPayload ?? (await resolveRemoteWorkout(id, { storage: storageService.storage }).catch(() => undefined))
          if (!res) return undefined
          const meta = lookupRemoteRecord(id)
          return {
            row: res.row,
            canonicalNoteId: res.canonicalNoteId,
            remoteNoteId: res.remoteNoteId,
            feedId: res.feedId,
            notebookSlug: meta?.notebookSlug ?? item.notebookSlug,
            record: meta?.record,
          }
        },
      })
      onCreated?.(created)
      onOpenChange(false)
      void navigate(dayPath(created.journalDate ?? formatDateHeader(targetDate)))
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Could not schedule workout.')
    } finally {
      setPickerBusyId(null)
    }
  }

  return (
    <EditorDialog
      open={open}
      onClose={() => {
        if (!inFlight.current) onOpenChange(false)
      }}
      title={isPickWorkoutMode ? 'Pick / Log a Workout' : `New ${activeKindOption.label}`}
      description={isPickWorkoutMode ? 'Start a workout directly or schedule it to a journal date without duplicating notes.' : activeKindOption.subtitle}
      presentation="sheet"
      footer={
        isPickWorkoutMode ? (
          <div className="flex w-full items-center justify-end gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={Boolean(pickerBusyId)} data-testid={TEST_IDS.ENTRY_CREATE_CANCEL_BTN}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Press Enter ↵ to create
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={creating} data-testid={TEST_IDS.ENTRY_CREATE_CANCEL_BTN}>
                Cancel
              </Button>
              <Button type="submit" form="create-journal-note-form" size="lg" disabled={submitDisabled} data-testid={TEST_IDS.ENTRY_CREATE_SUBMIT_BTN}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        )
      }
    >
      <form
        id="create-journal-note-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 sm:flex-row sm:items-start"
        noValidate
      >
        {/* Left Rail (desktop) / 2-col Touch Grid (mobile): Resource Kind */}
        <div
          role="group"
          aria-label="Resource type"
          className="grid grid-cols-2 gap-1.5 sm:flex sm:w-44 sm:shrink-0 sm:flex-col sm:border-r sm:border-border sm:pr-4"
        >
          <span className="col-span-2 px-1 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground sm:px-2 sm:pb-1">
            Create
          </span>
          {workspaceKinds.map(item => {
            const Icon = item.icon
            const active = kind === item.kind
            return (
              <button
                key={item.kind}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setKind(item.kind)
                  setSubmitError(null)
                }}
                disabled={creating}
                data-testid={`new-entry-${item.kind}`}
                className={
                  'flex min-h-10 items-center justify-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/70 text-foreground hover:bg-muted/60 sm:border-transparent')
                }
              >
                <Icon className="size-4 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold leading-tight">{item.label}</div>
                  <div className="hidden truncate text-[11px] text-muted-foreground sm:block">{item.subtitle}</div>
                </div>
              </button>
            )
          })}

          <span className="col-span-2 px-1 pt-2 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground sm:px-2 sm:pt-3 sm:pb-1">
            Catalog
          </span>
          {catalogKinds.map(item => {
            const Icon = item.icon
            const active = kind === item.kind
            return (
              <button
                key={item.kind}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setKind(item.kind)
                  setSubmitError(null)
                }}
                disabled={creating}
                data-testid={`new-entry-${item.kind}`}
                className={
                  'flex min-h-10 items-center justify-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/70 text-foreground hover:bg-muted/60 sm:border-transparent')
                }
              >
                <Icon className="size-4 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold leading-tight">{item.label}</div>
                  <div className="hidden truncate text-[11px] text-muted-foreground sm:block">{item.subtitle}</div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Right Pane: Focused Composer */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {kind === 'note' && (
            <div
              role="tablist"
              aria-label="Note action mode"
              className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={noteMode === 'write'}
                onClick={() => setNoteMode('write')}
                className={
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ' +
                  (noteMode === 'write'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                Write a Note
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={noteMode === 'pick'}
                onClick={() => setNoteMode('pick')}
                className={
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ' +
                  (noteMode === 'pick'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                Pick / Log a Workout
              </button>
            </div>
          )}

          {isPickWorkoutMode ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    type="search"
                    value={workoutSearchQuery}
                    onChange={e => setWorkoutSearchQuery(e.target.value)}
                    placeholder="Search workouts or feeds…"
                    aria-label="Search workouts"
                    className={`${fieldClass} pl-9`}
                  />
                </div>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  aria-label="Schedule date"
                  className={`${fieldClass} sm:w-40`}
                />
              </div>

              {pickerError && (
                <p role="alert" className="text-xs text-destructive">{pickerError}</p>
              )}

              {pickerWorkouts.length === 0 ? (
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
                  {workoutSearchQuery.trim()
                    ? `No workouts matched "${workoutSearchQuery}".`
                    : 'No workouts found in your personal notes or subscribed feeds yet.'}
                </div>
              ) : (
                <ul className="max-h-72 overflow-y-auto divide-y divide-border rounded-lg border border-border bg-background/60">
                  {pickerWorkouts.slice(0, 40).map((item) => {
                    const rowBusy = pickerBusyId === item.id
                    return (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate text-xs font-semibold text-foreground">{item.title}</span>
                            <span
                              className={
                                'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ' +
                                (item.isMine
                                  ? 'border-primary/30 bg-primary/15 text-primary'
                                  : 'border-sky-700/30 bg-sky-500/15 text-sky-900 dark:border-sky-400/30 dark:text-sky-100')
                              }
                            >
                              {item.sourceBadge}
                            </span>
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">{item.subtitle}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            disabled={Boolean(pickerBusyId)}
                            onClick={() => void handleOpenOrRunPickedWorkout(item)}
                            className="h-8 gap-1 px-2.5 text-xs"
                          >
                            {rowBusy ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Play className="size-3" aria-hidden="true" />}
                            Open / Run
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={Boolean(pickerBusyId)}
                            onClick={() => void handleSchedulePickedWorkout(item)}
                            className="h-8 gap-1 px-2.5 text-xs"
                          >
                            <CalendarPlus className="size-3" aria-hidden="true" />
                            Schedule
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : (
            <>
          {/* 1. Hero Input: Title / Name first */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="journal-create-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {kind === 'notebook' || kind === 'effort' || kind === 'equipment' || kind === 'tag' ? 'Name' : 'Title'}{' '}
              {requiresTitle ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="font-normal normal-case text-muted-foreground/80">(optional)</span>
              )}
            </label>
            <input
              id="journal-create-title"
              type="text"
              data-autofocus
              data-testid={TEST_IDS.ENTRY_CREATE_TITLE_INPUT}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={fallbackTitle}
              disabled={creating}
              className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base font-medium placeholder:font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {kind === 'note' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="journal-create-body" className="text-xs font-medium text-muted-foreground">
                Content <span className="font-normal text-muted-foreground/80">(optional)</span>
              </label>
              <textarea
                id="journal-create-body"
                data-testid={TEST_IDS.ENTRY_CREATE_BODY_INPUT}
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={3}
                disabled={creating}
                placeholder="Write workout or notes here…"
                className="w-full resize-y rounded-lg border border-input bg-background px-3.5 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}

          {/* 2. Note-specific context: Location + Date in a compact 2-column row */}
          {supportsDateAndTarget && (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="journal-create-target-notebook" className="text-xs font-medium text-muted-foreground">
                  Place in
                </label>
                {targetNotebooksError ? (
                  <p className="flex min-h-10 items-center text-xs text-destructive">{targetNotebooksError}</p>
                ) : (
                  <select
                    id="journal-create-target-notebook"
                    value={targetNotebookId}
                    onChange={e => setTargetNotebookId(e.target.value)}
                    disabled={creating}
                    className={fieldClass}
                    data-testid="journal-create-target-notebook"
                  >
                    <option value="">Journal (no notebook)</option>
                    {targetNotebooks?.map(nb => (
                      <option key={nb.notebookId} value={nb.notebookId}>
                        {nb.icon ? `${nb.icon} ` : ''}
                        {nb.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="journal-create-date" className="text-xs font-medium text-muted-foreground">
                  Date
                </label>
                <input
                  id="journal-create-date"
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  disabled={creating}
                  aria-invalid={dateInvalid || undefined}
                  data-testid={TEST_IDS.ENTRY_CREATE_DATE_INPUT}
                  className={fieldClass}
                />
                {dateInvalid && <p className="text-xs text-destructive">Enter a valid date (YYYY-MM-DD).</p>}
              </div>
            </div>
          )}

          {/* 3. Unified searchable "Start from" template selector for Note & Playground */}
          {supportsTemplates && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="journal-create-template" className="text-xs font-medium text-muted-foreground">
                Start from <span className="font-normal text-muted-foreground/80">(optional)</span>
              </label>
              <Combobox
                value={templateKey || '__blank__'}
                filter={false}
                items={allTemplateOptions.map((opt) => ({
                  value: opt.key || '__blank__',
                  label: opt.label,
                }))}
                onValueChange={(next) => {
                  const resolved = typeof next === 'string' && next !== '__blank__' ? next : ''
                  setTemplateKey(resolved)
                }}
                onQueryChange={setTemplateQuery}
                onOpenChange={(nextOpen) => {
                  if (!nextOpen) setTemplateQuery('')
                }}
                disabled={creating}
              >
                <div className="relative flex">
                  <ComboboxInput
                    id="journal-create-template"
                    aria-label="Start from template"
                    placeholder="Blank note — type to search templates…"
                    className={`${fieldClass} pr-8 flex-1`}
                    data-testid="journal-create-template"
                  />
                  <ComboboxTrigger
                    className="absolute inset-y-0 right-0 h-full w-8 border-0 bg-transparent p-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label="Toggle template options"
                  />
                </div>
                <ComboboxContent
                  className="max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
                >
                  <ComboboxEmpty className="px-3 py-2 text-xs text-muted-foreground">
                    No matching templates.
                  </ComboboxEmpty>
                  <ComboboxList>
                    {visibleTemplateOptions.map((opt) => (
                      <ComboboxItem
                        key={opt.key || '__blank__'}
                        value={opt.key || '__blank__'}
                        label={opt.label}
                        className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs data-highlighted:bg-muted"
                      >
                        <span className="truncate font-medium">{opt.label}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {opt.group !== 'Default' && (
                            <span className="text-[11px] text-muted-foreground">{opt.group}</span>
                          )}
                          <ComboboxItemIndicator />
                        </span>
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                  {truncatedMatches > 0 && (
                    <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border/40">
                      {templateQuery.trim()
                        ? `+${truncatedMatches} more matches — keep typing to refine`
                        : `Showing curated shortlist (${allTemplateOptions.length} total — type to search all)`}
                    </div>
                  )}
                </ComboboxContent>
              </Combobox>
            </div>
          )}

          {/* 4. Advanced options (Page route & Initial WQL Widget) */}
          {kind === 'note' && (
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen(v => !v)}
                className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-foreground"
              >
                <span>Advanced options</span>
                <ChevronDown
                  className={`size-4 text-muted-foreground transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              <div className={`${advancedOpen ? 'mt-3 space-y-3 border-t border-border/60 pt-3' : 'hidden'}`} aria-hidden={!advancedOpen}>
                <div>
                  <label className="flex cursor-pointer items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-foreground">Publish as Page route</span>
                      <span className="text-[11px] text-muted-foreground">
                        Give this note a direct <code className="font-mono">/page/&lt;slug&gt;</code> address
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={enablePageRoute}
                      onChange={e => setEnablePageRoute(e.target.checked)}
                      disabled={creating}
                      data-testid="journal-create-page-toggle"
                      className="size-4 accent-primary"
                    />
                  </label>
                  {enablePageRoute && (
                    <div className="mt-2.5 flex items-center rounded-md border border-input bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring">
                      <span className="select-none font-mono text-xs text-muted-foreground">/page/</span>
                      <input
                        id="journal-create-page-slug"
                        type="text"
                        value={pageSlugTouched ? customPageSlug : suggestedPageSlug}
                        onChange={e => {
                          setPageSlugTouched(true)
                          setCustomPageSlug(e.target.value)
                        }}
                        placeholder="my-page-slug"
                        autoCapitalize="none"
                        spellCheck={false}
                        disabled={creating}
                        data-testid="journal-create-page-slug"
                        className="h-9 min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Initial WQL Widget <span className="font-normal text-muted-foreground">(optional — embeds a query block in this note)</span>
                  </span>
                  <div data-testid="note-create-wql-composer">
                    <WqlComposer
                      query={wqlScope}
                      onQueryChange={setWqlScope}
                      compact
                      showDiagnostics={false}
                      placeholder="e.g. :note{domain:crossfit} or sum:totalVolume{} by {week}"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {kind === 'notebook' && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Icon</span>
                <div className="flex flex-wrap gap-1.5">
                  {NOTEBOOK_ICONS.map(icon => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setNotebookIcon(icon)}
                      className={
                        'flex size-9 items-center justify-center rounded-md text-lg transition-all hover:bg-accent ' +
                        (notebookIcon === icon ? 'bg-primary/20 ring-2 ring-primary' : 'bg-muted/50')
                      }
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="notebook-create-description" className="text-xs font-medium text-muted-foreground">
                  Description <span className="font-normal text-muted-foreground/80">(optional)</span>
                </label>
                <textarea
                  id="notebook-create-description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="A brief description of this notebook..."
                  rows={2}
                  disabled={creating}
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </>
          )}

          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
            </>
          )}
        </div>
      </form>
    </EditorDialog>
  )
}
