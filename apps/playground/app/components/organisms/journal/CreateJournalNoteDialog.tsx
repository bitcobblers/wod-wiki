import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BeakerIcon,
  BookOpenIcon,
  DocumentTextIcon,
  SparklesIcon,
  TagIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid'
import { EditorDialog, WqlComposer } from '@bitcobblers/wod-wiki-ui'
import { effortToDocument, tagRecordToDocument } from '@bitcobblers/wod-wiki-lang'
import type { Tag } from '@bitcobblers/wod-wiki-core'
import { Button } from '@/components/atoms/primitives/button'
import { TEST_IDS } from '@/lib/testIds'
import { storageService } from '@/services/storage'
import { notebookService } from '@/services/NotebookService'
import { commitReferenceNote } from '@/repositories/referenceNotes'
import { getScriptNotebooks, type ScriptNotebook } from '@/repositories/script-notebooks'
import type { HistoryRecord } from '@/types/history'
import type { Notebook } from '@/types/notebook'

import { formatDateHeader } from '@/lib/dateFormat'
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
  /** Called with the created entry after a successful note create. */
  onCreated?: (entry: HistoryRecord) => void
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
  defaultMode = 'blank',
  onCreated,
}: CreateJournalNoteDialogProps) {
  const navigate = useNavigate()
  const [kind, setKind] = useState<ComposerKind>(() => toComposerKind(defaultKind))
  const [date, setDate] = useState(() => getTodayDateKey())
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [notebookIcon, setNotebookIcon] = useState('📓')
  const [creating, setCreating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Optional Page route (/page/<slug>) — can be attached to any note being created.
  const [enablePageRoute, setEnablePageRoute] = useState(defaultKind === 'page')
  const [customPageSlug, setCustomPageSlug] = useState('')
  const [pageSlugTouched, setPageSlugTouched] = useState(false)

  // Unified template selection: '' = Blank, 'nb:<id>' = notebook note, 'src:<groupId>::<path>' = feed workout
  const [templateKey, setTemplateKey] = useState('')
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
    setDate(defaultDate && parseJournalDate(defaultDate) ? defaultDate : getTodayDateKey())
    setTitle('')
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
    setSources(null)
  }, [open, defaultKind, defaultDate, defaultNotebookSlug, defaultMode])

  // Load writable user notebooks for the Location ("Place in") dropdown.
  useEffect(() => {
    if (!open) return
    const token = ++targetsReq.current
    notebookService
      .getAll()
      .then(notebooks => {
        if (targetsReq.current === token) setTargetNotebooks(notebooks)
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
    Promise.all([
      storageService.getAllNotes().catch(() => []),
      notebookService.getAll().catch(() => []),
      getScriptNotebooks().catch(() => []),
    ]).then(([notes, userNotebooks, scriptNotebooks]) => {
      if (templatesReq.current !== token) return
      const userSlugs = new Set(['defaults', ...userNotebooks.map(nb => nb.slug)])
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current || submitDisabled) return

    inFlight.current = true
    setCreating(true)
    setSubmitError(null)
    try {
      if (kind === 'notebook') {
        const created = await notebookService.create(title.trim(), description.trim(), notebookIcon)
        onOpenChange(false)
        navigate(notebookPath(created.slug))
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
        navigate(playgroundPath(pageId))
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
        navigate(tagPath('tag', slug))
        return
      }

      if (kind === 'effort') {
        const slug = slugifyRoute(title)
        if (!slug) {
          onOpenChange(false)
          navigate(effortPath('new', undefined, { mode: 'create' }))
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
        onOpenChange(false)
        navigate(effortPath(slug))
        return
      }

      if (kind === 'equipment') {
        const slug = slugifyRoute(title)
        if (!slug) {
          onOpenChange(false)
          navigate(`${equipmentPath('new')}?mode=create`)
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
        onOpenChange(false)
        navigate(equipmentPath(slug))
        return
      }

      // kind === 'note' (unifies Journal entry, Notebook note, and Page-routed note)
      const parsed = parseJournalDate(date)
      if (!parsed) return
      const effectiveType = isNotebookTarget || enablePageRoute ? 'note' : 'journal'
      const slugForNote = enablePageRoute && resolvedPageSlug ? resolvedPageSlug : undefined

      let input: CreateJournalNoteInput
      if (selectedTemplate?.kind === 'notebook') {
        input = {
          journalDate: parsed.dateKey,
          title: title.trim() || selectedTemplate.note.title || fallbackTitle,
          rawContent: selectedTemplate.note.rawContent,
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
          rawContent: selectedTemplate.item.content,
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
        input = {
          journalDate: parsed.dateKey,
          title: resolvedTitle,
          rawContent: (needsHeading ? `# ${resolvedTitle}\n` : '') + wqlFence,
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
        navigate(notebookItemPath(nbSlug, entry.id))
      } else {
        navigate(`${notePath(entry.id)}?edit=1`)
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

  return (
    <EditorDialog
      open={open}
      onClose={() => {
        if (!inFlight.current) onOpenChange(false)
      }}
      title={`New ${activeKindOption.label}`}
      description={activeKindOption.subtitle}
      presentation="sheet"
      footer={
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
      }
    >
      <form
        id="create-journal-note-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 sm:flex-row sm:items-start"
        noValidate
      >
        {/* Left Rail (desktop) / 3x2 Touch Grid (mobile): Resource Kind */}
        <div
          role="group"
          aria-label="Resource type"
          className="grid grid-cols-3 gap-1.5 sm:flex sm:w-44 sm:shrink-0 sm:flex-col sm:border-r sm:border-border sm:pr-4"
        >
          <span className="hidden px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:block">
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
                  'flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-left transition-colors sm:justify-start sm:gap-2.5 sm:px-2.5 ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/70 text-foreground hover:bg-muted/60 sm:border-transparent')
                }
              >
                <Icon className="size-4 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold leading-tight">{item.label}</div>
                  <div className="hidden truncate text-[10px] text-muted-foreground sm:block">{item.subtitle}</div>
                </div>
              </button>
            )
          })}

          <span className="hidden px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:block">
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
                  'flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-left transition-colors sm:justify-start sm:gap-2.5 sm:px-2.5 ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/70 text-foreground hover:bg-muted/60 sm:border-transparent')
                }
              >
                <Icon className="size-4 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold leading-tight">{item.label}</div>
                  <div className="hidden truncate text-[10px] text-muted-foreground sm:block">{item.subtitle}</div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Right Pane: Focused Composer */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
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

          {/* 3. Unified "Start from" template selector for Note & Playground */}
          {supportsTemplates && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="journal-create-template" className="text-xs font-medium text-muted-foreground">
                Start from <span className="font-normal text-muted-foreground/80">(optional)</span>
              </label>
              <select
                id="journal-create-template"
                value={templateKey}
                onChange={e => setTemplateKey(e.target.value)}
                disabled={creating}
                className={fieldClass}
                data-testid="journal-create-template"
              >
                <option value="">Blank note</option>
                {notebookNotes && notebookNotes.length > 0 && (
                  <optgroup label="Your Notebook Notes">
                    {notebookNotes.map(n => (
                      <option key={n.id} value={`nb:${n.id}`}>
                        {n.title || n.id}
                      </option>
                    ))}
                  </optgroup>
                )}
                {sources?.notebooks.map(group =>
                  group.items.length > 0 ? (
                    <optgroup key={group.id} label={group.name}>
                      {group.items.map(item => (
                        <option key={item.path} value={`src:${group.id}::${item.path}`}>
                          {item.date ? `${item.name} — ${item.date}` : item.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </select>
            </div>
          )}

          {/* 4. Optional Page route (/page/<slug>) on any Note */}
          {kind === 'note' && (
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
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
          )}

          {kind === 'note' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Initial WQL Widget <span className="font-normal text-muted-foreground/80">(optional — embeds a query block in this note)</span>
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
        </div>
      </form>
    </EditorDialog>
  )
}
