import { useEffect, useState, type ComponentType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BeakerIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  PlusIcon,
  RectangleStackIcon,
  TagIcon,
} from '@heroicons/react/20/solid'
import { Dumbbell, Flame } from 'lucide-react'

import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { notebookService } from '@/hooks/useBrowserServices'
import { isSystemReadOnlyNotebook } from '@bitcobblers/wod-wiki-core'
import { playgroundFeedCatalogStore } from '@/services/feed/feedCatalog'
import { canonicalNotebookSlug } from '@/services/feed/feedSources'
import { cn } from '@/lib/utils'

import { useNav } from '../../nav/NavContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { notebookPath } from '../../lib/routes'

export type NewEntryKind = 'journal' | 'playground' | 'notebook' | 'note' | 'effort' | 'equipment' | 'tag' | 'page'

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
  effort: { kind: 'effort', label: 'Effort', icon: Flame },
  equipment: { kind: 'equipment', label: 'Equipment', icon: Dumbbell },
  tag: { kind: 'tag', label: 'Tag', icon: TagIcon },
  page: { kind: 'page', label: 'Page', icon: RectangleStackIcon },
}

/** Creation is a library/collection capability, never a detail-page fallback. */
export function routeSupportsCreation(pathname: string): boolean {
  // ponytail: literal '/' match; upgrade to normalized path regex if home gains subpath aliases.
  return pathname === '/'
    || /^\/(?:journal|playgrounds|notebooks|pages|efforts|equipment|tags)\/?$/.test(pathname)
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
  if (pathname === '/tags') return { defaultKind: 'tag' }
  if (pathname.startsWith('/playground')) return { defaultKind: 'playground' }
  if (pathname.startsWith('/effort')) return { defaultKind: 'effort' }
  if (pathname.startsWith('/equipment')) return { defaultKind: 'equipment' }
  return { defaultKind: 'journal' }
}

export function isReadOnlyNotebookOrigin(
  slug: string | undefined,
  origin: 'user' | 'default' | 'feed' | null,
): boolean {
  if (!slug) return false
  if (origin === 'feed') return true
  if (isSystemReadOnlyNotebook(slug)) return true
  return false
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
  const readOnlyNotebook =
    context.defaultKind === 'note'
    && isReadOnlyNotebookOrigin(context.notebookSlug, notebookOrigin)
  const DefaultIcon = readOnlyNotebook ? DocumentDuplicateIcon : defaultType.icon
  const defaultLabel = readOnlyNotebook ? 'Clone notebook' : `New ${defaultType.label}`
  /** Sticky headers keep the button short: "+ Add" (the icon and the
   *  accessible name still carry the type). A clone is not an add — it keeps
   *  its own verb. */
  const visibleLabel = readOnlyNotebook ? 'Clone notebook' : '+ Add'

  useEffect(() => {
    let cancelled = false
    setNotebookOrigin(null)
    if (!context.notebookSlug) return
    const targetSlug = context.notebookSlug
    if (isSystemReadOnlyNotebook(targetSlug)) {
      setNotebookOrigin('default')
      return
    }
    void (async () => {
      try {
        const notebooks = await notebookService.getAllNotebooks()
        if (cancelled) return
        const found = notebooks.find(notebook => notebook.slug === targetSlug)
        if (found) {
          setNotebookOrigin(found.origin)
          return
        }
        const remoteNotebooks = await playgroundFeedCatalogStore.getAllNotebooks().catch(() => [])
        if (cancelled) return
        const inRemoteFeed = remoteNotebooks.some(
          nb => nb.slug === targetSlug || canonicalNotebookSlug(nb.slug) === canonicalNotebookSlug(targetSlug),
        )
        setNotebookOrigin(inRemoteFeed ? 'feed' : 'user')
      } catch {
        if (!cancelled) setNotebookOrigin('user')
      }
    })()
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
      void navigate(notebookPath(clone.slug))
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
        className={isMobile ? 'h-11 rounded-full px-3.5 gap-1.5 shadow-lg text-xs font-semibold' : 'h-9 gap-1.5 px-3 text-xs'}
        disabled={cloning || waitingForOwnership}
        onClick={handleClick}
        aria-label={isMobile ? defaultLabel : readOnlyNotebook
          ? defaultLabel
          : `${visibleLabel} ${defaultType.label}`}
        title={defaultLabel}
        data-testid={context.defaultKind === 'effort'
          ? 'efforts-create-btn'
          : context.defaultKind === 'notebook'
            ? 'notebooks-create-button'
            : 'new-entry-primary'}
      >
        {isMobile ? (
          readOnlyNotebook ? (
            <DocumentDuplicateIcon className={cn('size-4 shrink-0', cloning && 'animate-spin')} />
          ) : (
            <PlusIcon className={cn('size-4 shrink-0', cloning && 'animate-spin')} />
          )
        ) : cloning ? (
          <PlusIcon className="size-3.5 animate-spin" />
        ) : (
          <DefaultIcon className="size-3.5" />
        )}
        {isMobile ? (
          <span>{cloning ? 'Cloning…' : readOnlyNotebook ? 'Clone' : 'New'}</span>
        ) : (
          <span>{cloning ? 'Cloning…' : visibleLabel}</span>
        )}
      </Button>
    </div>
  )
}
