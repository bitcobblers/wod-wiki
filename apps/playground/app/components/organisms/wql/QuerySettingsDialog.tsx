/**
 * QuerySettingsPanel — the editable body of a surface's query
 * configuration: the landing default query, the Where-stored scope
 * favorites, the Group-By favorites and the saved navigation shortcuts.
 *
 * The panel is storage-agnostic — it owns the draft and reports changes;
 * the host decides when to persist. `QuerySettingsDialog` wraps it in a
 * modal; the ⌘/ palette renders it inline (the palette is a focus-trapped
 * dialog, so a nested modal on top of it would be unreachable).
 */
import { useEffect, useState } from 'react'
import { EditorDialog, resolveQueryDraft } from '@bitcobblers/wod-wiki-ui'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import {
  clearRouteWqlConfig,
  readRouteWqlConfig,
  useRouteWqlConfig,
  writeRouteWqlConfig,
  type RouteWqlConfig,
} from '../../../lib/routeWqlConfig'
import {
  ALL_SHORTCUT_ID,
  SHORTCUT_ICONS,
  useRouteShortcuts,
  writeRouteShortcuts,
  type WqlShortcut,
} from '../../../lib/routeWqlShortcuts'
import type { QueryConfigSurface } from '../../../lib/queryConfigSurfaces'
import { SaveWqlShortcutDialog } from './SaveWqlShortcutDialog'
import {
  ConfigSection,
  GroupByFavoritesEditor,
  ScopeFavoritesEditor,
  ShortcutsEditor,
  type ShortcutRow,
} from './queryConfigEditors'

/** Editor draft; `defaultWql: ''` and custom-off lists mean "system default". */
interface EditorState {
  defaultWql: string
  customScope: boolean
  scopeOptions: string[]
  customGroupBy: boolean
  groupByOptions: string[]
}

function stateFromConfig(config: RouteWqlConfig): EditorState {
  return {
    defaultWql: config.defaultWql ?? '',
    customScope: config.typeOptions !== undefined,
    scopeOptions: config.typeOptions ?? [],
    customGroupBy: config.groupByOptions !== undefined,
    groupByOptions: config.groupByOptions ?? [],
  }
}

function stateToConfig(state: EditorState): RouteWqlConfig {
  return {
    defaultWql: state.defaultWql.trim() || undefined,
    typeOptions: state.customScope ? state.scopeOptions : undefined,
    groupByOptions: state.customGroupBy ? state.groupByOptions : undefined,
  }
}

export interface QuerySettingsPanelProps {
  /** The surface being configured — its id is the storage key. */
  surface: QueryConfigSurface
  /** Called after a successful save or reset. */
  onSaved?: () => void
}

/**
 * The surface's query settings, editable.
 *
 * The landing default is validated with the shared parser: invalid exact
 * text is shown and blocks the save. The favorites lists are supported-value
 * lists — they reorder choices, they never define grammar validity. A stored
 * id that is neither canonical nor migratable is reported instead of
 * silently turning into a query clause.
 */
