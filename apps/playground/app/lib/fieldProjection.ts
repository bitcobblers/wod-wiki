/**
 * fieldProjection — level-configurable FieldProjection seam (Ticket 002).
 *
 * Defines the available and default visible fields for each entity level:
 * - Note level: title, tags, text excerpt, catalog source, date.
 * - Session level: title, protocol, movements, target duration, session load.
 * - Result level: title, elapsed time, total tonnage, TIS score, PR badges.
 * - Segment level: split duration, round/lap index, reps, load, pacing/heart rate tier.
 * - Effort level: label, canonical slug, discipline, MET score, intensity tier, aliases.
 *
 * Provides pure accessors and projection mapping used by PropertyTable and
 * adaptive Card Stream views.
 */
import type { Entry } from './entryMapper'
import { formatDuration } from './entryMapper'

export type EntityLevel = 'note' | 'session' | 'result' | 'segment' | 'effort'

export interface FieldDefinition {
  id: string
  label: string
  level: EntityLevel
  defaultVisible: boolean
  align?: 'left' | 'right' | 'center'
  getValue: (entry: Entry) => unknown
  formatValue: (value: unknown, entry: Entry) => string
}

export function getEntityLevel(entry: Entry): EntityLevel {
  switch (entry.kind) {
    case 'note':
      return 'note'
    case 'result':
      return 'result'
    case 'segment':
    case 'event':
      return 'segment'
    case 'effort':
      return 'effort'
    default:
      return 'note'
  }
}

export const NOTE_FIELDS: readonly FieldDefinition[] = [
  {
    id: 'title',
    label: 'Title',
    level: 'note',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.title,
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'tags',
    label: 'Tags',
    level: 'note',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.tags ?? [],
    formatValue: v => (Array.isArray(v) ? v.join(', ') : String(v ?? '')),
  },
  {
    id: 'excerpt',
    label: 'Text Excerpt',
    level: 'note',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.block?.preview?.join(' ') || e.detail || '',
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'catalog',
    label: 'Catalog Source',
    level: 'note',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.sourceCatalog,
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'date',
    label: 'Date',
    level: 'note',
    defaultVisible: true,
    align: 'right',
    getValue: e => e.date,
    formatValue: v => String(v ?? ''),
  },
]

export const SESSION_FIELDS: readonly FieldDefinition[] = [
  {
    id: 'title',
    label: 'Title',
    level: 'session',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.title,
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'protocol',
    label: 'Protocol',
    level: 'session',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.block?.dataType || e.subtitle || '',
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'movements',
    label: 'Movements',
    level: 'session',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.detail || '',
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'targetDuration',
    label: 'Target Duration',
    level: 'session',
    defaultVisible: true,
    align: 'right',
    getValue: e => (e.execution?.elapsedMs != null ? formatDuration(e.execution.elapsedMs) : ''),
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'sessionLoad',
    label: 'Session Load',
    level: 'session',
    defaultVisible: true,
    align: 'right',
    getValue: e => e.execution?.loadLbs,
    formatValue: v => (typeof v === 'number' ? `${v.toLocaleString()} lbs` : ''),
  },
]

export const RESULT_FIELDS: readonly FieldDefinition[] = [
  {
    id: 'title',
    label: 'Title',
    level: 'result',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.title,
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'elapsedTime',
    label: 'Elapsed Time',
    level: 'result',
    defaultVisible: true,
    align: 'right',
    getValue: e => (e.execution?.elapsedMs != null ? formatDuration(e.execution.elapsedMs) : ''),
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'totalTonnage',
    label: 'Total Tonnage',
    level: 'result',
    defaultVisible: true,
    align: 'right',
    getValue: e => e.execution?.loadLbs,
    formatValue: v => (typeof v === 'number' ? `${v.toLocaleString()} lbs` : ''),
  },
  {
    id: 'tis',
    label: 'TIS Score',
    level: 'result',
    defaultVisible: true,
    align: 'right',
    getValue: e => e.execution?.tis,
    formatValue: v => (typeof v === 'number' ? v.toFixed(1) : ''),
  },
  {
    id: 'prBadges',
    label: 'PR Badges',
    level: 'result',
    defaultVisible: true,
    align: 'center',
    getValue: e => (e.detail && /\bPR\b/.test(e.detail) ? 'PR' : ''),
    formatValue: v => String(v ?? ''),
  },
]

