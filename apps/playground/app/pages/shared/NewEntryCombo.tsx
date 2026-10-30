import { useEffect, useState, type ComponentType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BeakerIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  PlusIcon,
  RectangleStackIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid'

import { Button } from '@/components/atoms/primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/primitives/dropdown-menu'
import { CreateNotebookDialog } from '@/components/organisms/notebook/CreateNotebookDialog'
import { notebookService } from '@/hooks/useBrowserServices'

import { useNav } from '../../nav/NavContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { createPlaygroundPage } from '../../services/createPlaygroundPage'
import { dashboardNotes } from '../../services/dashboardNotes'
import { journalNotes } from '../../services/journalNotes'
import { DEFAULT_PLAYGROUND_CONTENT } from '../../templates/defaultPlaygroundContent'
import {
  dashboardViewPath,
  effortPath,
  equipmentPath,
  notePath,
  notebookItemPath,
  notebookPath,
  playgroundPath,
} from '../../lib/routes'

export type NewEntryKind = 'journal' | 'playground' | 'notebook' | 'note' | 'effort' | 'equipment' | 'page' | 'dashboard'

export interface NewEntryRouteContext {
  defaultKind: NewEntryKind
  notebookSlug?: string
}

interface EntryType {
  kind: NewEntryKind
  label: string
  icon: ComponentType<{ className?: string }>
}

const ENTRY_TYPES: Record<NewEntryKind, EntryType> = {
  journal: { kind: 'journal', label: 'Journal entry', icon: CalendarDaysIcon },
  playground: { kind: 'playground', label: 'Playground', icon: BeakerIcon },
  notebook: { kind: 'notebook', label: 'Notebook', icon: BookOpenIcon },
  note: { kind: 'note', label: 'Note', icon: DocumentTextIcon },
  effort: { kind: 'effort', label: 'Effort', icon: SparklesIcon },
  equipment: { kind: 'equipment', label: 'Equipment', icon: WrenchScrewdriverIcon },
  page: { kind: 'page', label: 'Page', icon: RectangleStackIcon },
  dashboard: { kind: 'dashboard', label: 'Dashboard', icon: ChartBarIcon },
}

const UNIVERSAL_KINDS: NewEntryKind[] = ['journal', 'playground', 'notebook', 'effort', 'equipment', 'page', 'dashboard']

/** Creation is a library/collection capability, never a detail-page fallback. */
export function routeSupportsCreation(pathname: string): boolean {
  return /^\/(?:journal|playgrounds|notebooks|pages|efforts|equipment|dashboards)\/?$/.test(pathname)
    || /^\/notebook\/[^/]+\/?$/.test(pathname)
}

/** ResponsiveActions primaries render inline on desktop too; stream pages
 *  already have a desktop combo in PageActions, so mount this one only on phones. */
export function MobileNewEntryCombo() {
  const isMobile = useIsMobile()
  return isMobile ? <NewEntryCombo /> : null
}

export function resolveNewEntryRoute(pathname: string): NewEntryRouteContext {
  const notebookMatch = /^\/notebook\/([^/]+)/.exec(pathname)
  if (notebookMatch?.[1]) {
    return { defaultKind: 'note', notebookSlug: decodeURIComponent(notebookMatch[1]) }
  }
  if (pathname === '/notebooks') return { defaultKind: 'notebook' }
  if (pathname === '/pages') return { defaultKind: 'page' }
  if (pathname === '/dashboards') return { defaultKind: 'dashboard' }
  if (pathname.startsWith('/playground')) return { defaultKind: 'playground' }
  if (pathname.startsWith('/effort')) return { defaultKind: 'effort' }
  if (pathname.startsWith('/equipment')) return { defaultKind: 'equipment' }
  return { defaultKind: 'journal' }
}

export function NewEntryCombo() {
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { openCreateJournal } = useNav()
  const [notebookOpen, setNotebookOpen] = useState(false)
  const [creating, setCreating] = useState<NewEntryKind | null>(null)
  const [notebookOrigin, setNotebookOrigin] = useState<'user' | 'default' | 'feed' | null>(null)
  const context = resolveNewEntryRoute(location.pathname)
  const defaultType = ENTRY_TYPES[context.defaultKind]
  const readOnlyNotebook = context.defaultKind === 'note' && notebookOrigin === 'feed'
  const DefaultIcon = readOnlyNotebook ? DocumentDuplicateIcon : defaultType.icon
  const defaultLabel = readOnlyNotebook ? 'Clone notebook' : `New ${defaultType.label}`
  const availableTypes = [
    ...(context.notebookSlug ? [ENTRY_TYPES.note] : []),
    ...UNIVERSAL_KINDS.map(kind => ENTRY_TYPES[kind]),
  ]

  useEffect(() => {
    let cancelled = false
    setNotebookOrigin(null)
    if (!context.notebookSlug) return
    void notebookService.getAllNotebooks().then(notebooks => {
      if (!cancelled) {
        setNotebookOrigin(notebooks.find(notebook => notebook.slug === context.notebookSlug)?.origin ?? 'feed')
      }
    }).catch(() => {
      if (!cancelled) setNotebookOrigin('feed')
    })
    return () => { cancelled = true }
  }, [context.notebookSlug])

  const cloneCurrentNotebook = async (notebookSlug: string) => {
    const source = (await notebookService.getAllNotebooks()).find(notebook => notebook.slug === notebookSlug)
    if (!source) throw new Error(`Notebook not found: ${notebookSlug}`)
    const clone = await notebookService.create(`${source.name} copy`, source.description ?? '', source.icon ?? '📓')
    const notes = await notebookService.listNotes(notebookSlug)
    for (const note of notes) {
      await notebookService.cloneNote(note.id, clone.slug)
    }
    navigate(notebookPath(clone.slug))
  }

  const createEntry = async (kind: NewEntryKind) => {
    if (creating) return
    if (kind === 'journal') {
      openCreateJournal()
      return
    }
    if (kind === 'notebook') {
      setNotebookOpen(true)
      return
    }
    if (kind === 'effort') {
      navigate(effortPath('new', undefined, { mode: 'create' }))
      return
    }
    if (kind === 'equipment') {
      navigate(`${equipmentPath('new')}?mode=create`)
      return
    }

    setCreating(kind)
    try {
      if (kind === 'playground') {
        const pageId = await createPlaygroundPage(DEFAULT_PLAYGROUND_CONTENT.content)
        navigate(playgroundPath(pageId))
        return
      }
      if (kind === 'dashboard') {
        const created = await dashboardNotes.createDashboard()
        navigate(dashboardViewPath(created.slug ?? created.id))
        return
      }
      if (kind === 'page') {
        const slug = `page-${Date.now().toString(36)}`
        const created = await journalNotes.create({
          title: 'Untitled page',
          rawContent: '# Untitled page\n',
          slug,
          type: 'note',
        })
        navigate(`${notePath(created.id)}?edit=1`)
        return
      }
      if (!context.notebookSlug) return
      if (readOnlyNotebook) {
        await cloneCurrentNotebook(context.notebookSlug)
        return
      }
      const created = await journalNotes.create({
        title: 'Untitled note',
        rawContent: '# Untitled note\n',
        type: 'note',
      })
      await notebookService.moveNote(created.id, context.notebookSlug)
      navigate(notebookItemPath(context.notebookSlug, created.id))
    } finally {
      setCreating(null)
    }
  }

  const waitingForOwnership = context.defaultKind === 'note' && notebookOrigin === null

  return (
    <>
      <div className="inline-flex items-center" data-testid="new-entry-combo">
        <Button
          type="button"
          size="sm"
          className={isMobile ? 'size-11 rounded-full px-0' : 'h-9 gap-1.5 rounded-r-none px-2.5 text-xs'}
          disabled={creating !== null || waitingForOwnership}
          onClick={() => void createEntry(context.defaultKind)}
          aria-label={defaultLabel}
          title={defaultLabel}
          data-testid={context.defaultKind === 'effort'
            ? 'efforts-create-btn'
            : context.defaultKind === 'notebook'
              ? 'notebooks-create-button'
              : 'new-entry-primary'}
        >
          {creating === context.defaultKind
            ? <PlusIcon className="size-3.5 animate-spin" />
            : <DefaultIcon className="size-3.5" />}
          {!isMobile && <span>{creating === context.defaultKind ? 'Creating…' : defaultLabel}</span>}
        </Button>
        {!isMobile && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-l-none border-l border-primary-foreground/20 px-2"
                aria-label="Choose new entry type"
                disabled={creating !== null}
              >
                <ChevronDownIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {availableTypes.map(type => {
                const Icon = type.kind === 'note' && readOnlyNotebook ? DocumentDuplicateIcon : type.icon
                const label = type.kind === 'note' && readOnlyNotebook ? 'Clone notebook' : `New ${type.label}`
                return (
                  <DropdownMenuItem
                    key={type.kind}
                    className="gap-2"
                    onClick={() => void createEntry(type.kind)}
                    data-testid={`new-entry-${type.kind}`}
                  >
                    <Icon className="size-4" />
                    <span>{label}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <CreateNotebookDialog
        open={notebookOpen}
        onOpenChange={setNotebookOpen}
        onCreate={async (name, description, icon) => {
          const created = await notebookService.create(name, description, icon)
          navigate(notebookPath(created.slug))
          return created
        }}
      />
    </>
  )
}
