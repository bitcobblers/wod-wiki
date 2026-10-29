import { useState, type ComponentType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BeakerIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  PlusIcon,
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
import { createPlaygroundPage } from '../../services/createPlaygroundPage'
import { journalNotes } from '../../services/journalNotes'
import { DEFAULT_PLAYGROUND_CONTENT } from '../../templates/defaultPlaygroundContent'
import { effortPath, equipmentPath, notebookItemPath, notebookPath, playgroundPath } from '../../lib/routes'

export type NewEntryKind = 'journal' | 'playground' | 'notebook' | 'note' | 'effort' | 'equipment'

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
}

const UNIVERSAL_KINDS: NewEntryKind[] = ['journal', 'playground', 'notebook', 'effort', 'equipment']

/** Route context is the only source for scoped creation: no notebook slug,
 *  no notebook-note action. Detail routes retain their notebook context. */
export function resolveNewEntryRoute(pathname: string): NewEntryRouteContext {
  const notebookMatch = /^\/notebook\/([^/]+)/.exec(pathname)
  if (notebookMatch?.[1]) {
    return { defaultKind: 'note', notebookSlug: decodeURIComponent(notebookMatch[1]) }
  }
  if (pathname === '/notebooks') return { defaultKind: 'notebook' }
  if (pathname.startsWith('/playground')) return { defaultKind: 'playground' }
  if (pathname.startsWith('/effort')) return { defaultKind: 'effort' }
  if (pathname.startsWith('/equipment')) return { defaultKind: 'equipment' }
  return { defaultKind: 'journal' }
}

export function NewEntryCombo() {
  const location = useLocation()
  const navigate = useNavigate()
  const { openCreateJournal } = useNav()
  const [notebookOpen, setNotebookOpen] = useState(false)
  const [creating, setCreating] = useState<NewEntryKind | null>(null)
  const context = resolveNewEntryRoute(location.pathname)
  const defaultType = ENTRY_TYPES[context.defaultKind]
  const DefaultIcon = defaultType.icon
  const availableTypes = [
    ...(context.notebookSlug ? [ENTRY_TYPES.note] : []),
    ...UNIVERSAL_KINDS.map(kind => ENTRY_TYPES[kind]),
  ]

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
      if (!context.notebookSlug) return
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

  return (
    <>
      <div className="inline-flex items-center" data-testid="new-entry-combo">
        <Button
          type="button"
          size="sm"
          className="h-9 gap-1.5 rounded-r-none px-2.5 text-xs"
          disabled={creating !== null}
          onClick={() => void createEntry(context.defaultKind)}
          data-testid={context.defaultKind === 'effort'
            ? 'efforts-create-btn'
            : context.defaultKind === 'notebook'
              ? 'notebooks-create-button'
              : 'new-entry-primary'}
        >
          {creating === context.defaultKind
            ? <PlusIcon className="size-3.5 animate-spin" />
            : <DefaultIcon className="size-3.5" />}
          <span>{creating === context.defaultKind ? 'Creating…' : `New ${defaultType.label}`}</span>
        </Button>
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
              const Icon = type.icon
              return (
                <DropdownMenuItem
                  key={type.kind}
                  className="gap-2"
                  onClick={() => void createEntry(type.kind)}
                  data-testid={`new-entry-${type.kind}`}
                >
                  <Icon className="size-4" />
                  <span>New {type.label}</span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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
