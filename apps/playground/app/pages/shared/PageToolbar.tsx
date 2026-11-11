/**
 * Shared toolbar UI components for playground page components.
 *
 * Extracted from App.tsx so individual page components can be imported in
 * isolation (e.g. from Storybook stories) without pulling in the entire app.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownTrayIcon } from '@heroicons/react/20/solid'
import { PlusIcon } from '@heroicons/react/16/solid'

import { useCloseNavigationDrawer } from '../../nav/NavigationDrawerContext'
import { CalendarSplitButton } from '@/components/molecules/CalendarSplitButton'

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

// ── PageDownloadAction ───────────────────────────────────────────────────────

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

/** Download Markdown row rendered in L3 Slot 3 ("Actions") across every
 *  breakpoint (inline rail at 2xl+ and RightL3Drawer below 2xl). Renders
 *  nothing when there is no resolved document. */
export function PageDownloadAction({
  currentWorkout,
  onDownload,
}: {
  currentWorkout: { name: string; content: string }
  onDownload?: () => void
}) {
  const closeDrawer = useCloseNavigationDrawer()
  if (currentWorkout.content === '') return null
  return (
    <button
      type="button"
      onClick={() => {
        closeDrawer()
        downloadMarkdown(currentWorkout, onDownload)
      }}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <ArrowDownTrayIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Download Markdown</span>
    </button>
  )
}
