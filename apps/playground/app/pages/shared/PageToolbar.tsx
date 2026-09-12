/**
 * Shared toolbar UI components for playground page components.
 *
 * Extracted from App.tsx so individual page components can be imported in
 * isolation (e.g. from Storybook stories) without pulling in the entire app.
 */

import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuHeading,
} from '@/components/atoms/primitives/dropdown-menu'
import { Button } from '@/components/atoms/primitives/button'
import {
  EllipsisVerticalIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/20/solid'
import { PlusIcon } from '@heroicons/react/16/solid'

import { useNav } from '../../nav/NavContext'
import { useResolvedMenu } from '../../nav/MenuList'
import { CalendarSplitButton } from '@/components/molecules/CalendarSplitButton'
import type { NavItemL3 } from '../../nav/navTypes'
// ── NewEntryButton ───────────────────────────────────────────────────────────

export function NewEntryButton() {
  const navigate = useNavigate()
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const navigateToDate = (date: Date | null) => {
    if (!date) return
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    navigate(`/journal/${y}-${m}-${d}`)
  }

  return (
    <CalendarSplitButton
      primary={{
        id: 'new-entry',
        label: 'New',
        icon: PlusIcon,
        action: { type: 'call', handler: () => navigateToDate(new Date()) },
      }}
      selectedDate={selectedDate}
      onDateSelect={(date) => {
        setSelectedDate(date)
        navigateToDate(date)
      }}
      size="sm"
    />
  )
}


// ── Page options ─────────────────────────────────────────────────────────────

/** One heading or actionable row of the Page options surface — shared by the
 *  desktop dropdown (ActionsMenu) and the mobile dock sheet's stacked
 *  buttons. `nav` marks navigation-derived entries (secondary sections +
 *  On this page); the desktop dropdown hides those at ≥2xl where the
 *  secondary rail owns them, the mobile sheet always shows them. */
export type PageOptionsEntry =
  | { kind: 'heading'; id: string; label: string; nav: boolean }
  | {
      kind: 'row'
      id: string
      label: string
      icon?: ReactNode
      nav: boolean
      onSelect: () => void
      secondary?: { label: string; icon?: ReactNode; onSelect: () => void }
    }

export function usePageOptionsEntries(
  currentWorkout: { name: string; content: string },
  items?: NavItemL3[],
  onDownload?: () => void,
): PageOptionsEntry[] {
  const navigate = useNavigate()
  const { l3Items: contextL3, scrollToSection, secondarySpec } = useNav()
  const l3Items = items && items.length > 0 ? items : contextL3
  const resolvedSecondary = useResolvedMenu(secondarySpec)

  const entries: PageOptionsEntry[] = []
  for (const section of resolvedSecondary) {
    if (section.kind === 'section') {
      if (section.entries.length === 0) continue
      entries.push({ kind: 'heading', id: section.id, label: section.label, nav: true })
      for (const entry of section.entries) {
        entries.push({
          kind: 'row',
          id: entry.id,
          label: entry.label,
          nav: true,
          onSelect: () => {
            if (entry.onRun) entry.onRun()
            else if (entry.to) navigate(entry.to)
            else if (entry.sectionId) scrollToSection(entry.sectionId)
          },
        })
      }
    } else {
      entries.push({
        kind: 'row',
        id: section.id,
        label: section.label,
        nav: true,
        onSelect: () => {
          if (section.onRun) section.onRun()
          else if (section.to) navigate(section.to)
          else if (section.sectionId) scrollToSection(section.sectionId)
        },
      })
    }
  }

  if (l3Items.length > 0) {
    entries.push({ kind: 'heading', id: 'on-this-page', label: 'On this page', nav: true })
    for (const item of l3Items) {
      entries.push({
        kind: 'row',
        id: item.id,
        label: item.label,
        nav: true,
        secondary: item.secondaryAction
          ? {
              label: item.secondaryAction.label,
              icon: item.secondaryAction.icon && <item.secondaryAction.icon className="size-3.5" />,
              onSelect: () => {
                if (item.secondaryAction?.action.type === 'call') item.secondaryAction.action.handler()
              },
            }
          : undefined,
        onSelect: () => {
          if (item.action.type === 'call') item.action.handler()
          else scrollToSection(item.id)
        },
      })
    }
  }

  // The menu exports the route-resolved document. Pages whose content loads
  // in-page (playground/journal editors) resolve to an empty string here —
  // omit the row rather than download a stub.
  if (currentWorkout.content !== '') {
    entries.push({
      kind: 'row',
      id: 'download-markdown',
      label: 'Download Markdown',
      icon: <ArrowDownTrayIcon className="size-4" />,
      nav: false,
      onSelect: () => {
        if (onDownload) {
          onDownload()
          return
        }
        const blob = new Blob([currentWorkout.content], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const safeName = currentWorkout.name.replace(/[/\\:*?"<>|]/g, '-')
        a.download = `${safeName}.md`
        a.click()
        URL.revokeObjectURL(url)
      },
    })
  }

  return entries
}

export function ActionsMenu({
  currentWorkout,
  onDownload,
  items,
}: {
  currentWorkout: { name: string; content: string }
  onDownload?: () => void
  items?: NavItemL3[]
}) {
  const entries = usePageOptionsEntries(currentWorkout, items, onDownload)
  const asMenuItem = (entry: PageOptionsEntry) => {
    if (entry.kind === 'heading') {
      return <DropdownMenuHeading key={entry.id}>{entry.label}</DropdownMenuHeading>
    }
    return (
      <DropdownMenuItem key={entry.id} onClick={entry.onSelect} className="gap-2">
        {entry.icon}
        <span className={cn('flex-1 truncate', entry.secondary && 'pr-8')}>{entry.label}</span>
        {entry.secondary && (
          <button
            className="ml-auto flex items-center justify-center size-5 rounded text-primary hover:bg-primary/10 transition-colors"
            title={entry.secondary.label}
            onClick={(e) => {
              e.stopPropagation()
              entry.secondary?.onSelect()
            }}
          >
            {entry.secondary.icon}
          </button>
        )}
      </DropdownMenuItem>
    )
  }

  const navEntries = entries.filter((entry) => entry.nav)
  const actionEntries = entries.filter((entry) => !entry.nav)

  // Nothing to select → no trigger. When only nav rows exist, the 2xl
  // secondary rail owns them, so the trigger also hides from 2xl up where
  // the dropdown itself would be empty.
  if (entries.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Page options"
          className={cn('text-muted-foreground', actionEntries.length === 0 && '2xl:hidden')}
        >
          <EllipsisVerticalIcon className="size-5" />
          <span className="sr-only">Page options</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {/* Navigation sections fold into the menu below 2xl; the secondary
            rail owns them from 2xl up. */}
        {navEntries.length > 0 && (
          <div className="2xl:hidden">
            {navEntries.map(asMenuItem)}
            <DropdownMenuSeparator />
          </div>
        )}
        {actionEntries.map(asMenuItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The same Page options functions as stacked full-width buttons for the
 *  mobile dock sheet — the ⋮ in the thumb stack opens these going up. */
export function PageOptionsSheetRows({
  currentWorkout,
  items,
}: {
  currentWorkout: { name: string; content: string }
  items?: NavItemL3[]
}) {
  const entries = usePageOptionsEntries(currentWorkout, items)
  return (
    <>
      {entries.map((entry) => {
        if (entry.kind === 'heading') {
          return (
            <div
              key={entry.id}
              className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {entry.label}
            </div>
          )
        }
        return (
          <button
            key={entry.id}
            type="button"
            onClick={entry.onSelect}
            className="flex w-full items-center gap-2 rounded-lg px-1 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {entry.icon}
            <span className="flex-1 truncate">{entry.label}</span>
            {entry.secondary && (
              <button
                className="flex size-8 shrink-0 items-center justify-center rounded text-primary hover:bg-primary/10"
                title={entry.secondary.label}
                onClick={(e) => {
                  e.stopPropagation()
                  entry.secondary?.onSelect()
                }}
              >
                {entry.secondary.icon}
              </button>
            )}
          </button>
        )
      })}
    </>
  )
}
