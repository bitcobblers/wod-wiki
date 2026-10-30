/**
 * Shared utilities for playground page components.
 *
 * Extracted from App.tsx so individual page components can be imported in
 * isolation (e.g. from Storybook stories) without pulling in the entire app.
 */

import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { NavItemL3 } from '../../nav/navTypes'
import { ArrowTopRightOnSquareIcon, PlayIcon, PencilSquareIcon } from '@heroicons/react/20/solid'

// ── Runtime-category constants ───────────────────────────────────────────────

/** Categories where workouts run in an inline popup overlay instead of navigating to a tracker page. */
export const INLINE_RUNTIME_CATEGORIES = new Set(['syntax'])

/** Categories that are not notebook workout items — these are user-generated or documentation pages. */
export const NOTEBOOK_EXCLUDED_CATEGORIES: Record<string, true> = {
  journal: true,
  playground: true,
  canvas: true,
  syntax: true,
}

// ── Playground template helpers ──────────────────────────────────────────────

const CURSOR_TOKEN = '$CURSOR'

/** Strip the $CURSOR token and return { content, cursorOffset }. */
export function applyTemplate(raw: string): { content: string; cursorOffset: number } {
  const idx = raw.indexOf(CURSOR_TOKEN)
  if (idx === -1) return { content: raw, cursorOffset: raw.length }
  return {
    content: raw.slice(0, idx) + raw.slice(idx + CURSOR_TOKEN.length),
    cursorOffset: idx,
  }
}

/** Append a runnable timer through the page's normal editor change path. */
export function appendTimerBlock(content: string): string {
  return `${content.trimEnd()}\n\n\`\`\`time\n10:00\n\`\`\`\n`
}

// ── Page index helpers ───────────────────────────────────────────────────────

/**
 * True when the browser history has an in-app entry behind the current one
 * (React Router v6 stores the history index in `history.state.idx`). Used by
 * detail pages so "back" returns to the listing state that launched them —
 * query/scroll included — falling back to a canonical list link when the page
 * was deep-loaded.
 */
export function canGoBack(): boolean {
  const idx = (typeof window !== 'undefined'
    ? (window.history.state as { idx?: number } | null)?.idx
    : undefined)
  return typeof idx === 'number' && idx > 0
}

/** Extract headings and workout/query/widget-fence positions from markdown content. */
export function extractPageIndex(content: string): PageNavLink[] {
  const lines = content.split('\n')
  const links: PageNavLink[] = []
  let workoutCount = 0
  let queryCount = 0
  const seenIds = new Map<string, number>()

  const uniqueId = (base: string): string => {
    const count = (seenIds.get(base) ?? 0) + 1
    seenIds.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  }

  // Label for a query fence: the block's `title:` line when present (dashboard
  // widgets carry one), else the ordinal.
  const queryTitle = (from: number): string | undefined => {
    for (let j = from + 1; j < lines.length; j++) {
      const body = lines[j]
      if (body.trim() === '```') break
      const m = body.match(/^title:\s*(.+)$/)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
    return undefined
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^(#{1,6})\s+(.*)$/)
    if (match) {
      let label = match[2].trim()
      let timestamp: string | undefined

      const timeMatch = label.match(/(\d{1,2}:\d{2})/)
      if (timeMatch) {
        timestamp = timeMatch[1]
        label = label.replace(timestamp, '').replace(/\s+/g, ' ').trim()
        if (!label) label = timestamp
      }

      const base = label.toLowerCase().replace(/[^\w]+/g, '-')
      const id = uniqueId(base)
      links.push({ id, label, type: 'heading', timestamp })
      continue
    }
    const fenceMatch = line.trim().match(/^```(time|log|query|widget)(:[-\w]+)?\s*$/)
    if (fenceMatch) {
      const tag = fenceMatch[1] as 'time' | 'log' | 'query' | 'widget'
      if (tag === 'query') {
        queryCount++
        links.push({ id: `query-line-${i + 1}`, label: queryTitle(i) ?? `Query ${queryCount}`, type: 'query' })
      } else if (tag === 'widget') {
        links.push({ id: `widget-line-${i + 1}`, label: (fenceMatch[2] ?? '').slice(1) || 'Widget', type: 'widget' })
      } else {
        workoutCount++
        links.push({ id: `${tag}-line-${i + 1}`, label: `Workout ${workoutCount}`, type: tag })
      }
    }
  }
  return links
}

/** Map PageNavLink[] to NavItemL3[] for use with NavContext / sidebar. */
export function mapIndexToL3(index: PageNavLink[]): NavItemL3[] {
  return index.map(link => ({
    id: link.id,
    label: link.label,
    level: 3 as const,
    action:
      link.onRun && link.runIcon === 'link'
        ? { type: 'call' as const, handler: link.onRun }
        : { type: 'scroll' as const, sectionId: link.id },
    secondaryAction: link.onRun
      ? {
          id: link.id + (link.runIcon === 'edit' ? '-edit' : '-run'),
          label: link.runIcon === 'edit' ? 'Edit' : 'Run',
          icon: link.runIcon === 'edit' ? PencilSquareIcon : link.runIcon === 'link' ? ArrowTopRightOnSquareIcon : PlayIcon,
          action: { type: 'call' as const, handler: link.onRun },
        }
      : undefined,
    secondaryRunIcon: link.runIcon,
  }))
}
