/**
 * menuModel — the shell-menu content contract (general layout).
 *
 * Every navigational menu zone in the app shell — the context sidebar (zone 2),
 * the secondary nav rail (zone 4), and their collapsed forms (⋯ overflow, phone
 * drawer) — renders the same shape: a {@link MenuSpec}. Entries are either
 * static links/sections or WQL-driven sections whose children resolve at
 * runtime through `searchEntries` (find/rows queries over content + telemetry).
 *
 * Keeping one model is what makes the zones swappable: the same spec renders
 * in the rail on desktop and inside the ⋯ menu on tablet/phone.
 */

import type { ComponentType } from 'react'
import type { Entry } from '../lib/entryMapper'

/** A plain destination: route link, in-page section, or custom action. */
export interface MenuLink {
  kind: 'link'
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  /** Route navigation (react-router `to`). */
  to?: string
  /** In-page scroll anchor (id of the section element). */
  sectionId?: string
  /** Custom action (e.g. start a workout block); wins over to/sectionId. */
  onRun?: () => void
  /** Icon for the run affordance rendered at the row's right edge. */
  runIcon?: 'play' | 'stop' | 'link' | 'edit'
  /** Muted mono prefix (e.g. '08:30' timestamps). */
  timestamp?: string
  /** Trivial count/marker badge. */
  badge?: string
  /** Secondary styling (time/log rows on note pages). */
  muted?: boolean
}

/** A labelled group of entries — renders its label as an uppercase section head. */
export interface MenuSection {
  kind: 'section'
  id: string
  label: string
  entries: MenuEntry[]
}

/**
 * A WQL-driven section: `query` resolves via `searchEntries` (find/rows WQL)
 * and each resulting {@link Entry} maps to a link. Resolution is graceful —
 * a parse error or empty store yields a section with no children (hidden).
 */
export interface MenuWql {
  kind: 'wql'
  id: string
  label: string
  query: string
  limit?: number
  /** Entry → route href (e.g. journal date deep-link). */
  toEntry?: (entry: Entry) => string
  /** Entry → row label (default: entry.title). */
  labelFromEntry?: (entry: Entry) => string
  /** Optional entry filter (e.g. drop undated rows). */
  filterEntry?: (entry: Entry) => boolean
}

export type MenuEntry = MenuLink | MenuSection | MenuWql

/** Top-level menu content for a shell zone. */
export type MenuSpec = MenuEntry[]

/** Adapt the page-index L3 items (NavContext) into standard menu links. */
export function l3ToMenuEntries(items: NavItemL3[]): MenuLink[] {
  return items.map(item => {
    const action = item.action
    const run = item.secondaryAction?.action
    // No `muted` here: a run affordance is not a reason to dim a row — the
    // TOC must render one uniform inactive style so the active highlight is
    // unambiguous. `muted` stays reserved for timestamp/mono rows (journal).
    const base: MenuLink = {
      kind: 'link',
      id: item.id,
      label: item.label,
    }
    if (run && run.type === 'call') {
      base.onRun = run.handler
      base.runIcon = item.secondaryRunIcon ?? 'play'
    }
    if (action.type === 'route') return { ...base, to: action.to }
    if (action.type === 'scroll') return { ...base, sectionId: action.sectionId }
    if (action.type === 'call') return { ...base, onRun: action.handler }
    return base
  })
}
