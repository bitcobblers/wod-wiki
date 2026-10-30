/**
 * PageActions — shared header chrome. Creation is explicitly declared by
 * library/collection surfaces; detail pages only receive entity actions,
 * Cast, sync, and page options.
 */

import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc'
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { PageMode } from '@/types/content-type'

import { ActionsMenu } from './PageToolbar'
import { NewEntryCombo } from './NewEntryCombo'
import { mapIndexToL3 } from './pageUtils'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useInResponsiveActionsProvider } from '../../nav/ResponsiveActions'
import { SyncActivityIndicators } from '../../nav/SyncActivityUi'

export interface PageActionsProps {
  /** Current page mode retained for route call-site typing. */
  mode: PageMode
  /** Used by ActionsMenu for download filename and download content. */
  currentWorkout: { name: string; content: string }
  /** Page index — shown in the ActionsMenu "On this page" section. */
  index: PageNavLink[]
  /** Library/collection-only: creates the current surface's entry type. */
  showCreate?: boolean
}

export function PageActions({
  currentWorkout,
  index,
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
      <ActionsMenu currentWorkout={currentWorkout} items={index.length > 0 ? mapIndexToL3(index) : undefined} />
    </div>
  )
}
