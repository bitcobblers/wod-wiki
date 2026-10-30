import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { JournalPageShell } from '@/panels/page-shells'
import { CalendarCard } from '@/components/atoms/CalendarCard'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { localDateKey } from '@/lib/dateFormat'
import { notebookService } from '@/hooks/useBrowserServices'
import type { HistoryRecord } from '@/types/history'
import { notePath, notebookDatePath, notebookPath } from '../lib/routes'
import { formatDateKey } from '../services/dateUtils'
import { useNav } from '../nav/NavContext'
import type { NavItemL3 } from '../nav/navTypes'
import { PageActions } from './shared/PageActions'
import { NewEntryCombo } from './shared/NewEntryCombo'
import { appendTimerBlock } from './shared/pageUtils'
import { journalNotes } from '../services/journalNotes'
import { ResponsiveActions } from '../nav/ResponsiveActions'
import {
  NoteContextNav,
  useNotebookEntryDates,
  EMPTY_NOTE_CONTEXT,
} from './shared/noteContextLinks'
import type { MenuSpec } from '../nav/menuModel'

const contentProvider = new IndexedDBContentProvider()

export interface NotebookDatePageProps {
  slug: string
  date: string
  theme: string
}

interface DayGroup {
  id: string
  label: string
  entries: HistoryRecord[]
}

/**
 * Group the day's notes by their first tag — the listing group-index contract
 * (L3 = groups of the current grouping, clicking scrolls). ponytail: first tag
 * only, so entries stay in one group; multi-tag membership lands with the
 * stream's entryGrouping when this page moves onto StreamProfile.
 */
function groupByTag(entries: HistoryRecord[]): DayGroup[] {
  const map = new Map<string, HistoryRecord[]>()
  for (const entry of entries) {
    const tag = entry.tags[0]?.toLowerCase() ?? 'untagged'
    const group = map.get(tag) ?? []
    group.push(entry)
    map.set(tag, group)
  }
  return Array.from(map.entries()).map(([tag, groupEntries]) => ({
    id: `day-group-${tag}`,
    label: tag === 'untagged' ? 'Untagged' : `#${tag}`,
    entries: groupEntries,
  }))
}

/**
 * The local civil day an entry occupies on this route — its authored date
 * (seed frontmatter `date:`, noon-UTC epoch) with createdAt as the undated
 * fallback, so placement never depends on import time for dated posts.
 */
export function entryDateKey(entry: Pick<HistoryRecord, 'targetDate'>): string {
  return formatDateKey(new Date(entry.targetDate))
}

/**
 * /notebook/:slug/:date — a date-scoped, journal-style view of one
 * notebook: every notebook note dated `:date`, listed and linked to its
 * single-note route, grouped by tag with an L3 group index.
 *
 * Undated notes place at their import time, so a date may legitimately list
 * nothing; seed frontmatter `date:` places dated posts on their own day.
 */
export function NotebookDatePage({ slug, date }: NotebookDatePageProps) {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<HistoryRecord[] | null>(null)

  useEffect(() => {
    let cancelled = false
    contentProvider
      .getRecords()
      .then((all) => {
        if (cancelled) return
        const inNotebook = all.filter((entry) => {
          if (!entry.sourceId?.startsWith(`notebook:${slug}`)) return false
          return entryDateKey(entry) === date
        })
        setEntries(inNotebook.sort((a, b) => b.createdAt - a.createdAt))
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [slug, date])

  const groups = useMemo(() => (entries ? groupByTag(entries) : []), [entries])

  // Whiteboard "notebook day" L3: On this page (tag groups) first, then date
  // navigation. New note is the sticky/dock primary, not an L3 row.
  const handleAddTimer = useCallback(async () => {
    const created = await journalNotes.create({
      journalDate: date,
      title: 'Untitled note',
      rawContent: `# Untitled note\n\n${appendTimerBlock('')}`,
      type: 'note',
    })
    await notebookService.moveNote(created.id, slug)
    navigate(notePath(created.id))
  }, [date, slug, navigate])
  const { setL3Items } = useNav()
  useEffect(() => {
    const links: NavItemL3[] = groups.map(group => ({
      id: group.id,
      label: group.label,
      level: 3,
      action: { type: 'scroll', sectionId: group.id },
    }))
    links.push({
      id: 'helpful-add-timer',
      label: 'Add timer',
      level: 3,
      action: { type: 'call', handler: () => void handleAddTimer() },
    })
    if (slug) {
      links.push({
        id: 'helpful-today',
        label: 'Today',
        level: 3,
        action: { type: 'call', handler: () => navigate(notebookDatePath(slug, localDateKey(new Date()))) },
      })
    }
    setL3Items(links)
    return () => setL3Items([])
  }, [groups, setL3Items, slug, navigate, handleAddTimer])

  // ── L2 (whiteboard "notebook day"): Up to this notebook; calendar scoped
  // to notebook dates; recent notes in the notebook.
  const notebookDates = useNotebookEntryDates(slug)
  const up = useMemo(() => ({ id: slug, title: slug, to: notebookPath(slug) }), [slug])
  const calendar = (
    <CalendarCard
      selectedDate={new Date(`${date}T12:00:00`)}
      onDateSelect={(picked) => navigate(notebookDatePath(slug, localDateKey(picked)))}
      entryDates={notebookDates}
    />
  )
  const recentSection = useMemo<MenuSpec>(() => [
    {
      kind: 'wql',
      id: 'recent-notebook-notes',
      label: 'Recent notes',
      query: `:note{notebook:${slug}}`,
      limit: 6,
      toEntry: (e) => notePath(e.id),
    },
  ], [slug])

  const body = entries === null
    ? <div className="flex flex-1 items-center justify-center text-zinc-400">Loading…</div>
    : entries.length === 0
      ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            No notes in this notebook for {date}.
          </p>
        )
      : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.id} id={group.id} className="flex flex-col rounded-lg border border-border overflow-hidden">
                <h3 className="px-4 py-2 text-xs font-black uppercase tracking-wider text-muted-foreground bg-muted/40">
                  {group.label} · {group.entries.length}
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        to={notePath(entry.id)}
                        className="flex flex-col gap-0.5 px-4 py-3 hover:bg-muted/50"
                      >
                        <span className="font-medium">{entry.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleTimeString()}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )

  return (
    <JournalPageShell
      title={date}
      subtitle={slug}
      actions={
        // Whiteboard "notebook day" sticky: New note in this notebook
        // (NewEntryCombo resolves this route to a note in `slug`; read-only
        // notebooks get Clone), plus Cast, sync, and page options. Mobile:
        // New note rides the dock, Cast stays in the navbar.
        <ResponsiveActions label="Notebook day actions" primary={<NewEntryCombo />}>
          <PageActions
            mode="notebook-readonly"
            currentWorkout={{ name: `${slug} · ${date}`, content: '' }}
            index={[]}
          />
        </ResponsiveActions>
      }
      editor={
        <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
          <NoteContextNav
            data={EMPTY_NOTE_CONTEXT}
            up={up}
            calendar={calendar}
            sections={recentSection}
          />
          {body}
        </div>
      }
    />
  )
}
