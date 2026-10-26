/**
 * PropertyTable — tabular projection component adapted to field projections (Ticket 002).
 *
 * Dynamically adapts column headers and row cells to the active entity level
 * and visible fields. Supports interactive row navigation and custom row click handlers.
 */
import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { Entry } from '../../lib/entryMapper'
import { entryOpenHref, entryNotebookHref } from '../../lib/entryActions'
import { effortPath } from '../../lib/routes'
import {
  type EntityLevel,
  type FieldDefinition,
  getEntityLevel,
  getFieldsForLevel,
  getDefaultVisibleFieldIds,
} from '../../lib/fieldProjection'

export interface PropertyTableProps {
  entries: readonly Entry[]
  level?: EntityLevel
  visibleFieldIds?: readonly string[]
  onRowClick?: (entry: Entry) => void
  emptyMessage?: string
  className?: string
  /** Viewport `top` for the sticky column-header row — the page sticky
   *  boundary's live bottom (useStickyBoundaryOffset). Omitted → the
   *  header scrolls with the table. */
  stickyHeaderTop?: number
}

export function PropertyTable({
  entries,
  level,
  visibleFieldIds,
  onRowClick,
  emptyMessage = 'No entries to display',
  className = '',
  stickyHeaderTop,
}: PropertyTableProps) {
  const navigate = useNavigate()

  // Determine effective level
  const effectiveLevel: EntityLevel = useMemo(() => {
    if (level) return level
    if (entries.length > 0) return getEntityLevel(entries[0])
    return 'note'
  }, [level, entries])

  // Get all field definitions for this level
  const allFields = useMemo(() => getFieldsForLevel(effectiveLevel), [effectiveLevel])

  // Filter to active visible fields
  const activeFields: readonly FieldDefinition[] = useMemo(() => {
    const visibleSet = new Set(visibleFieldIds ?? getDefaultVisibleFieldIds(effectiveLevel))
    return allFields.filter(f => visibleSet.has(f.id))
  }, [allFields, visibleFieldIds, effectiveLevel])

  const handleRowClick = (entry: Entry) => {
    if (onRowClick) {
      onRowClick(entry)
    } else {
      navigate(entryOpenHref(entry))
    }
  }
  const [sortFieldId, setSortFieldId] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleHeaderClick = (fieldId: string) => {
    if (sortFieldId === fieldId) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortFieldId(fieldId)
      setSortDir('asc')
    }
  }

  const sortedEntries = useMemo(() => {
    if (!sortFieldId) return entries
    const field = allFields.find(f => f.id === sortFieldId)
    if (!field) return entries

    return [...entries].sort((a, b) => {
      const valA = field.getValue(a)
      const valB = field.getValue(b)

      if (valA == null && valB == null) return 0
      if (valA == null) return sortDir === 'asc' ? 1 : -1
      if (valB == null) return sortDir === 'asc' ? -1 : 1

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortDir === 'asc' ? valA - valB : valB - valA
      }

      if (Array.isArray(valA) && Array.isArray(valB)) {
        const strA = valA.join(', ')
        const strB = valB.join(', ')
        return sortDir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA)
      }

      const strA = String(valA)
      const strB = String(valB)
      return sortDir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA)
    })
  }, [entries, sortFieldId, sortDir, allFields])


  if (entries.length === 0) {
    return (
      <div
        className={`w-full py-16 text-center text-sm text-muted-foreground ${className}`}
        data-testid="property-table-empty"
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div
      className={`w-full border-y border-border bg-card/50 ${stickyHeaderTop !== undefined ? 'overflow-x-clip' : 'overflow-x-auto'} ${className}`}
      data-testid="property-table"
    >
      <table className="w-full text-left border-collapse text-xs">
        <thead
          className={stickyHeaderTop !== undefined ? 'sticky z-10' : undefined}
          style={stickyHeaderTop !== undefined ? { top: `${stickyHeaderTop}px` } : undefined}
        >
          <tr className="border-b border-border">
            {activeFields.map(field => {
              const alignClass =
                field.align === 'right'
                  ? 'text-right'
                  : field.align === 'center'
                    ? 'text-center'
                    : 'text-left'
              return (
                <th
                  key={field.id}
                  scope="col"
                  onClick={() => handleHeaderClick(field.id)}
                  className={`px-4 py-3 font-semibold uppercase tracking-wider text-[11px] text-muted-foreground whitespace-nowrap border-b border-border cursor-pointer select-none hover:text-foreground transition-colors group/th ${stickyHeaderTop !== undefined ? 'bg-muted/95 backdrop-blur-sm' : 'bg-muted/30'} ${alignClass}`}
                  data-testid={`property-table-header-${field.id}`}
                >
                  <div className={`inline-flex items-center gap-1.5 ${alignClass === 'text-right' ? 'justify-end' : alignClass === 'text-center' ? 'justify-center' : 'justify-start'}`}>
                    <span>{field.label}</span>
                    {sortFieldId === field.id ? (
                      <span className="text-primary font-bold text-xs" aria-label={sortDir === 'asc' ? 'sorted ascending' : 'sorted descending'}>
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    ) : (
                      <span className="opacity-0 group-hover/th:opacity-40 text-muted-foreground text-[10px]" aria-hidden="true">
                        ↕
                      </span>
                    )}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {sortedEntries.map(entry => {
            const notebookHref = entryNotebookHref(entry)
            const openHref = entryOpenHref(entry)
            return (
            <tr
              key={entry.id}
              role="button"
              tabIndex={0}
              onClick={() => handleRowClick(entry)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleRowClick(entry)
                }
              }}
              className="hover:bg-muted/40 transition-colors cursor-pointer group"
              data-testid={`property-table-row-${entry.id}`}
            >
              {activeFields.map(field => {
                const val = field.getValue(entry)
                const formatted = field.formatValue(val, entry)
                const alignClass =
                  field.align === 'right'
                    ? 'text-right tabular-nums'
                    : field.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                return (
                  <td
                    key={field.id}
                    className={`px-4 py-3 whitespace-nowrap text-foreground/90 ${alignClass}`}
                    data-testid={`property-table-cell-${field.id}`}
                  >
                    {field.id === 'pacingTier' && entry.execution?.effortSlug ? (
                      <Link
                        to={effortPath(entry.execution.effortSlug)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                        data-testid="property-table-effort-link"
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors"
                        title={`View movement history for ${entry.detail ?? entry.execution.effortSlug}`}
                      >
                        {formatted}
                      </Link>
                    ) : field.id === 'title' || field.id === 'label' ? (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                          {formatted}
                        </span>
                        {notebookHref && (
                          <div className="flex items-center gap-1.5 ml-auto" onClick={e => e.stopPropagation()}>
                            <Link
                              to={openHref}
                              data-testid="property-table-details-link"
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted border border-border transition-colors"
                              title="View catalog details"
                            >
                              Details
                            </Link>
                            <Link
                              to={notebookHref}
                              data-testid="property-table-feed-link"
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors"
                              title="View feed"
                            >
                              Feed
                            </Link>
                          </div>
                        )}
                      </div>
                    ) : (
                      formatted
                    )}
                  </td>
                )
              })}
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
