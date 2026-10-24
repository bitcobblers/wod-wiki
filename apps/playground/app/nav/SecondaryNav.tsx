/**
 * SecondaryNav — shell zone 4: the right-hand "On this page" rail.
 *
 * Content = the stream surface's VIEW controls (date window, group-by,
 * layout, visible fields — the same state the View dialog and header
 * buttons drive) + stream controls + route-declared spec (shell.secondary)
 * + the page's own index (NavContext l3Items — published by useNotePageNav /
 * CanvasPage / HomeTour). Where-clause filters live ONLY in the L2 context
 * panel (ConditionsNavPanel ▸ FacetProperties). Desktop (2xl+) renders this
 * rail; below 2xl the same entries collapse into the ⋯ header menu
 * (ActionsMenu) and the mobile right drawer, per the responsive shell
 * contract.
 */

import { useMemo, type ReactNode } from 'react'
import { LayoutGrid, Rss, Table } from 'lucide-react'

import { MenuList, useActiveSectionId, useResolvedMenu } from './MenuList'
import { useNav, type StreamNavControls } from './NavContext'
import { l3ToMenuEntries } from './menuModel'
import type { MenuSpec } from './menuModel'
import { WqlWindowPicker } from '../views/stream/WqlWindowPicker'
import { QuerySettingsTrigger } from '../components/organisms/wql/QuerySettingsTrigger'
import type { LayoutMode } from '../lib/viewSettingsStorage'
import { getFieldsForLevel } from '../lib/fieldProjection'

const LAYOUT_OPTIONS: readonly { id: LayoutMode; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'cards', label: 'Cards', icon: LayoutGrid },
  { id: 'rows', label: 'Rows', icon: Table },
  { id: 'feed', label: 'Feed', icon: Rss },
]

/**
 * StreamControlsNav — the L3 stream-controls block (date window picker +
 * group-by toggles + layout + visible fields + the query-settings entry).
 * Rendered by the 2xl+ rail AND by the ⋯ fallback (dropdown + dock sheet)
 * below 2xl, so every surface carries the same components bound to the same
 * NavContext streamControls.
 */
export function StreamControlsNav({ streamControls }: { streamControls: StreamNavControls }) {
  return (
    <div className="flex flex-col gap-3" data-testid="l3-stream-controls">
      {streamControls.onOpenQuerySettings && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            This page
          </span>
          <QuerySettingsTrigger onOpen={streamControls.onOpenQuerySettings} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Date window
        </span>
        <WqlWindowPicker
          query={streamControls.query}
          onQueryChange={streamControls.onQueryChange}
          className="w-full justify-between"
        />
      </div>

      {/* Group by properties as items to check under it */}
      {streamControls.availableGroupDims.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Group by
          </span>
          <div className="flex flex-col gap-0.5" data-testid="l3-groupby-options">
            {streamControls.availableGroupDims.map(opt => {
              const checked = streamControls.groupDims.some(
                d => d.toLowerCase() === opt.id.toLowerCase()
              )
              return (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground/80 hover:bg-muted/60 transition-colors"
                  data-testid={`l3-groupby-${opt.id}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => streamControls.onToggleGroupDim(opt.id)}
                    className="size-3.5 rounded border-border accent-primary cursor-pointer"
                  />
                  <span>{opt.label}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* Layout + visible fields — per-route view settings; cast stays header-only chrome. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Layout
        </span>
        <div className="grid grid-cols-3 gap-1" data-testid="l3-layout-options">
          {LAYOUT_OPTIONS.map(opt => {
            const Icon = opt.icon
            const active = streamControls.settings.layout === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() => streamControls.onLayoutChange(opt.id)}
                data-testid={`l3-layout-${opt.id}`}
                className={`flex min-h-8 items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-border/80 bg-card text-foreground shadow-sm'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon aria-hidden className="size-3" />
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Fields
        </span>
        <div className="flex flex-col gap-0.5" data-testid="l3-field-options">
          {getFieldsForLevel(streamControls.level).map(field => {
            const checked = streamControls.settings.visibleFields.includes(field.id)
            return (
              <label
                key={field.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground/80 hover:bg-muted/60 transition-colors"
                data-testid={`l3-field-${field.id}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => streamControls.onToggleField(field.id)}
                  className="size-3.5 rounded border-border accent-primary cursor-pointer"
                />
                <span>{field.label}</span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function SecondaryNav({ spec, pageAction }: { spec?: MenuSpec; pageAction?: ReactNode }) {
  const { l3Items, streamControls } = useNav()
  const resolved = useResolvedMenu(spec)
  const toc = useMemo(() => l3ToMenuEntries(l3Items), [l3Items])
  const activeId = useActiveSectionId()

  if (resolved.length === 0 && toc.length === 0 && !streamControls && !pageAction) return null

  return (
    <div className="flex flex-col px-3 py-4 gap-4">
      {streamControls && (
        <div className="pb-3 border-b border-border/50">
          <StreamControlsNav streamControls={streamControls} />
        </div>
      )}

      {resolved.length > 0 && <MenuList entries={resolved} activeId={activeId} />}
      {toc.length > 0 && (
        <div className="flex flex-col">
          <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            On this page
          </div>
          <MenuList entries={toc} activeId={activeId} />
        </div>
      )}
      {pageAction && <div className="pt-2 border-t border-border/50">{pageAction}</div>}
    </div>
  )
}
