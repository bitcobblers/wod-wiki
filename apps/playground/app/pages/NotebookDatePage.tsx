import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { JournalPageShell } from '@/panels/page-shells'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { notePath } from '../lib/routes'
import { formatDateKey } from '../services/dateUtils'
import { useNav } from '../nav/NavContext'
import type { NavItemL3 } from '../nav/navTypes'
import type { HistoryRecord } from '@/types/history'

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
    const bucket = map.get(tag)
    if (bucket) bucket.push(entry)
    else map.set(tag, [entry])
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

  // Publish the group index (publish-on-mount / clear-on-unmount, like the
  // stream's group L3 — the shell skips its empty static index here).
  const { setL3Items } = useNav()
  useEffect(() => {
    if (groups.length === 0) {
      setL3Items([])
      return
    }
    const links: NavItemL3[] = groups.map(group => ({
      id: group.id,
      label: group.label,
      level: 3,
      action: { type: 'scroll', sectionId: group.id },
    }))
    setL3Items(links)
    return () => setL3Items([])
  }, [groups, setL3Items])

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
      editor={<div className="flex flex-col gap-6 px-4 py-6 sm:px-6">{body}</div>}
    />
  )
}
