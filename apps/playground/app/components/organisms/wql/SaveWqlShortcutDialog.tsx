/**
 * SaveWqlShortcutDialog — the accessible save/edit editor for route WQL
 * shortcuts (wayfinder: library group links).
 *
 * One editor for every entry point: the WQL line save icon, the nav panel's
 * Custom row / Create action, and Settings ▸ Query Defaults. Plain
 * shortcuts prefill the current WQL and validate a nonempty label,
 * parser-valid WQL and the finite icon vocabulary (grouping `by {}` is just
 * part of the saved query). The built-in route action edits label/icon
 * only — its target route is fixed. A dropped write (quota / private
 * browsing) keeps the form open with an error — never a false success.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { EditorDialog, resolveQueryDraft } from '@bitcobblers/wod-wiki-ui'
import { remotePrefsMode } from '@/services/storage/metaStore'
import { Button } from '@/components/atoms/primitives/button'

import {
  ALL_SHORTCUT_ID,
  SHORTCUT_ICONS,
  resolveRouteShortcuts,
  writeRouteShortcuts,
  type WqlShortcut,
} from '../../../lib/routeWqlShortcuts'

export interface SaveWqlShortcutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Route the shortcut is saved under (persisted per library group). */
  route: string
  /** Existing shortcut being edited; null/undefined creates a new one. */
  editing?: WqlShortcut | null
  /** Query prefilled for a new shortcut (the WQL line's current draft). */
  initialQuery?: string
}

const fieldClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40'

export function SaveWqlShortcutDialog({
  open,
  onOpenChange,
  route,
  editing = null,
  initialQuery = '',
}: SaveWqlShortcutDialogProps) {
  const [label, setLabel] = useState(editing?.label ?? '')
  const [icon, setIcon] = useState(editing?.icon ?? 'bookmark')
  const [wql, setWql] = useState(editing ? editing.wql : initialQuery)
  const [storageError, setStorageError] = useState<string | null>(null)

  // Re-seed the draft each time the editor opens — callers reuse one mounted
  // dialog with different prefill (WQL line vs panel Custom row vs Settings).
  useEffect(() => {
    if (open) {
      setLabel(editing?.label ?? '')
      setIcon(editing?.icon ?? 'bookmark')
      setWql(editing ? editing.wql : initialQuery)
      setStorageError(null)
    }
  }, [open, editing, initialQuery])

  // A route action has fixed behaviour — only label/icon edit. A plain
  // shortcut must route a query ('' is legal only for the built-in landing
  // link, where it means the plain route).
  const fixedBehaviour = editing !== null && !!editing.to
  const queryRequired = editing?.id !== ALL_SHORTCUT_ID
  const trimmedLabel = label.trim()
  const trimmedWql = wql.trim()
  const wqlError = trimmedWql ? resolveQueryDraft(trimmedWql).error ?? null : null
  const labelError = trimmedLabel ? null : 'Label is required.'
  const canSave = !!trimmedLabel && !fixedBehaviour && (!queryRequired || !!trimmedWql) && !wqlError

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    const next: WqlShortcut = {
      id: editing?.id ?? crypto.randomUUID(),
      label: trimmedLabel,
      icon,
      wql: fixedBehaviour ? editing!.wql : trimmedWql,
      ...(editing?.to !== undefined ? { to: editing.to } : {}),
    }
    // Resolve (built-ins included) so a first save never drops them.
    const others = resolveRouteShortcuts(route).filter(s => s.id !== next.id)
    // Persistence-verified write: false means storage dropped it (browser
    // quota locally, failed server request in api mode) — keep the dialog
    // open with the draft intact instead of claiming success.
    if (!(await writeRouteShortcuts(route, [...others, next]))) {
      setStorageError('Couldn\u2019t save — storage is unavailable. Your input is kept.')
      return
    }
    onOpenChange(false)
  }

  return (
    <EditorDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={editing ? 'Edit shortcut' : 'Save search shortcut'}
      description={`Saved shortcuts appear in this route's navigation panel. Stored ${
        remotePrefsMode ? 'on the server.' : 'in this browser only.'
      }`}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="save-wql-shortcut-form" size="sm" disabled={!canSave} data-testid="shortcut-save">
            Save
          </Button>
        </div>
      }
    >
      <form id="save-wql-shortcut-form" onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="shortcut-label" className="text-xs font-semibold text-muted-foreground">
            Label
          </label>
          <input
            id="shortcut-label"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Strength this month"
            data-testid="shortcut-label-input"
            aria-invalid={labelError ? true : undefined}
            className={fieldClass}
          />
          {labelError && (
            <p role="alert" className="text-xs text-destructive" data-testid="shortcut-label-error">
              {labelError}
            </p>
          )}
        </div>

        {fixedBehaviour ? (
          <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Route action — always opens {editing?.to}. Label and icon are editable.
          </p>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="shortcut-query" className="text-xs font-semibold text-muted-foreground">
              Query (WQL)
            </label>
            <textarea
              id="shortcut-query"
              rows={2}
              value={wql}
              onChange={e => setWql(e.target.value)}
              placeholder={queryRequired ? 'find …' : 'Empty — the plain route landing'}
              data-testid="shortcut-query-input"
              aria-invalid={wqlError ? true : undefined}
              className={`${fieldClass} font-mono text-xs`}
            />
            {wqlError ? (
              <p role="alert" className="text-xs text-destructive" data-testid="shortcut-query-error">
                Couldn&apos;t parse — {wqlError}
              </p>
            ) : (
              !trimmedWql && (
                <p className="text-xs text-muted-foreground">
                  {queryRequired ? 'A shortcut needs a query.' : 'Empty — opens the plain route landing.'}
                </p>
              )
            )}
          </div>
        )}

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-semibold text-muted-foreground">Icon</legend>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(SHORTCUT_ICONS).map(([name, Icon]) => (
              <label
                key={name}
                title={name}
                className={
                  icon === name
                    ? 'cursor-pointer rounded-md border border-primary bg-primary/10 p-1.5 text-primary'
                    : 'cursor-pointer rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground'
                }
              >
                <input
                  type="radio"
                  name="shortcut-icon"
                  value={name}
                  checked={icon === name}
                  onChange={() => setIcon(name)}
                  aria-label={`Icon ${name}`}
                  data-testid={`shortcut-icon-${name}`}
                  className="sr-only"
                />
                <Icon className="size-4" aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>

        {storageError && (
          <p role="alert" className="text-xs text-destructive" data-testid="shortcut-storage-error">
            {storageError}
          </p>
        )}
      </form>
    </EditorDialog>
  )
}
