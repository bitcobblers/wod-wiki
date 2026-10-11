/**
 * QueryDefaultsSection — Settings ▸ Query Defaults (/settings/queries).
 *
 * Per-surface override of the landing default WQL plus the Where-stored scope
 * and fallback arrangement option lists, persisted client-side via
 * routeWqlConfig. Each card shows the in-code system default read-only; an
 * empty query field means "use the system default" and resetting discards the
 * override. The query field is text-first: any WQL is allowed and validated
 * with the shared parser (resolveQueryDraft); invalid exact text is shown and
 * blocks the save. Option lists are supported-value favorites, not freeform
 * text — they reorder/prioritize choices and never define grammar validity.
 * A stored id that is neither canonical nor migratable is reported on the
 * card instead of silently turning into a query clause. An emptied custom
 * option list is the deliberate "no predefined options" state. Stored in
 * this browser locally, on the server in api mode.
 */
import { useMemo, useState } from 'react'
import { resolveQueryDraft, SOURCE_OPTIONS, TARGET_OPTIONS } from '@bitcobblers/wod-wiki-ui'
import { Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import { Switch } from '@/components/atoms/primitives/switch'
import {
  readRouteWqlConfig,
  writeRouteWqlConfig,
  clearRouteWqlConfig,
  GROUP_BY_FAVORITE_OPTIONS,
  PALETTE_ROUTE_ID,
  type RouteWqlConfig,
} from '../lib/routeWqlConfig'
import {
  ALL_SHORTCUT_ID,
  SHORTCUT_ICONS,
  useRouteShortcuts,
  writeRouteShortcuts,
  type WqlShortcut,
} from '../lib/routeWqlShortcuts'
import { remotePrefsMode } from '@/services/storage/metaStore'
import { SaveWqlShortcutDialog } from '../components/organisms/wql/SaveWqlShortcutDialog'
import {
  JOURNAL_STREAM_PROFILE,
  CATALOGS_STREAM_PROFILE,
  FEEDS_STREAM_PROFILE,
  EFFORTS_STREAM_PROFILE,
  SESSIONS_STREAM_PROFILE,
  PLAYGROUNDS_STREAM_PROFILE,
  type StreamProfile,
} from '../views/stream/streamProfile'
import { PALETTE_SEED_QUERY } from '../services/wqlSearchSource'

interface ConfigurableSurface {
  id: string
  label: string
  profile?: StreamProfile
  /** Real library nav group — hosts the saved-shortcuts editor. */
  shortcuts?: boolean
  /** Read-only fallback shown when the surface has no StreamProfile. */
  systemDefaultWql?: string
}

const CONFIGURABLE_SURFACES: ConfigurableSurface[] = [
  { id: JOURNAL_STREAM_PROFILE.route, label: 'Journal', profile: JOURNAL_STREAM_PROFILE, shortcuts: true },
  { id: FEEDS_STREAM_PROFILE.route, label: 'Feeds', profile: FEEDS_STREAM_PROFILE, shortcuts: true },
  { id: CATALOGS_STREAM_PROFILE.route, label: 'Catalogs', profile: CATALOGS_STREAM_PROFILE },
  { id: EFFORTS_STREAM_PROFILE.route, label: 'Efforts', profile: EFFORTS_STREAM_PROFILE, shortcuts: true },
  { id: SESSIONS_STREAM_PROFILE.route, label: 'Sessions', profile: SESSIONS_STREAM_PROFILE, shortcuts: true },
  { id: PLAYGROUNDS_STREAM_PROFILE.route, label: 'Playgrounds', profile: PLAYGROUNDS_STREAM_PROFILE, shortcuts: true },
  { id: '/dashboards', label: 'Dashboards', systemDefaultWql: ':dashboard{}' },
  { id: PALETTE_ROUTE_ID, label: '⌘K Command Palette' },
]

/** Editor draft; `defaultWql: ''` and custom-off lists mean "system default". */
interface EditorState {
  defaultWql: string
  customType: boolean
  typeOptions: string[]
  customGroup: boolean
  groupByOptions: string[]
}

function stateFromConfig(config: RouteWqlConfig): EditorState {
  return {
    defaultWql: config.defaultWql ?? '',
    customType: config.typeOptions !== undefined,
    typeOptions: config.typeOptions ?? [],
    customGroup: config.groupByOptions !== undefined,
    groupByOptions: config.groupByOptions ?? [],
  }
}

function stateToConfig(state: EditorState): RouteWqlConfig {
  return {
    defaultWql: state.defaultWql.trim() || undefined,
    typeOptions: state.customType ? state.typeOptions : undefined,
    groupByOptions: state.customGroup ? state.groupByOptions : undefined,
  }
}

const LABEL_BY_TYPE_OPTION: Record<string, string> = Object.fromEntries(
  [...SOURCE_OPTIONS, ...TARGET_OPTIONS].map(o => [o.value, o.label]),
)
const LABEL_BY_GROUP_OPTION: Record<string, string> = Object.fromEntries(
  GROUP_BY_FAVORITE_OPTIONS.map(o => [o.id, o.label]),
)

/**
 * Supported-value favorites editor: selected values render as removable chips
 * (order = priority), remaining supported choices render as add buttons.
 * Values outside `choices` (e.g. a migrated canonical target) still render as
 * chips so nothing silently disappears.
 */
function FavoriteOptionsEditor({
  values,
  choices,
  labels,
  onChange,
  testPrefix,
}: {
  values: string[]
  choices: readonly { value: string; label: string }[]
  labels: Record<string, string>
  onChange: (next: string[]) => void
  testPrefix: string
}) {
  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map(value => (
            <span
              key={value}
              data-testid={`${testPrefix}-chip-${value}`}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium"
            >
              {labels[value] ?? value}
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

function RouteWqlEditor({ surface }: { surface: ConfigurableSurface }) {
  const systemDefaultWql = surface.profile?.defaultWql ?? surface.systemDefaultWql ?? PALETTE_SEED_QUERY
  const systemTarget = surface.profile?.target
  const systemScopeOptions = surface.profile?.scopeOptions ?? []

  const [state, setState] = useState<EditorState>(() => stateFromConfig(readRouteWqlConfig(surface.id)))
  const [savedConfig, setSavedConfig] = useState<RouteWqlConfig>(() => readRouteWqlConfig(surface.id))
  const [storageError, setStorageError] = useState<string | null>(null)

  const wqlError = useMemo(() => {
    const text = state.defaultWql.trim()
    if (!text) return null
    return resolveQueryDraft(text).error ?? null
  }, [state.defaultWql])

  const nextConfig = stateToConfig(state)
  const dirty = JSON.stringify(nextConfig) !== JSON.stringify(savedConfig)
  const hasOverride = Object.values(savedConfig).some(v => v !== undefined)
  const invalidReport = [
    ...(savedConfig.invalidTypeOptions ?? []),
    ...(savedConfig.invalidGroupByOptions ?? []),
  ]

  // Text-first validation: the save action validates the current draft with
  // the shared parser rather than relying on render-time state visibility.
  const save = async () => {
    if (!dirty) return
    const text = state.defaultWql.trim()
    if (text && resolveQueryDraft(text).error) return
    if (!(await writeRouteWqlConfig(surface.id, nextConfig))) {
      setStorageError('Save failed — storage is unavailable; the previous default still stands.')
      return
    }
    setStorageError(null)
    setSavedConfig(readRouteWqlConfig(surface.id))
  }

  const reset = async () => {
    if (!(await clearRouteWqlConfig(surface.id))) {
      setStorageError('Reset failed — storage is unavailable; the stored override still stands.')
      return
    }
    setStorageError(null)
    setSavedConfig({})
    setState(stateFromConfig({}))
  }

  return (
    <div
      className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4"
      data-testid={`query-defaults-card-${surface.id}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{surface.label}</h3>
        <span className="font-mono text-xs text-muted-foreground">{surface.id}</span>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground">Landing default query</label>
        <p className="text-xs text-muted-foreground">
          System default: <span className="font-mono">{systemDefaultWql}</span>
        </p>
        <textarea
          rows={2}
          value={state.defaultWql}
          onChange={e => setState({ ...state, defaultWql: e.target.value })}
          placeholder={systemDefaultWql}
          data-testid={`query-defaults-wql-${surface.id}`}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        {wqlError ? (
          <p className="text-xs text-destructive" data-testid={`query-defaults-wql-error-${surface.id}`}>
            Couldn't parse — {wqlError}
          </p>
        ) : (
          !state.defaultWql.trim() && (
            <p className="text-xs text-muted-foreground">Empty — the system default is used.</p>
          )
        )}
      </div>

      {invalidReport.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400" data-testid={`query-defaults-invalid-${surface.id}`}>
          Stored options no longer recognized: {invalidReport.join(', ')} — remove them; they are never
          turned into query clauses.
        </p>
      )}

      {surface.profile && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-muted-foreground">Where-stored options</label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Custom
            <Switch
              checked={state.customType}
              onChange={customType => setState({ ...state, customType })}
              data-testid={`query-defaults-type-custom-${surface.id}`}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          System: target {systemTarget}, scopes {systemScopeOptions.join(', ') || '—'}
        </p>
        {state.customType && (
          <>
            <FavoriteOptionsEditor
              values={state.typeOptions}
              choices={systemTarget === 'note' ? SOURCE_OPTIONS : []}
              labels={LABEL_BY_TYPE_OPTION}
              onChange={typeOptions => setState({ ...state, typeOptions })}
              testPrefix={`query-defaults-type-${surface.id}`}
            />
            {state.typeOptions.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400" data-testid={`query-defaults-type-empty-${surface.id}`}>
                No predefined options — the route nudges for a pick instead.
              </p>
            )}
          </>
        )}
      </div>
      )}

      {surface.profile && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-muted-foreground">Arrange-cards-by options</label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Custom
            <Switch
              checked={state.customGroup}
              onChange={customGroup => setState({ ...state, customGroup })}
              data-testid={`query-defaults-group-custom-${surface.id}`}
            />
          </label>
        </div>
        {state.customGroup && (
          <FavoriteOptionsEditor
            values={state.groupByOptions}
            choices={GROUP_BY_FAVORITE_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
            labels={LABEL_BY_GROUP_OPTION}
            onChange={groupByOptions => setState({ ...state, groupByOptions })}
            testPrefix={`query-defaults-group-${surface.id}`}
          />
        )}
      </div>
      )}

      {surface.shortcuts && <RouteShortcutsEditor surface={surface} />}

      {storageError && (
        <p className="text-xs text-destructive" data-testid={`query-defaults-storage-error-${surface.id}`} role="alert">
          {storageError}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          onClick={save}
          disabled={!dirty || !!wqlError}
          data-testid={`query-defaults-save-${surface.id}`}
        >
          Save
        </Button>
        {hasOverride && (
          <Button variant="ghost" size="sm" onClick={reset} data-testid={`query-defaults-reset-${surface.id}`}>
            <RotateCcw className="size-3.5" />
            <span>Reset to system default</span>
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Settings editor for one library group's shortcuts: the built-in links
 * (landing, route action) plus the user's saved full-WQL shortcuts.
 * Built-ins — the landing All link and route actions — edit label/icon
 * only and cannot be deleted (the All link is the permanent default row;
 * resolveRouteShortcuts re-adds it even to legacy lists that lack it).
 * Deleting any other link removes it from the panel. Writes are
 * read-back-verified; a dropped write keeps the list as-is with an error
 * instead of a false success, and successful writes reach the nav panels
 * live (no reload).
 */
function RouteShortcutsEditor({ surface }: { surface: ConfigurableSurface }) {
  const shortcuts = useRouteShortcuts(surface.id)
  const [editor, setEditor] = useState<{ editing: WqlShortcut | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (shortcut: WqlShortcut) => {
    setError(null)
    if (!(await writeRouteShortcuts(surface.id, shortcuts.filter(s => s.id !== shortcut.id)))) {
      setError('Delete failed — storage is unavailable. Nothing was lost; the link remains.')
    }
  }

  return (
    <div className="space-y-2" data-testid={`query-defaults-shortcuts-${surface.id}`}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-muted-foreground">Saved shortcuts (navigation links)</label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditor({ editing: null })}
          data-testid={`query-defaults-shortcut-new-${surface.id}`}
        >
          <Plus className="size-3.5" />
          <span>New shortcut</span>
        </Button>
      </div>
      {shortcuts.map(s => {
        const Icon = SHORTCUT_ICONS[s.icon]!
        const description = s.to ? `Opens ${s.to}` : s.wql || 'Landing (no query)'
        return (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5"
            data-testid={`query-defaults-shortcut-${surface.id}:${s.id}`}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 max-w-40 truncate text-xs font-medium">{s.label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{description}</span>
            <button
              type="button"
              aria-label={`Edit ${s.label}`}
              data-testid={`query-defaults-shortcut-edit-${surface.id}:${s.id}`}
              onClick={() => setEditor({ editing: s })}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-3" />
            </button>
            {!s.to && s.id !== ALL_SHORTCUT_ID && (
              <button
                type="button"
                aria-label={`Delete ${s.label}`}
                data-testid={`query-defaults-shortcut-delete-${surface.id}:${s.id}`}
                onClick={() => remove(s)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        )
      })}
      {error && (
        <p role="alert" className="text-xs text-destructive" data-testid={`query-defaults-shortcut-error-${surface.id}`}>
          {error}
        </p>
      )}
      {editor && (
        <SaveWqlShortcutDialog
          open
          onOpenChange={open => {
            if (!open) setEditor(null)
          }}
          route={surface.id}
          editing={editor.editing}
        />
      )}
    </div>
  )
}

export function QueryDefaultsSection() {
  return (
    <section data-testid="query-defaults-section" className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Query Defaults</h2>
        <p className="text-sm text-muted-foreground">
          Override the landing query and the Where-stored / arrangement options per surface. An empty query
          uses the system default; an emptied options list nudges you to pick instead of presetting one.
          Option lists are favorites — they reorder choices, they don't change what queries mean. Stored{' '}
          {remotePrefsMode ? 'on the server.' : 'in this browser only.'}
        </p>
      </div>
      {CONFIGURABLE_SURFACES.map(surface => (
        <RouteWqlEditor key={surface.id} surface={surface} />
      ))}
    </section>
  )
}
