/**
 * queryConfigEditors — the editable pieces of a surface's query
 * configuration, extracted from the retired Settings ▸ Pages section so the
 * per-page dialog and any other host share one implementation.
 *
 * Each editor is a controlled component: it renders the draft, reports
 * changes through `onChange`, and never touches storage itself. The dialog
 * owns the draft, the save/reset actions and the storage calls.
 */
import { ArrowDown, ArrowUp, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { Switch } from '@/components/atoms/primitives/switch'
import { SOURCE_OPTIONS, TARGET_OPTIONS } from '@bitcobblers/wod-wiki-ui'
import { GROUP_BY_DIMENSIONS } from '../../../lib/groupByOptions'

/** Labels for the Where-stored scope vocabulary, plus the legacy target ids. */
const LABEL_BY_TYPE_OPTION: Record<string, string> = Object.fromEntries(
  [...SOURCE_OPTIONS, ...TARGET_OPTIONS].map(o => [o.value, o.label]),
)

/**
 * Supported-value favorites editor: selected values render as removable chips
 * (order = priority), remaining supported choices render as add buttons.
 * Values outside `choices` (e.g. a migrated canonical target) still render as
 * chips so nothing silently disappears.
 */
export function FavoriteOptionsEditor({
  values,
  choices,
  labels,
  onChange,
  testPrefix,
  reorderable = false,
}: {
  values: string[]
  choices: readonly { value: string; label: string }[]
  labels: Record<string, string>
  onChange: (next: string[]) => void
  testPrefix: string
  /** Show move up/down controls — for lists whose order is meaningful. */
  reorderable?: boolean
}) {
  const move = (index: number, delta: number) => {
    const next = [...values]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const swapped = next[index]!
    next[index] = next[target]!
    next[target] = swapped
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value, index) => (
            <span
              key={value}
              data-testid={`${testPrefix}-chip-${value}`}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium"
            >
              {labels[value] ?? value}
              {reorderable && (
                <>
                  <button
                    type="button"
                    aria-label={`Move ${value} up`}
                    data-testid={`${testPrefix}-up-${value}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${value} down`}
                    data-testid={`${testPrefix}-down-${value}`}
                    disabled={index === values.length - 1}
                    onClick={() => move(index, 1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="size-3" />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                data-testid={`${testPrefix}-remove-${value}`}
                onClick={() => onChange(values.filter(v => v !== value))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {choices
          .filter(c => !values.includes(c.value))
          .map(c => (
            <button
              key={c.value}
              type="button"
              aria-label={`Add ${c.value}`}
              data-testid={`${testPrefix}-add-${c.value}`}
              onClick={() => onChange([...values, c.value])}
              className="rounded-full border border-dashed border-border/70 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40"
            >
              + {c.label}
            </button>
          ))}
      </div>
    </div>
  )
}

/**
 * Where-stored scope favorites editor — the storage scopes the surface's
 * composer offers. The favorites are a PRIORITY list: they reorder the
 * picker's choices, they never remove a canonical scope.
 */
export function ScopeFavoritesEditor({
  values,
  choices,
  onChange,
  testPrefix,
}: {
  values: string[]
  choices: readonly { value: string; label: string }[]
  onChange: (next: string[]) => void
  testPrefix: string
}) {
  return (
    <FavoriteOptionsEditor
      values={values}
      choices={choices}
      labels={LABEL_BY_TYPE_OPTION}
      onChange={onChange}
      testPrefix={testPrefix}
      reorderable
    />
  )
}

/**
 * Group-By favorites editor — the dimensions the page offers first and the
 * one a bare landing falls back to. Order is the priority, so the chips are
 * reorderable; the list never filters (a dimension the target cannot group
 * by stays stored but is not offered).
 */
export function GroupByFavoritesEditor({
  values,
  onChange,
  testPrefix,
}: {
  values: string[]
  onChange: (next: string[]) => void
  testPrefix: string
}) {
  return (
    <FavoriteOptionsEditor
      values={values}
      choices={GROUP_BY_DIMENSIONS.map(d => ({ value: d.id, label: d.label }))}
      labels={Object.fromEntries(GROUP_BY_DIMENSIONS.map(d => [d.id, d.label]))}
      onChange={onChange}
      testPrefix={testPrefix}
      reorderable
    />
  )
}

/**
 * A labelled editor section with an on/off switch. Off = the surface's own
 * system default; on = the user's list replaces it. The children always
 * render — the switch gates the EDITOR, not the explanation of it.
 */
export function ConfigSection({
  label,
  enabled,
  onEnabledChange,
  testId,
  children,
}: {
  label: string
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  testId: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-muted-foreground">{label}</label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Custom
          <Switch
            checked={enabled}
            onChange={onEnabledChange}
            data-testid={testId}
          />
        </label>
      </div>
      {children}
    </div>
  )
}

/** The shortcut shape the editor needs — a subset of `WqlShortcut`. */
export interface ShortcutRow {
  id: string
  label: string
  icon: string
  wql: string
  to?: string
}

/**
 * The saved-shortcuts list editor — the navigation links a library group
 * shows, with the create/edit/delete affordances the retired settings
 * section carried.
 */
export function ShortcutsEditor({
  shortcuts,
  icons,
  landingId,
  onEdit,
  onDelete,
  onCreate,
  error,
  testPrefix,
}: {
  shortcuts: readonly ShortcutRow[]
  icons: Record<string, React.ComponentType<{ className?: string }>>
  landingId: string
  onEdit: (shortcut: ShortcutRow) => void
  onDelete: (id: string) => void
  onCreate: () => void
  error: string | null
  testPrefix: string
}) {
  return (
    <div className="space-y-2" data-testid={`${testPrefix}-shortcuts`}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-muted-foreground">Saved shortcuts</label>
        <Button variant="ghost" size="sm" onClick={onCreate} data-testid={`${testPrefix}-shortcut-new`}>
          New shortcut
        </Button>
      </div>
      {shortcuts.map(s => {
        // A stored icon outside the vocabulary renders as the generic
        // bookmark — an unknown icon must never blank the page.
        const Icon = icons[s.icon] ?? icons.bookmark
        const description = s.to ? `Opens ${s.to}` : s.wql || 'Landing (no query)'
        return (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5"
            data-testid={`${testPrefix}-shortcut-${s.id}`}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 max-w-40 truncate text-xs font-medium">{s.label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{description}</span>
            <button
              type="button"
              aria-label={`Edit ${s.label}`}
              data-testid={`${testPrefix}-shortcut-edit-${s.id}`}
              onClick={() => onEdit(s)}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-3" />
            </button>
            {!s.to && s.id !== landingId && (
              <button
                type="button"
                aria-label={`Delete ${s.label}`}
                data-testid={`${testPrefix}-shortcut-delete-${s.id}`}
                onClick={() => onDelete(s.id)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        )
      })}
      {error && (
        <p role="alert" className="text-xs text-destructive" data-testid={`${testPrefix}-shortcut-error`}>
          {error}
        </p>
      )}
    </div>
  )
}
