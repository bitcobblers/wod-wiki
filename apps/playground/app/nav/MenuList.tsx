/**
 * MenuList — the standardized renderer for shell-menu content.
 *
 * Every menu zone (L2 sidebar panels, L3 connections & outline rail, route-
 * declared menus) renders through this component so navigation looks the same
 * everywhere. WQL entries resolve asynchronously via `searchEntries`; a query
 * that fails or returns nothing simply renders no children.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryState } from 'nuqs'
import { ListFilter } from 'lucide-react'
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
    void Promise.all(current.map(e => (e.kind === 'wql' ? resolveWql(e) : Promise.resolve(e)))).then(
      settled => {
        if (!cancelled) setResolved(settled)
      },
    )
    return () => {
      cancelled = true
    }
  }, [signature])

  if (!spec || !spec.some(e => e.kind === 'wql')) {
    return spec ?? []
  }

  return resolved
}

/** Read the URL-synced / context-tracked active in-page section id. */
export function useActiveSectionId(): string {
  const [hParam] = useQueryState('h', { shallow: true })
  const [sParam] = useQueryState('s', { shallow: true })
  const { navState } = useNav()
  const l3Active = (navState as { activeL3Id?: string | null }).activeL3Id ?? ''
  return hParam || sParam || l3Active || ''
}

// ── Rendering ────────────────────────────────────────────────────────────────

function MenuRow({
  entry,
  active,
  onActivate,
  onRunAction,
  onFilter,
}: {
  entry: MenuLink
  active: boolean
  onActivate: (entry: MenuLink) => void
  onRunAction: (entry: MenuLink) => void
  onFilter: (to: string) => void
}) {
  const run = entry.onRun
  const filterTo = entry.filterTo
  const filterAria = entry.filterLabel ?? `Filter notes by ${entry.label}`
  const runTitle =
    entry.runIcon === 'link'
      ? 'View workout'
      : entry.runIcon === 'stop'
        ? 'Stop workout'
        : entry.runIcon === 'edit'
          ? 'Edit note'
          : 'Start workout'

  const primaryButton = (
    <button
      type="button"
      onClick={() => onActivate(entry)}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 max-lg:min-h-11 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        !run && !filterTo && 'w-full',
        entry.muted ? 'text-xs' : 'text-[13px]',
        active
          ? 'bg-primary/10 font-semibold text-primary'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {entry.icon && <entry.icon aria-hidden="true" className="size-4 shrink-0" />}
      {entry.timestamp && (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {entry.timestamp}
        </span>
      )}
      <span className="min-w-0 flex-1 line-clamp-2 break-words" title={entry.label}>{entry.label}</span>
      {entry.badge && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          {entry.badge}
        </span>
      )}
    </button>
  )

  if (!run && !filterTo) {
    return primaryButton
  }

  return (
    <div className="group flex w-full items-center gap-0.5">
      {primaryButton}
      {filterTo && (
        <button
          type="button"
          aria-label={filterAria}
          title={filterAria}
          data-testid={`menu-filter-${entry.id}`}
          onClick={() => onFilter(filterTo)}
          className="flex size-7 max-lg:min-h-11 max-lg:min-w-11 shrink-0 items-center justify-center rounded-md text-foreground/75 transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <ListFilter aria-hidden="true" className="size-3.5" />
        </button>
      )}
      {run && (
        <button
          type="button"
          aria-label={runTitle}
          title={runTitle}
          onClick={() => onRunAction(entry)}
          className="flex size-7 max-lg:min-h-11 max-lg:min-w-11 shrink-0 items-center justify-center rounded text-primary opacity-70 lg:opacity-0 transition-all group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          {entry.runIcon === 'link' ? (
            <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />
          ) : entry.runIcon === 'stop' ? (
            <StopIcon aria-hidden="true" className="size-3.5" />
          ) : entry.runIcon === 'edit' ? (
            <PencilSquareIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <PlayIcon aria-hidden="true" className="size-3.5" />
          )}
        </button>
      )}
    </div>
  )
}

export function MenuList({
  entries,
  activeId,
  onSection,
  onSelect,
}: {
  entries: MenuEntry[]
  activeId?: string
  /** Override for section clicks (defaults to shell scroll + navigate). */
  onSection?: (entry: MenuLink) => void
  /** Optional fallback click handler (e.g. entity peek) invoked when `entry.onSelect` is absent. */
  onSelect?: (entry: MenuLink) => void
}) {
  const navigate = useNavigate()
  const { scrollToSection } = useNav()
  const closeDrawer = useCloseNavigationDrawer()

  const activate = (entry: MenuLink) => {
    closeDrawer()
    if (onSection) return onSection(entry)
    if (entry.onSelect) return entry.onSelect()
    if (onSelect) return onSelect(entry)
    if (entry.onRun) return entry.onRun()
    if (entry.to) return navigate(entry.to)
    if (entry.sectionId) return scrollToSection(entry.sectionId)
  }

  const runAction = (entry: MenuLink) => {
    closeDrawer()
    entry.onRun?.()
  }

  const activateFilter = (to: string) => {
    closeDrawer()
    void navigate(to)
  }

  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(entry => {
        if (entry.kind === 'section') {
          if (entry.entries.length === 0) return null
          return (
            <div key={entry.id} className="mt-1 flex flex-col gap-0.5 first:mt-0">
              <div className="px-2 pb-1 pt-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {entry.label}
              </div>
              <MenuList
                entries={entry.entries}
                activeId={activeId}
                onSection={onSection}
                onSelect={onSelect}
              />
            </div>
          )
        }
        if (entry.kind === 'wql') return null // unresolved specs never reach the renderer
        if (entry.kind === 'widget') {
          return (
            <div key={entry.id} className="px-1 py-1">
              {entry.render()}
            </div>
          )
        }
        return (
          <MenuRow
            key={entry.id}
            entry={entry}
            active={activeId != null && entry.sectionId === activeId}
            onActivate={activate}
            onRunAction={runAction}
            onFilter={activateFilter}
          />
        )
      })}
    </div>
  )
}
