/**
 * ConditionsNavPanel — the shared L2 panel for the list routes
 * (/notebooks /notes /feeds /pages /efforts /equipment /sessions) and,
 * via NotebookZonePanel, the journal (/journal, /day/:date) and
 * playgrounds (/playgrounds, /playground/:id) views inside the notebooks
 * zone — one route-keyed panel per view.
 *
 * Navigation and discovery only: chrome rows (landing row,
 * Custom row with save/clear, saved shortcuts, page actions) plus a Recent
 * section linking the committed results of the CURRENT route+query. L2 never
 * renders where-clause filters — those moved to the L3 stream controls
 * (StreamControlsNav ▸ FacetProperties, via the rail, the header ⋯ dropdown
 * and the mobile thumb ⋯ sheet).
 *
 * Grouping presets ("Arrange by …", "All time") ride the CURRENT query as
 * their base — never the profile default — and page actions (Feeds, the
 * landing row) stay plain routes.
 */

import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { BookmarkPlus, Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react'

import { parseQuery } from '@bitcobblers/wod-wiki-wql'
import { resolveQueryDraft } from '@bitcobblers/wod-wiki-ui'

import { SidebarItem, SidebarLabel, SidebarSection, SidebarHeading } from '@/components/organisms/layout/Sidebar'

import { useAppliedRouteWqlConfig } from '../../lib/routeWqlConfig'
import {
  ALL_SHORTCUT_ID,
  SHORTCUT_ICONS,
  resolveRouteShortcuts,
  shortcutMatches,
  useBuiltinRouteShortcuts,
  useRouteShortcuts,
  writeRouteShortcuts,
  type WqlShortcut,
} from '../../lib/routeWqlShortcuts'
import type { StreamProfile } from '../../views/stream/streamProfile'
import { useStreamResults } from '../../views/stream/streamResults'
import { entryOpenHref } from '../../lib/entryActions'

import type { NavItem, NavPanelProps } from '../navTypes'
import { executeNavAction } from '../navTypes'
import { useCloseNavigationDrawer } from '../NavigationDrawerContext'
import { navigateToQuery } from './FacetProperties'

export interface ConditionsPanelSpec {
  /** Landing ("All …") row label and route. */
  landingLabel: string
  icon: NavItem['icon']
  route: string
  profile: StreamProfile
  /** Plain page actions after the presets (e.g. Feeds). */
  extraChildren?: NavItem[]
  /** Whole zone route family (drives landing-row + L1 activation). */
  familyActive: (loc: Location) => boolean
}

const urlQuery = (loc: Location): string => new URLSearchParams(loc.search).get('q') ?? ''

/** Deterministic cap on the L2 Recent links — the committed run's head rows. */
export const RECENT_RESULTS_LIMIT = 8

interface InlineEditorDraft {
  mode: 'create' | 'edit'
  targetId?: string
  label: string
  icon: string
  wql: string
  fixedRoute?: string
}

export function createConditionsNavPanel(spec: ConditionsPanelSpec) {
  return function ConditionsNavPanel(_props: NavPanelProps | Record<string, unknown>) {
    const location = useLocation()
    const navigate = useNavigate()
    // The Route-Default overlay resolves LIVE, so the panel and the view
    // agree on the fallback — and a save in the page's own query settings
    // is reflected here without a reload.
    const profile = useAppliedRouteWqlConfig(spec.profile)

    const rawQ = urlQuery(location)
    const effectiveQuery = rawQ && !parseQuery(rawQ).error ? rawQ : profile.defaultWql

    const apply = (wql: string) => navigateToQuery(location, navigate, wql)
    // Full-query shortcuts (landing row, grouping presets, page actions)
    // replace the whole query/page — the drawer closes after navigating.
    // Facet edits and inline saved-link management keep it open.
    const closeNavigationDrawer = useCloseNavigationDrawer()

    // Recent — the committed run for THIS route+query (both must match, so a
    // previous page's or a superseded draft's results never appear). The
    // facets' pending-stale display is deliberately not mirrored here: links
    // are discovery, they hide until a matching run commits. No query
    // execution — the panel subscribes to the view's published snapshot.
    const published = useStreamResults()
    const recentEntries =
      published && published.pathname === location.pathname && published.query === effectiveQuery
        ? published.entries.slice(0, RECENT_RESULTS_LIMIT)
        : []

    // Saved shortcuts (routeWqlShortcuts): the built-in library-group links
    // (landing, Feeds route action) plus the user's saved full-WQL links
    // (grouping `by {}` is simply part of a saved query — the per-section
    // Group-by checkbox owns ad-hoc grouping edits). Matching is full-query
    // and permutation-insensitive on WHERE items / group dimensions, so a
    // base All link never matches a custom filter and an unmatched query is
    // the Custom row above the Create action. Writes elsewhere (WQL line,
    // Settings) land here live via useRouteShortcuts.
    const shortcuts = useRouteShortcuts(spec.route)
    const builtins = useBuiltinRouteShortcuts(spec.route)
    const matchCtx = { pathname: location.pathname, query: urlQuery(location) }
    const allShortcut = shortcuts.find(s => s.id === ALL_SHORTCUT_ID) ?? null
    const userShortcuts = shortcuts.filter(s => s.to === undefined && s.id !== ALL_SHORTCUT_ID)
    const landingWql = allShortcut?.wql ?? ''
    const landingLabel = allShortcut?.label ?? spec.landingLabel
    const LandingIcon = allShortcut ? SHORTCUT_ICONS[allShortcut.icon]! : spec.icon
    const customQuery =
      matchCtx.query && !parseQuery(matchCtx.query).error && !shortcuts.some(s => shortcutMatches(s, matchCtx))
        ? effectiveQuery
        : null

    const [manageMode, setManageMode] = useState(false)
    const [editorDraft, setEditorDraft] = useState<InlineEditorDraft | null>(null)
    const [storageError, setStorageError] = useState<string | null>(null)

    const openCreateEditor = (seedWql: string) => {
      setStorageError(null)
      setEditorDraft({
        mode: 'create',
        label: '',
        icon: 'bookmark',
        wql: seedWql,
      })
    }

    const openEditShortcut = (s: WqlShortcut) => {
      setStorageError(null)
      setEditorDraft({
        mode: 'edit',
        targetId: s.id,
        label: s.label,
        icon: s.icon,
        wql: s.wql,
        fixedRoute: s.to,
      })
    }

    const handleReorder = async (shortcutId: string, direction: -1 | 1) => {
      const current = resolveRouteShortcuts(spec.route, undefined, builtins)
      const plainIdx = userShortcuts.findIndex(s => s.id === shortcutId)
      const swapIdx = plainIdx + direction
      if (plainIdx < 0 || swapIdx < 0 || swapIdx >= userShortcuts.length) return
      const aId = userShortcuts[plainIdx]!.id
      const bId = userShortcuts[swapIdx]!.id
      const fullA = current.findIndex(s => s.id === aId)
      const fullB = current.findIndex(s => s.id === bId)
      if (fullA < 0 || fullB < 0) return
      const next = [...current]
      const temp = next[fullA]!
      next[fullA] = next[fullB]!
      next[fullB] = temp
      await writeRouteShortcuts(spec.route, next)
    }

    const handleDeleteShortcut = async (shortcut: WqlShortcut) => {
      if (shortcut.id === ALL_SHORTCUT_ID || shortcut.to) return
      const wasActive = shortcutMatches(shortcut, matchCtx)
      const current = resolveRouteShortcuts(spec.route, undefined, builtins)
      const next = current.filter(s => s.id !== shortcut.id)
      if (await writeRouteShortcuts(spec.route, next)) {
        if (editorDraft?.targetId === shortcut.id) {
          setEditorDraft(null)
        }
        if (wasActive) {
          if (landingWql) apply(landingWql)
          else navigate(spec.route)
        }
      }
    }

    const trimmedLabel = editorDraft?.label.trim() ?? ''
    const trimmedWql = editorDraft?.wql.trim() ?? ''
    const isLandingEdit = editorDraft?.mode === 'edit' && editorDraft.targetId === ALL_SHORTCUT_ID
    const isFixedRouteEdit = Boolean(editorDraft?.fixedRoute)
    const queryRequired = !isLandingEdit && !isFixedRouteEdit
    const wqlError =
      !isFixedRouteEdit && trimmedWql ? (resolveQueryDraft(trimmedWql).error ?? null) : null
    const canSaveDraft =
      Boolean(editorDraft) &&
      trimmedLabel.length > 0 &&
      (!queryRequired || trimmedWql.length > 0) &&
      !wqlError

    const handleSaveDraft = async (event: FormEvent) => {
      event.preventDefault()
      if (!editorDraft || !canSaveDraft) return
      const current = resolveRouteShortcuts(spec.route, undefined, builtins)
      const existing = editorDraft.targetId
        ? current.find(s => s.id === editorDraft.targetId) ?? null
        : null
      const wasActive = existing ? shortcutMatches(existing, matchCtx) : false
      const nextItem: WqlShortcut = {
        id: existing?.id ?? crypto.randomUUID(),
        label: trimmedLabel,
        icon: editorDraft.icon,
        wql: isFixedRouteEdit ? (existing?.wql ?? '') : trimmedWql,
        ...(existing?.to ? { to: existing.to } : {}),
      }
      const nextList = existing
        ? current.map(s => (s.id === existing.id ? nextItem : s))
        : [...current, nextItem]
      if (!(await writeRouteShortcuts(spec.route, nextList))) {
        setStorageError('Couldn\u2019t save — storage is unavailable.')
        return
      }
      setStorageError(null)
      setEditorDraft(null)
      if (existing && wasActive && !nextItem.to) {
        if (nextItem.wql) apply(nextItem.wql)
        else navigate(spec.route)
      } else if (!existing && nextItem.wql && nextItem.wql !== effectiveQuery) {
        apply(nextItem.wql)
      }
    }

    const renderInlineEditor = () => {
      if (!editorDraft) return null
      return (
        <form
          onSubmit={handleSaveDraft}
          data-testid="conditions-nav-inline-editor"
          className="my-1.5 flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5 shadow-xs"
          noValidate
        >
          <div className="space-y-1">
            <label
              htmlFor="conditions-inline-shortcut-label"
              className="block text-[11px] font-semibold text-muted-foreground"
            >
              Label
            </label>
            <input
              id="conditions-inline-shortcut-label"
              type="text"
              value={editorDraft.label}
              onChange={e => setEditorDraft(prev => (prev ? { ...prev, label: e.target.value } : prev))}
              placeholder="e.g. Strength this month"
              aria-label="Shortcut label"
              data-testid="conditions-nav-editor-label"
              autoFocus
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {!isFixedRouteEdit && (
            <div className="space-y-1">
              <label
                htmlFor="conditions-inline-shortcut-wql"
                className="block text-[11px] font-semibold text-muted-foreground"
              >
                Query (WQL)
              </label>
              <textarea
                id="conditions-inline-shortcut-wql"
                rows={2}
                value={editorDraft.wql}
                onChange={e => setEditorDraft(prev => (prev ? { ...prev, wql: e.target.value } : prev))}
                placeholder={queryRequired ? ':note{...}' : 'Empty — plain route landing'}
                aria-label="Shortcut query"
                data-testid="conditions-nav-editor-wql"
                aria-invalid={wqlError ? true : undefined}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              {wqlError && (
                <p
                  role="alert"
                  data-testid="conditions-nav-editor-error"
                  className="text-[11px] text-destructive"
                >
                  Couldn&apos;t parse — {wqlError}
                </p>
              )}
            </div>
          )}

          <fieldset className="space-y-1">
            <legend className="text-[11px] font-semibold text-muted-foreground">Icon</legend>
            <div className="flex flex-wrap gap-1">
              {Object.entries(SHORTCUT_ICONS).map(([name, Icon]) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  aria-label={`Icon ${name}`}
                  aria-pressed={editorDraft.icon === name}
                  data-testid={`conditions-nav-editor-icon-${name}`}
                  onClick={() => setEditorDraft(prev => (prev ? { ...prev, icon: name } : prev))}
                  className={
                    editorDraft.icon === name
                      ? 'grid size-7 max-lg:size-8 place-items-center rounded-md border border-primary bg-primary/10 text-primary'
                      : 'grid size-7 max-lg:size-8 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground'
                  }
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>

          {storageError && (
            <p role="alert" className="text-[11px] text-destructive">
              {storageError}
            </p>
          )}

          <div className="flex items-center justify-end gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => {
                setEditorDraft(null)
                setStorageError(null)
              }}
              data-testid="conditions-nav-editor-cancel"
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSaveDraft}
              data-testid="conditions-nav-editor-save"
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>
      )
    }

    const resolvedLandingShortcut: WqlShortcut = allShortcut ?? {
      id: ALL_SHORTCUT_ID,
      label: spec.landingLabel,
      icon: 'bookmark',
      wql: '',
    }

    // Full-bleed over the SidebarBody gutter: sections span the whole L2
    // view; shortcuts rows and the Recent list re-inset rows.
    return (
      <div className="-mx-4 flex flex-col gap-1 py-3" data-testid="conditions-nav-panel">
        <SidebarSection className="px-6">
          <div className="mb-1 flex items-center justify-between gap-1 px-2">
            <span className="text-[11px] font-medium text-muted-foreground/75">Saved views</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => openCreateEditor(customQuery ?? effectiveQuery)}
                aria-label="Add saved link"
                title="Add saved link"
                data-testid="conditions-nav-shortcut-add"
                className="grid size-7 max-lg:size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setManageMode(prev => {
                    const next = !prev
                    if (!next) {
                      setEditorDraft(null)
                      setStorageError(null)
                    }
                    return next
                  })
                }}
                aria-label={manageMode ? 'Done editing saved links' : 'Edit saved links'}
                aria-pressed={manageMode}
                title={manageMode ? 'Done' : 'Edit saved links'}
                data-testid="conditions-nav-edit-toggle"
                className={`inline-flex h-7 max-lg:h-8 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors ${
                  manageMode
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                {manageMode ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <Pencil className="size-3" aria-hidden="true" />
                )}
                <span>{manageMode ? 'Done' : 'Edit'}</span>
              </button>
            </div>
          </div>

          {editorDraft?.mode === 'create' && renderInlineEditor()}

          {manageMode ? (
            <div className="flex flex-col gap-1" data-testid="conditions-nav-manage-list">
              <div className="flex flex-col">
                <div className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-foreground">
                  {LandingIcon && <LandingIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{landingLabel}</span>
                  <button
                    type="button"
                    onClick={() => openEditShortcut(resolvedLandingShortcut)}
                    aria-label={`Edit ${landingLabel}`}
                    title={`Edit ${landingLabel}`}
                    data-testid={`conditions-nav-shortcut-edit-${ALL_SHORTCUT_ID}`}
                    className="grid size-7 max-lg:size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
                {editorDraft?.mode === 'edit' && editorDraft.targetId === ALL_SHORTCUT_ID && renderInlineEditor()}
              </div>

              {userShortcuts.map((s, idx) => {
                const Icon = SHORTCUT_ICONS[s.icon]!
                return (
                  <div key={`manage-${s.id}`} className="flex flex-col">
                    <div
                      className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-sm text-foreground"
                      data-testid={`conditions-nav-manage-row-${s.id}`}
                    >
                      <Icon className="mr-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.label}</span>
                      {userShortcuts.length > 1 && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => void handleReorder(s.id, -1)}
                            aria-label={`Move ${s.label} up`}
                            title="Move up"
                            data-testid={`conditions-nav-shortcut-up-${s.id}`}
                            className="grid size-7 max-lg:size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronUp className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === userShortcuts.length - 1}
                            onClick={() => void handleReorder(s.id, 1)}
                            aria-label={`Move ${s.label} down`}
                            title="Move down"
                            data-testid={`conditions-nav-shortcut-down-${s.id}`}
                            className="grid size-7 max-lg:size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronDown className="size-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditShortcut(s)}
                        aria-label={`Edit ${s.label}`}
                        title={`Edit ${s.label}`}
                        data-testid={`conditions-nav-shortcut-edit-${s.id}`}
                        className="grid size-7 max-lg:size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteShortcut(s)}
                        aria-label={`Delete ${s.label}`}
                        title={`Delete ${s.label}`}
                        data-testid={`conditions-nav-shortcut-delete-${s.id}`}
                        className="grid size-7 max-lg:size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {editorDraft?.mode === 'edit' && editorDraft.targetId === s.id && renderInlineEditor()}
                  </div>
                )
              })}
            </div>
          ) : (
            <>
              {customQuery ? (
                <div className="flex items-center gap-1" data-testid="conditions-nav-custom">
                  <SidebarItem
                    current
                    className="min-w-0 flex-1"
                    title={customQuery}
                    aria-label={`Custom query: ${customQuery}`}
                    onClick={() => {
                      apply(customQuery)
                      closeNavigationDrawer()
                    }}
                  >
                    {LandingIcon && <LandingIcon data-slot="icon" />}
                    <SidebarLabel>Custom</SidebarLabel>
                  </SidebarItem>
                  <button
                    type="button"
                    onClick={() => openCreateEditor(customQuery)}
                    aria-label="Save shortcut"
                    title="Save shortcut"
                    data-testid="conditions-nav-custom-save"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <BookmarkPlus className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (landingWql) {
                        apply(landingWql)
                      } else {
                        navigate(spec.route)
                      }
                      closeNavigationDrawer()
                    }}
                    aria-label="Clear query"
                    title="Clear to all entries"
                    data-testid="conditions-nav-custom-clear"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <SidebarItem
                  onClick={() => {
                    if (landingWql) {
                      apply(landingWql)
                    } else {
                      navigate(spec.route)
                    }
                    closeNavigationDrawer()
                  }}
                  current={
                    landingWql && allShortcut
                      ? shortcutMatches(allShortcut, matchCtx)
                      : spec.familyActive(location) && urlQuery(location).trim() === ''
                  }
                >
                  {LandingIcon && <LandingIcon data-slot="icon" />}
                  <SidebarLabel>{landingLabel}</SidebarLabel>
                </SidebarItem>
              )}
              {userShortcuts.map(s => {
                const Icon = SHORTCUT_ICONS[s.icon]!
                return (
                  <SidebarItem
                    key={`shortcut-${s.id}`}
                    onClick={() => {
                      if (s.wql) apply(s.wql)
                      else navigate(spec.route)
                      closeNavigationDrawer()
                    }}
                    current={shortcutMatches(s, matchCtx)}
                    data-testid={`nav-shortcut-${s.id}`}
                  >
                    <Icon data-slot="icon" />
                    <SidebarLabel>{s.label}</SidebarLabel>
                  </SidebarItem>
                )
              })}
              {(spec.extraChildren ?? []).map(child => {
                const target = child.action.type === 'route' ? child.action.to : null
                const override = target ? shortcuts.find(s => s.to === target) : null
                const OverrideIcon = override ? SHORTCUT_ICONS[override.icon]! : null
                return (
                  <SidebarItem
                    key={child.id}
                    onClick={() => {
                      if (child.action) {
                        executeNavAction(child.action, { navigate, setQueryParam: () => {} })
                        closeNavigationDrawer()
                      }
                    }}
                    current={child.isActive?.(location) ?? false}
                    data-testid={override ? `nav-shortcut-${override.id}` : child.id}
                  >
                    {OverrideIcon ? <OverrideIcon data-slot="icon" /> : child.icon && <child.icon data-slot="icon" />}
                    <SidebarLabel>{override?.label ?? child.label}</SidebarLabel>
                  </SidebarItem>
                )
              })}
            </>
          )}
        </SidebarSection>

        {recentEntries.length > 0 && (
          <SidebarSection className="px-6" data-testid="conditions-nav-recent">
            <SidebarHeading>Recent</SidebarHeading>
            {recentEntries.map(entry => {
              const timeLabel = entry.execution?.timestamp
                ? new Date(entry.execution.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                : null
              return (
                <SidebarItem
                  key={`${entry.id}:${entry.block?.blockId ?? ''}`}
                  href={entryOpenHref(entry)}
                  onClick={closeNavigationDrawer}
                  data-testid="conditions-nav-recent-link"
                >
                  <SidebarLabel>{entry.title}</SidebarLabel>
                  {timeLabel && (
                    <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                      {timeLabel}
                    </span>
                  )}
                </SidebarItem>
              )
            })}
          </SidebarSection>
        )}
      </div>
    )
  }
}
