/**
 * ReadmeQueryBlock — renders one WQL embed (`[heading](:query)!`) from a
 * collection README: runs the query through the default stream engine and
 * lists the results with the same row component the catalog shelf uses.
 * An empty heading renders no title.
 *
 * Ordering is deterministic regardless of executor order: by date (undated
 * last), then title with numeric-aware comparison (`Event 2` before
 * `Event 10`). A query grouping `by {date}` additionally renders a date
 * subheading per group — the day subdivision year sections use.
 */
import { useEffect, useMemo, useState } from 'react'
import { parseQuery } from '@bitcobblers/wod-wiki-engine'
import type { Entry } from '../../lib/entryMapper'
import { defaultStreamQueryEngine } from '../../lib/entrySearch'
import { LibraryRow } from '../library/LibraryRow'

const UNDATED = '9999-12-31'

function compareEntries(a: Entry, b: Entry): number {
  return (a.date ?? UNDATED).localeCompare(b.date ?? UNDATED)
    || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
}

function formatDateGroup(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function ReadmeQueryBlock({
  query,
  heading,
  onAddToToday,
  onRunStart,
}: {
  query: string
  /** Embed link text — rendered as the block's heading; '' renders none. */
  heading: string
  onAddToToday?: (entry: Entry) => void
  onRunStart?: (entry: Entry) => void
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setError(null)
    defaultStreamQueryEngine
      .query(query)
      .then(results => {
        if (!cancelled) setEntries([...results].sort(compareEntries))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [query])

  // `by {date}` renders date subheadings; other queries render a flat list.
  const dateGroups = useMemo(() => {
    if (!entries) return null
    const parsed = parseQuery(query)
    if (parsed.error || !('groupBy' in parsed) || !parsed.groupBy?.includes('date')) return null
    const groups = new Map<string, Entry[]>()
    for (const entry of entries) {
      const key = entry.date ?? ''
      const group = groups.get(key)
      if (group) group.push(entry)
      else groups.set(key, [entry])
    }
    return [...groups.entries()]
  }, [entries, query])

  if (error) {
    return (
      <p className="my-3 text-xs text-destructive" data-testid="readme-query-error">
        Query failed: {error}
      </p>
    )
  }
  if (entries === null) {
    return (
      <div className="my-3 text-xs text-muted-foreground/60" data-testid="readme-query-loading">
        Loading…
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <p className="my-3 text-xs text-muted-foreground/60" data-testid="readme-query-empty">
        No entries match this query.
      </p>
    )
  }
  const renderRow = (entry: Entry) => (
    <LibraryRow key={entry.id} entry={entry} onAddToToday={onAddToToday} onRunStart={onRunStart} />
  )
  return (
    <div className="my-3 not-prose" data-testid="readme-query-block">
      {heading && (
        <p className="mt-4 mb-1 text-sm font-bold text-foreground" data-testid="readme-query-heading">
          {heading}
        </p>
      )}
      {dateGroups ? (
        dateGroups.map(([date, group]) => (
          <div key={date || 'undated'} className="mt-3" data-testid="readme-query-date-group">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {date ? formatDateGroup(date) : 'Undated'}
            </p>
            <div className="divide-y divide-border/40">{group.map(renderRow)}</div>
          </div>
        ))
      ) : (
        <div className="divide-y divide-border/40">{entries.map(renderRow)}</div>
      )}
    </div>
  )
}