export const SEGMENT_FIELDS: readonly FieldDefinition[] = [
  {
    id: 'splitDuration',
    label: 'Split Duration',
    level: 'segment',
    defaultVisible: true,
    align: 'right',
    getValue: e => (e.execution?.elapsedMs != null ? formatDuration(e.execution.elapsedMs) : ''),
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'roundIndex',
    label: 'Round/Lap Index',
    level: 'segment',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.title,
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'reps',
    label: 'Reps',
    level: 'segment',
    defaultVisible: true,
    align: 'right',
    getValue: e => e.execution?.reps,
    formatValue: v => (v != null ? String(v) : ''),
  },
  {
    id: 'load',
    label: 'Load',
    level: 'segment',
    defaultVisible: true,
    align: 'right',
    getValue: e => e.execution?.loadLbs,
    formatValue: v => (typeof v === 'number' ? `${v.toLocaleString()} lbs` : ''),
  },
  {
    id: 'pacingTier',
    label: 'Pacing / HR Tier',
    level: 'segment',
    defaultVisible: true,
    align: 'center',
    getValue: e => e.effort?.intensityTier || e.execution?.effortSlug || '',
    formatValue: v => String(v ?? ''),
  },
]

export const EFFORT_FIELDS: readonly FieldDefinition[] = [
  {
    id: 'label',
    label: 'Label',
    level: 'effort',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.effort?.label || e.title,
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'canonicalSlug',
    label: 'Canonical Slug',
    level: 'effort',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.effort?.slug || e.id,
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'discipline',
    label: 'Discipline',
    level: 'effort',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.effort?.discipline ?? '',
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'met',
    label: 'MET Score',
    level: 'effort',
    defaultVisible: true,
    align: 'right',
    getValue: e => e.effort?.met,
    formatValue: v => (typeof v === 'number' ? v.toFixed(1) : ''),
  },
  {
    id: 'intensityTier',
    label: 'Intensity Tier',
    level: 'effort',
    defaultVisible: true,
    align: 'center',
    getValue: e => e.effort?.intensityTier ?? '',
    formatValue: v => String(v ?? ''),
  },
  {
    id: 'aliases',
    label: 'Aliases',
    level: 'effort',
    defaultVisible: true,
    align: 'left',
    getValue: e => e.effort?.aliases ?? [],
    formatValue: v => (Array.isArray(v) ? v.join(', ') : String(v ?? '')),
  },
]

const REGISTRY: Record<EntityLevel, readonly FieldDefinition[]> = {
  note: NOTE_FIELDS,
  session: SESSION_FIELDS,
  result: RESULT_FIELDS,
  segment: SEGMENT_FIELDS,
  effort: EFFORT_FIELDS,
}

export function getFieldsForLevel(level: EntityLevel): readonly FieldDefinition[] {
  return REGISTRY[level] ?? NOTE_FIELDS
}

export function getDefaultVisibleFieldIds(level: EntityLevel): string[] {
  return getFieldsForLevel(level)
    .filter(f => f.defaultVisible)
    .map(f => f.id)
}

/**
 * Projects an Entry into a formatted key-value map according to visible fields.
 */
export function projectEntry(
  entry: Entry,
  level?: EntityLevel,
  visibleFieldIds?: readonly string[],
): Record<string, string> {
  const targetLevel = level ?? getEntityLevel(entry)
  const fields = getFieldsForLevel(targetLevel)
  const allowedSet = visibleFieldIds ? new Set(visibleFieldIds) : null

  const out: Record<string, string> = {}
  for (const field of fields) {
    if (allowedSet && !allowedSet.has(field.id)) continue
    const val = field.getValue(entry)
    out[field.id] = field.formatValue(val, entry)
  }
  return out
}
