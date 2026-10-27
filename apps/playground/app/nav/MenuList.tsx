/**
 * MenuList — the standardized renderer for shell-menu content.
 *
 * Every menu zone (context sidebar panels, the secondary nav rail, route-
 * declared menus) renders through this component so navigation looks the same
 * everywhere. WQL entries resolve asynchronously via `searchEntries`; a query
 * that fails or returns nothing simply renders no children.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryState } from 'nuqs'
import { cn } from '@/lib/utils'
import { PlayIcon, StopIcon, ArrowTopRightOnSquareIcon, PencilSquareIcon } from '@heroicons/react/20/solid'

import { searchEntries } from '../lib/entrySearch'
import { useNav } from './NavContext'
import { useCloseNavigationDrawer } from './NavigationDrawerContext'
import type { MenuEntry, MenuLink, MenuSection, MenuSpec, MenuWql } from './menuModel'

// ── WQL resolution ───────────────────────────────────────────────────────────

/** Signature of a spec's WQL entries — the resolution effect re-runs only when it changes. */
function wqlSignature(spec: MenuSpec | undefined): string {
  if (!spec) return ''
  return spec
    .map(e => (e.kind === 'wql' ? `${e.id}|${e.query}|${e.limit ?? ''}` : `s:${e.id}`))
    .join(';')
}

async function resolveWql(entry: MenuWql): Promise<MenuSection> {
  try {
    const found = await searchEntries(entry.query)
    const rows = found
      .filter(e => (entry.filterEntry ? entry.filterEntry(e) : true))
      .slice(0, entry.limit ?? 6)
      .map(e => ({
        kind: 'link' as const,
        id: `${entry.id}:${e.id}`,
        label: entry.labelFromEntry ? entry.labelFromEntry(e) : e.title,
        to: entry.toEntry ? entry.toEntry(e) : undefined,
        muted: true,
      }))
    return { kind: 'section', id: entry.id, label: entry.label, entries: rows }
  } catch {
    // Invalid WQL or unavailable store — degrade to an empty (hidden) section.
    return { kind: 'section', id: entry.id, label: entry.label, entries: [] }
  }
}

/**
 * Resolve a MenuSpec: WQL entries become populated sections. Re-runs only when
 * the spec's WQL signature changes (specs are usually inline literals).
 */
export function useResolvedMenu(spec: MenuSpec | undefined): MenuEntry[] {
  const signature = wqlSignature(spec)
  const specRef = useRef(spec)
  specRef.current = spec
  const [resolved, setResolved] = useState<MenuEntry[]>(() =>
    spec && !spec.some(e => e.kind === 'wql') ? spec : [],
  )

  useEffect(() => {
    const current = specRef.current
    if (!current) {
      setResolved([])
      return
    }
    if (!current.some(e => e.kind === 'wql')) {
      setResolved(current)
      return
    }
    let cancelled = false
    Promise.all(current.map(e => (e.kind === 'wql' ? resolveWql(e) : Promise.resolve(e)))).then(
      settled => {
        if (!cancelled) setResolved(settled)
      },
    )
    return () => {
      cancelled = true
    }
  }, [signature])

  return resolved
}

/** Read the URL-synced / context-tracked active in-page section id. */
export function useActiveSectionId(): string {
  const [sParam] = useQueryState('s', { shallow: true })
  const { navState } = useNav()
  const l3Active = (navState as { activeL3Id?: string | null }).activeL3Id ?? ''
  return sParam || l3Active || ''
}

// ── Rendering ────────────────────────────────────────────────────────────────

function MenuRow({
  entry,
  active,
  onActivate,
}: {
  entry: MenuLink
  active: boolean
  onActivate: (entry: MenuLink) => void
}) {
  const run = entry.onRun
  return (
    <button
      type="button"
      onClick={() => onActivate(entry)}
      className={cn(
        'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
        entry.muted ? 'text-[11.5px]' : 'text-[13px]',
        active
          ? 'bg-primary/10 font-semibold text-primary'
          : cn(
              'hover:bg-muted/60 hover:text-foreground',
              entry.muted ? 'text-muted-foreground/70' : 'text-muted-foreground',
            ),
      )}
    >
      {entry.icon && <entry.icon className="size-4 shrink-0" />}
      {entry.timestamp && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
          {entry.timestamp}
        </span>
      )}
      <span className="min-w-0 flex-1 line-clamp-2 break-words" title={entry.label}>{entry.label}</span>
      {entry.badge && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">{entry.badge}</span>
      )}
      {run && (
        <span
          role="button"
          tabIndex={-1}
          title={
            entry.runIcon === 'link'
              ? 'View workout'
              : entry.runIcon === 'stop'
                ? 'Stop workout'
                : entry.runIcon === 'edit'
                  ? 'Edit note'
                  : 'Start workout'
          }
          onClick={e => {
            e.stopPropagation()
            entry.onRun?.()
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-primary opacity-0 transition-all group-hover:opacity-100 hover:bg-primary/10"
        >
          {entry.runIcon === 'link' ? (
            <ArrowTopRightOnSquareIcon className="size-3.5" />
          ) : entry.runIcon === 'stop' ? (
            <StopIcon className="size-3.5" />
          ) : entry.runIcon === 'edit' ? (
            <PencilSquareIcon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </span>
      )}
    </button>
  )
}

export function MenuList({
  entries,
  activeId,
  onSection,
}: {
  entries: MenuEntry[]
  activeId?: string
  /** Override for section clicks (defaults to shell scroll + navigate). */
  onSection?: (entry: MenuLink) => void
}) {
  const navigate = useNavigate()
  const { scrollToSection } = useNav()
  const closeDrawer = useCloseNavigationDrawer()

  const activate = (entry: MenuLink) => {
    closeDrawer()
    if (onSection) return onSection(entry)
    if (entry.onRun) return entry.onRun()
    if (entry.to) return navigate(entry.to)
    if (entry.sectionId) return scrollToSection(entry.sectionId)
  }
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(entry => {
        if (entry.kind === 'section') {
          if (entry.entries.length === 0) return null
          return (
            <div key={entry.id} className="mt-1 flex flex-col gap-0.5 first:mt-0">
              <div className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {entry.label}
              </div>
              <MenuList entries={entry.entries} activeId={activeId} onSection={onSection} />
            </div>
          )
        }
        if (entry.kind === 'wql') return null // unresolved specs never reach the renderer
        return (
          <MenuRow
            key={entry.id}
            entry={entry}
            active={activeId != null && entry.sectionId === activeId}
            onActivate={activate}
          />
        )
      })}
    </div>
  )
}
