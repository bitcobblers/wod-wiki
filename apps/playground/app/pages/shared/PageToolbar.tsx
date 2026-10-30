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
import { StreamControlsNav } from '../../nav/SecondaryNav'
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
    navigate(`/day/${y}-${m}-${d}`)
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

/** One heading or actionable row of the Page options surface — shared by
 *  the desktop dropdown (ActionsMenu) and the mobile dock sheet's stacked
 *  buttons. `nav` marks navigation-derived entries (stream controls,
 *  secondary sections + On this page); below 2xl the ⋯ surfaces render the
 *  same L3 content as the right rail, at ≥2xl the rail owns it all and the
 *  ⋯ hides. `custom` entries render live components (no menu-item chrome);
 *  the dropdown wraps them so interactions don't dismiss the menu. */
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
  | { kind: 'custom'; id: string; nav: boolean; render: () => ReactNode }

/** Default Download Markdown behavior: export the resolved document. Pages
 *  whose content loads in-page (playground/journal editors) resolve to an
 *  empty string — callers hide the row rather than download a stub. */
export function downloadMarkdown(
  currentWorkout: { name: string; content: string },
  onDownload?: () => void,
): void {
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
}

/** Download Markdown as an L3 rail row (2xl+) — the same action the ⋯
 *  surfaces carry below 2xl. Renders nothing when there is no document. */
export function PageDownloadAction({
  currentWorkout,
  onDownload,
}: {
  currentWorkout: { name: string; content: string }
  onDownload?: () => void
}) {
  if (currentWorkout.content === '') return null
  return (
    <button
      type="button"
      onClick={() => downloadMarkdown(currentWorkout, onDownload)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <ArrowDownTrayIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Download Markdown</span>
    </button>
  )
}

export function usePageOptionsEntries(
  currentWorkout: { name: string; content: string },
  items?: NavItemL3[],
  onDownload?: () => void,
): PageOptionsEntry[] {
  const navigate = useNavigate()
  const { l3Items: contextL3, scrollToSection, secondarySpec, streamControls } = useNav()
  const l3Items = items && items.length > 0 ? items : contextL3
  const resolvedSecondary = useResolvedMenu(secondarySpec)

  const entries: PageOptionsEntry[] = []
  // The ⋯ surfaces mirror the right rail: stream (view) controls, the route
  // secondary menu, then On this page. Same components, same state. Where
  // filters stay in the L2 panel only.
  if (streamControls) {
    entries.push({
      kind: 'custom',
      id: 'l3-stream-controls',
      nav: true,
      render: () => <StreamControlsNav streamControls={streamControls} />,
    })
  }
  for (const section of resolvedSecondary) {
    if (section.kind === 'section') {
      if (section.entries.length === 0) continue
      entries.push({ kind: 'heading', id: section.id, label: section.label, nav: true })
      for (const entry of section.entries) {
        if (entry.kind !== 'link') continue
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
    } else if (section.kind === 'widget') {
      continue
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
      onSelect: () => downloadMarkdown(currentWorkout, onDownload),
    })
  }

  return entries
}

/** Mobile thumb … rows — the same resolved L3 entries as the rail and
 *  desktop ⋯ menu, rendered as ≥44px dock-sheet actions. */
export interface MobilePageOptionsRowsProps {
  currentWorkout: { name: string; content: string }
  onDownload?: () => void
  items?: NavItemL3[]
}

export function MobilePageOptionsRows({
  currentWorkout,
  onDownload,
  items,
}: MobilePageOptionsRowsProps) {
  const entries = usePageOptionsEntries(currentWorkout, items, onDownload)
  return entries.map(entry => {
    if (entry.kind === 'heading') {
      return <div key={entry.id} className="px-2 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{entry.label}</div>
    }
    if (entry.kind === 'custom') {
      return <div key={entry.id}>{entry.render()}</div>
    }
    return (
      <button
        key={entry.id}
        type="button"
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent"
        onClick={entry.secondary ? entry.secondary.onSelect : entry.onSelect}
      >
        {entry.icon}
        <span>{entry.secondary?.label ?? entry.label}</span>
      </button>
    )
  })
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
    if (entry.kind === 'custom') {
      // Live components (stream controls) sit in a plain region, not a
      // menuitem, so toggling a checkbox or opening the nested window
      // picker does not dismiss the menu.
      return (
        <div key={entry.id} className="px-1 py-1">
          {entry.render()}
        </div>
      )
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

  // Nothing to select → no trigger. The ⋯ is purely the narrow-screen
  // rendering of the L3 rail (stream controls, secondary menu, On this
  // page, download): every entry also lives in the 2xl+ rail, so the
  // trigger hides from 2xl up.
  if (entries.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Page options"
          className={cn('text-muted-foreground', '2xl:hidden')}
        >
          <EllipsisVerticalIcon className="size-5" />
          <span className="sr-only">Page options</span>
        </Button>
      </DropdownMenuTrigger>
      {/* The facet accordion can grow tall — cap the menu at the viewport
          so expanded sections stay scrollable between lg and 2xl. */}
      <DropdownMenuContent align="end" className="min-w-56 max-h-[calc(100dvh-6rem)] overflow-y-auto">
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

