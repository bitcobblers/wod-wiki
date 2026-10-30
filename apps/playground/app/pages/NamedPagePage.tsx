import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc'
import { useNav } from '../nav/NavContext'
import type { NavItemL3 } from '../nav/navTypes'
import type { MenuSpec } from '../nav/menuModel'
import { notePath, ROUTE_PATTERNS } from '../lib/routes'
import { NoteContextNav, EMPTY_NOTE_CONTEXT } from './shared/noteContextLinks'
import type { HistoryRecord } from '@/types/history'

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
 *
 * L2 (whiteboard "canvas, guide, and named page"): Up to Pages, then the
 * notes placed here. L3: on-this-page links over the listed notes + Copy
 * link. Cast rides the shared navbar on mobile and the header on desktop.
 */
export function NamedPagePage({ slug }: NamedPagePageProps) {
  const [entries, setEntries] = useState<HistoryRecord[] | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    contentProvider
      .getPageRecords(slug)
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

  const handleCopyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [])

  // L3: the listed notes as scroll anchors, Copy link after.
  const { setL3Items } = useNav()
  useEffect(() => {
    const links: NavItemL3[] = (entries ?? []).map(entry => ({
      id: `page-note-${entry.id}`,
      label: entry.title || 'Untitled',
      level: 3,
      action: { type: 'scroll', sectionId: `page-note-${entry.id}` },
    }))
    links.push({
      id: 'helpful-copy-link',
      label: copied ? 'Copied' : 'Copy link',
      level: 3,
      action: { type: 'call', handler: handleCopyLink },
    })
    setL3Items(links)
    return () => setL3Items([])
  }, [entries, copied, handleCopyLink, setL3Items])

  // L2: Up to the Pages library + the notes placed on this page.
  const up = useMemo(
    () => ({ id: 'pages', title: 'Pages', to: ROUTE_PATTERNS.pages }),
    [],
  )
  const pageSections = useMemo<MenuSpec>(() => [
    {
      kind: 'section',
      id: 'page-notes',
      label: 'Notes on this page',
      entries: (entries ?? []).map(entry => ({
        kind: 'link' as const,
        id: entry.id,
        label: entry.title || 'Untitled',
        to: notePath(entry.id),
      })),
    },
  ], [entries])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <NoteContextNav data={EMPTY_NOTE_CONTEXT} up={up} sections={pageSections} />
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">/page/{slug}</h1>
          <p className="text-sm text-muted-foreground">
            {entries === null
              ? 'Loading…'
              : entries.length === 0
                ? 'No notes are placed on this page yet.'
                : `${entries.length} ${entries.length === 1 ? 'note' : 'notes'} on this page.`}
          </p>
        </div>
        {/* Cast: shared navbar on mobile, desktop header here. */}
        <div className="max-lg:hidden">
          <CastButtonRpc />
        </div>
      </header>
      {entries !== null && entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} id={`page-note-${entry.id}`}>
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
