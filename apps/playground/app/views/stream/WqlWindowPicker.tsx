import React, { useMemo, useState } from 'react'
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { parseQuery, serialize, type AnyParsedQuery } from '@bitcobblers/wod-wiki-wql'
import { formatDateKey } from '../../services/dateUtils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/atoms/primitives/dropdown-menu'
import { cn } from '@/lib/utils'

export interface WqlWindowPickerProps {
  query: string
  onQueryChange: (wql: string) => void
  highlightDates?: Set<string>
  className?: string
}

const PRESETS = [
  { label: 'Past 1 week', value: 'last 1w' },
  { label: 'Past 2 weeks', value: 'last 2w' },
  { label: 'Past 4 weeks', value: 'last 4w' },
  { label: 'Past 8 weeks', value: 'last 8w' },
  { label: 'Past 12 weeks', value: 'last 12w' },
  { label: 'Past 1 year', value: 'last 52w' },
  { label: 'All time', value: 'all' },
]

const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1
}

function setQueryWindow(query: string, windowClause: string | null): string {
  const parsed = parseQuery(query)
  if (parsed.error) return query

  if (!windowClause || windowClause === 'all') {
    return serialize({ ...parsed, window: undefined } as AnyParsedQuery)
  }

  const probe = parseQuery(`:note ${windowClause}`)
  if (probe.error || probe.family !== 'find' || !probe.window) return query

  return serialize({ ...parsed, window: probe.window } as AnyParsedQuery)
}

function parseCurrentWindow(query: string) {
  const parsed = parseQuery(query)
  if (parsed.error || parsed.family === 'pipeline') return null
  return 'window' in parsed ? parsed.window ?? null : null
}

export function WqlWindowPicker({ query, onQueryChange, highlightDates = new Set(), className }: WqlWindowPickerProps) {
  const currentWindow = useMemo(() => parseCurrentWindow(query), [query])
  const [rangeStart, setRangeStart] = useState<string | null>(null)
  const [viewDate, setViewDate] = useState(() => new Date())

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const currentLabel = useMemo(() => {
    if (!currentWindow) return 'All time'
    if (currentWindow.kind === 'relative') return `last ${currentWindow.size}${currentWindow.unit}`
    if (currentWindow.kind === 'param') return `last $${currentWindow.param}${currentWindow.unit ? ` ${currentWindow.unit}` : ''}`
    return currentWindow.end ? `from ${currentWindow.start} to ${currentWindow.end}` : `from ${currentWindow.start}`
  }, [currentWindow])

  const effectiveRange = useMemo(() => {
    if (!currentWindow || currentWindow.kind === 'param') return null
    if (currentWindow.kind === 'range') {
      return { start: currentWindow.start, end: currentWindow.end ?? currentWindow.start }
    }
    const end = new Date()
    const start = new Date()
    if (currentWindow.unit === 'd') {
      start.setDate(end.getDate() - currentWindow.size)
    } else {
      start.setDate(end.getDate() - currentWindow.size * 7)
    }
    return { start: formatDateKey(start), end: formatDateKey(end) }
  }, [currentWindow])

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month)
    const days: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(d)
    return days
  }, [year, month])

  const handleDateClick = (dateKey: string) => {
    if (!rangeStart) {
      setRangeStart(dateKey)
      const nextQuery = setQueryWindow(query, `from ${dateKey} to ${dateKey}`)
      onQueryChange(nextQuery)
    } else {
      const [start, end] = rangeStart <= dateKey ? [rangeStart, dateKey] : [dateKey, rangeStart]
      setRangeStart(null)
      const nextQuery = setQueryWindow(query, `from ${start} to ${end}`)
      onQueryChange(nextQuery)
    }
  }

  const prevMonth = (e: React.MouseEvent) => {
    e.stopPropagation()
    setViewDate(new Date(year, month - 1, 1))
  }

  const nextMonth = (e: React.MouseEvent) => {
    e.stopPropagation()
    setViewDate(new Date(year, month + 1, 1))
  }

  const monthLabel = viewDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  const todayKey = formatDateKey(new Date())

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="wql-window-picker-trigger"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Calendar className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="font-mono text-xs">{currentLabel}</span>
            <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-3">
          {/* Preset options */}
          <div className="mb-3 flex flex-wrap gap-1 border-b border-border/60 pb-2">
            {PRESETS.map(preset => {
              const isSelected = preset.value === 'all'
                ? !currentWindow
                : currentWindow?.kind === 'relative' && `last ${currentWindow.size}${currentWindow.unit}` === preset.value
              return (
                <button
                  key={preset.value}
                  type="button"
                  data-testid={`wql-window-preset-${preset.value}`}
                  onClick={() => {
                    setRangeStart(null)
                    onQueryChange(setQueryWindow(query, preset.value))
                  }}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          {/* Month Header */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={prevMonth}
              data-testid="wql-calendar-prev-month"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-xs font-semibold text-foreground">{monthLabel}</span>
            <button
              type="button"
              onClick={nextMonth}
              data-testid="wql-calendar-next-month"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Day Names */}
          <div className="mb-1 grid grid-cols-7 gap-1">
            {DAY_NAMES.map(name => (
              <div key={name} className="text-center text-[10px] font-medium text-muted-foreground">
                {name}
              </div>
            ))}
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-7 gap-1" data-testid="wql-calendar-grid">
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="size-8" />
              }
              const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const inRange = effectiveRange && dateKey >= effectiveRange.start && dateKey <= effectiveRange.end
              const isStart = (effectiveRange && dateKey === effectiveRange.start) || rangeStart === dateKey
              const isEnd = effectiveRange && dateKey === effectiveRange.end
              const isToday = dateKey === todayKey
              const hasHighlight = highlightDates.has(dateKey)

              return (
                <button
                  key={dateKey}
                  type="button"
                  data-testid={`wql-calendar-day-${dateKey}`}
                  onClick={() => handleDateClick(dateKey)}
                  className={cn(
                    'relative flex size-8 items-center justify-center rounded-md text-xs transition-colors',
                    isStart || isEnd
                      ? 'bg-primary font-bold text-primary-foreground'
                      : inRange
                        ? 'bg-primary/15 font-semibold text-primary'
                        : isToday
                          ? 'border border-primary font-semibold text-primary'
                          : 'text-foreground hover:bg-muted',
                  )}
                >
                  <span>{day}</span>
                  {hasHighlight && !isStart && !isEnd && (
                    <span className="absolute bottom-0.5 size-1 rounded-full bg-primary" />
                  )}
                </button>
              )
            })}
          </div>

          {rangeStart && (
            <div className="mt-2 text-center text-[10px] text-muted-foreground">
              Select second date to complete range (starting from {rangeStart})
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {currentWindow && (
        <button
          type="button"
          data-testid="wql-window-picker-clear"
          onClick={() => {
            setRangeStart(null)
            onQueryChange(setQueryWindow(query, null))
          }}
          title="Clear time window"
          aria-label="Clear time window"
          className="ml-1 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
