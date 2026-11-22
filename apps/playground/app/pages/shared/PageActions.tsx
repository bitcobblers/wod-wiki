/**
 * PageActions — shared sticky header chrome.
 *
 * Keeps sticky headers calm and non-overlapping: passive SyncActivityIndicators
 * and Chromecast (CastButtonRpc) only. StickyPageHeader automatically mounts
 * `<2xl` L3DrawerTrigger ("Page options") whenever the L3 panel has content.
 * Standalone S3/page actions and creation buttons live in L3 grouped Actions,
 * stream View popovers, or L2 footers — never beside Cast in StickyPageHeader.
 */

import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc'
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { PageMode } from '@/types/content-type'

import { useIsMobile } from '../../hooks/useIsMobile'
import { useInResponsiveActionsProvider } from '../../nav/ResponsiveActions'
import { SyncActivityIndicators } from '../../nav/SyncActivityUi'

export interface PageActionsProps {
  /** Current page mode retained for route call-site typing. */
  mode?: PageMode
  /** Retained for call-site compatibility. */
  currentWorkout?: { name: string; content: string }
  /** Retained for call-site compatibility. */
  index?: PageNavLink[]
  /** Retained for call-site compatibility; standalone creation moved out of sticky headers. */
  showCreate?: boolean
}

export function PageActions(_props: PageActionsProps) {
  const inActionsProvider = useInResponsiveActionsProvider()
  const isMobile = useIsMobile()
  if (inActionsProvider && isMobile) return null

  return (
    <div className="flex items-center gap-3">
      <SyncActivityIndicators />
      <CastButtonRpc />
    </div>
  )
}
