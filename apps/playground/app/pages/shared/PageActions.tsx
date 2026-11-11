/**
 * PageActions — shared header chrome. Creation is explicitly declared by
 * library/collection surfaces; detail pages receive Cast and sync indicators
 * while StickyPageHeader automatically mounts L3DrawerTrigger ("Page options")
 * at lg–2xl whenever the L3 panel has content.
 */

import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc'
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { PageMode } from '@/types/content-type'

import { NewEntryCombo } from './NewEntryCombo'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useInResponsiveActionsProvider } from '../../nav/ResponsiveActions'
import { SyncActivityIndicators } from '../../nav/SyncActivityUi'

export interface PageActionsProps {
  /** Current page mode retained for route call-site typing. */
  mode: PageMode
  /** Retained for call-site compatibility. */
  currentWorkout?: { name: string; content: string }
  /** Retained for call-site compatibility. */
  index?: PageNavLink[]
  /** Library/collection-only: creates the current surface's entry type. */
  showCreate?: boolean
}

export function PageActions({
  showCreate = false,
}: PageActionsProps) {
  const inActionsProvider = useInResponsiveActionsProvider()
  const isMobile = useIsMobile()
  if (inActionsProvider && isMobile) return null

  return (
    <div className="flex items-center gap-3">
      {showCreate && <NewEntryCombo />}
      <SyncActivityIndicators />
      <CastButtonRpc />
    </div>
  )
}
