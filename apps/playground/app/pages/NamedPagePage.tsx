import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { notePath } from '../lib/routes'
import type { HistoryEntry } from '@/types/history'

const contentProvider = new IndexedDBContentProvider()

export interface NamedPagePageProps {
  /** The /page/:slug route slug — the named page being listed. */
  slug: string
}

/**
 * /page/:slug — a named page's own listing. Shows every note placed on the
 * page in canonical placement order; each note opens at its own canonical
 * route (/note/:noteId), never at another note's page. Canvas routes keep
 * precedence — this page renders only when no canvas page claims the slug.
 */
export function NamedPagePage({ slug }: NamedPagePageProps) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    contentProvider
      .getPageEntries(slug)
      .then((loaded) => {
        if (!cancelled) setEntries(loaded)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">/page/{slug}</h1>
        <p className="text-sm text-muted-foreground">
          {entries === null
            ? 'Loading…'
            : entries.length === 0
              ? 'No notes are placed on this page yet.'
              : `${entries.length} ${entries.length === 1 ? 'note' : 'notes'} on this page.`}
        </p>
      </header>
      {entries !== null && entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                to={notePath(entry.id)}
                className="block rounded-md border border-border px-3 py-2 hover:bg-muted"
              >
                <span className="text-sm font-medium">{entry.title || 'Untitled'}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">/note/{entry.id}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