export function QuerySettingsPanel({ surface, onSaved }: QuerySettingsPanelProps) {
  const config = useRouteWqlConfig(surface.id)
  const shortcuts = useRouteShortcuts(surface.id)

  const [state, setState] = useState<EditorState>(() => stateFromConfig(config))
  const [savedConfig, setSavedConfig] = useState<RouteWqlConfig>(() => config)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [shortcutError, setShortcutError] = useState<string | null>(null)
  const [shortcutEditor, setShortcutEditor] = useState<{ editing: WqlShortcut | null } | null>(null)

  // Re-seed the draft whenever the stored config changes, so an external
  // change is picked up and a canceled edit never leaks into the next open.
  useEffect(() => {
    setState(stateFromConfig(config))
    setSavedConfig(config)
    setStorageError(null)
    setShortcutError(null)
  }, [config])

  const systemDefaultWql = surface.profile?.defaultWql ?? surface.systemDefaultWql ?? ''

  const wqlError = (() => {
    const text = state.defaultWql.trim()
    if (!text) return null
    return resolveQueryDraft(text).error ?? null
  })()

  const nextConfig = stateToConfig(state)
  const dirty = JSON.stringify(nextConfig) !== JSON.stringify(savedConfig)
  const hasOverride = Object.values(savedConfig).some(v => v !== undefined)
  const invalidReport = [
    ...(savedConfig.invalidTypeOptions ?? []),
    ...(savedConfig.invalidGroupByOptions ?? []),
  ]

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
    onSaved?.()
  }

  const reset = async () => {
    if (!(await clearRouteWqlConfig(surface.id))) {
      setStorageError('Reset failed — storage is unavailable; the stored override still stands.')
      return
    }
    setStorageError(null)
    setSavedConfig({})
    setState(stateFromConfig({}))
    onSaved?.()
  }

  const removeShortcut = async (id: string) => {
    setShortcutError(null)
    if (!(await writeRouteShortcuts(surface.id, shortcuts.filter(s => s.id !== id)))) {
      setShortcutError('Delete failed — storage is unavailable. Nothing was lost; the link remains.')
    }
  }

  const scopeChoices = surface.scopeChoices ?? []
  const hasScopes = scopeChoices.length > 0

  return (
    <div className="space-y-5" data-testid="query-settings-panel">
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
          data-testid="query-settings-wql"
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        {wqlError ? (
          <p className="text-xs text-destructive" data-testid="query-settings-wql-error">
            Couldn't parse — {wqlError}
          </p>
        ) : (
          !state.defaultWql.trim() && (
            <p className="text-xs text-muted-foreground">Empty — the system default is used.</p>
          )
        )}
      </div>

      {invalidReport.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="query-settings-invalid">
          Stored options no longer recognized: {invalidReport.join(', ')} — remove them; they are never
          turned into query clauses.
        </p>
      )}

      {hasScopes && (
        <ConfigSection
          label="Where-stored options"
          enabled={state.customScope}
          onEnabledChange={customScope => setState({ ...state, customScope })}
          testId="query-settings-scope-custom"
        >
          {state.customScope && (
            <>
              <ScopeFavoritesEditor
                values={state.scopeOptions}
                choices={scopeChoices}
                onChange={scopeOptions => setState({ ...state, scopeOptions })}
                testPrefix="query-settings-scope"
              />
              {state.scopeOptions.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="query-settings-scope-empty">
                  No predefined options — the page nudges for a pick instead.
                </p>
              )}
            </>
          )}
        </ConfigSection>
      )}

      {surface.profile && (
        <ConfigSection
          label="Group-by options"
          enabled={state.customGroupBy}
          onEnabledChange={customGroupBy => setState({ ...state, customGroupBy })}
          testId="query-settings-group-custom"
        >
          <p className="text-xs text-muted-foreground">
            The dimensions this page offers first, and the one a bare landing groups by. Order is the
            priority.
          </p>
          {state.customGroupBy && (
            <>
              <GroupByFavoritesEditor
                values={state.groupByOptions}
                onChange={groupByOptions => setState({ ...state, groupByOptions })}
                testPrefix="query-settings-group"
              />
              {state.groupByOptions.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="query-settings-group-empty">
                  No favorites — the page groups by its own default.
                </p>
              )}
            </>
          )}
        </ConfigSection>
      )}

      {surface.shortcuts && (
        <ShortcutsEditor
          shortcuts={shortcuts as readonly ShortcutRow[]}
          icons={SHORTCUT_ICONS}
          landingId={ALL_SHORTCUT_ID}
          onEdit={s => setShortcutEditor({ editing: s as WqlShortcut })}
          onDelete={removeShortcut}
          onCreate={() => setShortcutEditor({ editing: null })}
          error={shortcutError}
          testPrefix="query-settings"
        />
      )}

      {storageError && (
        <p className="text-xs text-destructive" data-testid="query-settings-storage-error" role="alert">
          {storageError}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={!hasOverride}
          data-testid="query-settings-reset"
        >
          <RotateCcw className="size-3.5" />
          <span>Reset to system default</span>
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={!dirty || !!wqlError}
          data-testid="query-settings-save"
        >
          Save
        </Button>
      </div>

      {shortcutEditor && (
        <SaveWqlShortcutDialog
          open
          onOpenChange={open => {
            if (!open) setShortcutEditor(null)
          }}
          route={surface.id}
          editing={shortcutEditor.editing}
        />
      )}
    </div>
  )
}

export interface QuerySettingsDialogProps {
  /** The surface being configured — its id is the storage key. */
  surface: QueryConfigSurface
  /** Whether the dialog is open. */
  open: boolean
  /** Close the dialog. */
  onOpenChange: (open: boolean) => void
}

/**
 * The surface's query settings, in a dialog.
 *
 * The landing default, the Where-stored scope favorites, the Group-By
 * favorites and the saved navigation shortcuts used to sit on a global
 * settings page listing every surface at once. They are per-surface facts
 * about one page's query, so they belong to that page.
 */
export function QuerySettingsDialog({ surface, open, onOpenChange }: QuerySettingsDialogProps) {
  return (
    <EditorDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={`${surface.label} query settings`}
      description="Override the landing query and the Where-stored / Group-By options for this page. An empty query uses the system default; an emptied options list nudges you to pick instead of presetting one. Option lists are favorites — they reorder choices, they don't change what queries mean."
      presentation="sheet"
    >
      <QuerySettingsPanel surface={surface} />
    </EditorDialog>
  )
}
