import { useEffect, useState, type ComponentType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BeakerIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  PlusIcon,
  RectangleStackIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid'

import { Button } from '@/components/atoms/primitives/button'
import { notebookService } from '@/hooks/useBrowserServices'

import { useNav } from '../../nav/NavContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { notebookPath } from '../../lib/routes'

export type NewEntryKind = 'journal' | 'playground' | 'notebook' | 'note' | 'effort' | 'equipment' | 'page' | 'dashboard'

export interface NewEntryRouteContext {
  defaultKind: NewEntryKind
  notebookSlug?: string
  defaultDate?: string
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

/** Creation is a library/collection capability, never a detail-page fallback. */
export function routeSupportsCreation(pathname: string): boolean {
  // ponytail: literal '/' match; upgrade to normalized path regex if home gains subpath aliases.
  return pathname === '/'
    || /^\/(?:journal|playgrounds|notebooks|pages|efforts|equipment|dashboards)\/?$/.test(pathname)
    || /^\/notebook\/[^/]+\/?$/.test(pathname)
}

/** ResponsiveActions primaries render inline on desktop too; stream pages
 *  already have a desktop combo in PageActions, so mount this one only on phones. */
export function MobileNewEntryCombo() {
  const isMobile = useIsMobile()
  return isMobile ? <NewEntryCombo /> : null
}

export function resolveNewEntryRoute(pathname: string): NewEntryRouteContext {
  const notebookDateMatch = /^\/notebook\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/?$/.exec(pathname)
  if (notebookDateMatch?.[1] && notebookDateMatch?.[2]) {
    return {
      defaultKind: 'note',
      notebookSlug: decodeURIComponent(notebookDateMatch[1]),
      defaultDate: notebookDateMatch[2],
    }
  }
  const notebookMatch = /^\/notebook\/([^/]+)/.exec(pathname)
  if (notebookMatch?.[1]) {
    return { defaultKind: 'note', notebookSlug: decodeURIComponent(notebookMatch[1]) }
  }
  const dayMatch = /^\/day\/(\d{4}-\d{2}-\d{2})\/?$/.exec(pathname)
  if (dayMatch?.[1]) {
    return { defaultKind: 'journal', defaultDate: dayMatch[1] }
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
  const [cloning, setCloning] = useState(false)
  const [notebookOrigin, setNotebookOrigin] = useState<'user' | 'default' | 'feed' | null>(null)
  const context = resolveNewEntryRoute(location.pathname)
  const defaultType = ENTRY_TYPES[context.defaultKind]
  const readOnlyNotebook = context.defaultKind === 'note' && notebookOrigin === 'feed'
  const DefaultIcon = readOnlyNotebook ? DocumentDuplicateIcon : defaultType.icon
  const defaultLabel = readOnlyNotebook ? 'Clone notebook' : `New ${defaultType.label}`

  useEffect(() => {
    let cancelled = false
    setNotebookOrigin(null)
    if (!context.notebookSlug) return
    void notebookService.getAllNotebooks().then(notebooks => {
      if (!cancelled) {
        const found = notebooks.find(notebook => notebook.slug === context.notebookSlug)
        setNotebookOrigin(found ? found.origin : 'user')
      }
    }).catch(() => {
      if (!cancelled) setNotebookOrigin('user')
    })
    return () => { cancelled = true }
  }, [context.notebookSlug])

  const cloneCurrentNotebook = async (notebookSlug: string) => {
    setCloning(true)
    try {
      const notebooks = await notebookService.getAllNotebooks()
      const source = notebooks.find(notebook => notebook.slug === notebookSlug)
      const name = source?.name ?? notebookSlug
      const clone = await notebookService.create(`${name} copy`, source?.description ?? '', source?.icon ?? '📓')
      const notes = await notebookService.listNotes(notebookSlug)
      for (const note of notes) {
        await notebookService.cloneNote(note.id, clone.slug)
      }
      navigate(notebookPath(clone.slug))
    } finally {
      setCloning(false)
    }
  }

  const handleClick = () => {
    if (cloning) return
    if (readOnlyNotebook && context.notebookSlug) {
      void cloneCurrentNotebook(context.notebookSlug)
      return
    }
    openCreateJournal({
      kind: context.defaultKind,
      notebookSlug: context.notebookSlug,
      date: context.defaultDate,
    })
  }

  const waitingForOwnership = context.defaultKind === 'note' && notebookOrigin === null

  return (
    <div className="inline-flex items-center" data-testid="new-entry-combo">
      <Button
        type="button"
        size="sm"
        className={isMobile ? 'size-11 rounded-full px-0' : 'h-9 gap-1.5 px-3 text-xs'}
        disabled={cloning || waitingForOwnership}
        onClick={handleClick}
        aria-label={defaultLabel}
        title={defaultLabel}
        data-testid={context.defaultKind === 'effort'
          ? 'efforts-create-btn'
          : context.defaultKind === 'notebook'
            ? 'notebooks-create-button'
            : 'new-entry-primary'}
      >
        {cloning
          ? <PlusIcon className="size-3.5 animate-spin" />
          : <DefaultIcon className="size-3.5" />}
        {!isMobile && <span>{cloning ? 'Cloning…' : defaultLabel}</span>}
      </Button>
    </div>
  )
}
