/**
 * PageActions — unified page-level action bar.
 *
 * Replaces NotePageActions and PlaygroundNoteActions with a single
 * mode-driven component. Desktop pages receive [New ▾, Cast, …]; phones
 * retain their existing dock and navbar ownership.
 *
 * See docs/navbar-wodblock-actions-assessment-2026-05-08.md §4 Candidate 2.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowPathIcon, PlusIcon } from '@heroicons/react/20/solid'

import { CastButtonRpc } from '@/components/organisms/cast/CastButtonRpc'
import { Button } from '@/components/atoms/primitives/button'
import { ButtonGroup } from '@/components/molecules/ButtonGroup'
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'
import type { PageMode } from '@/types/content-type'

import { ActionsMenu } from './PageToolbar'
import { NewEntryCombo } from './NewEntryCombo'
import { mapIndexToL3 } from './pageUtils'
import { DEFAULT_PLAYGROUND_CONTENT } from '../../templates/defaultPlaygroundContent'
import { createPlaygroundPage } from '../../services/createPlaygroundPage'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useInResponsiveActionsProvider } from '../../nav/ResponsiveActions'
import { SyncActivityIndicators } from '../../nav/SyncActivityUi'

export interface PageActionsProps {
  /** Current page mode — controls which extras are shown. */
  mode: PageMode
  /** Used by ActionsMenu for download filename and download content. */
  currentWorkout: { name: string; content: string }
  /** Page index — shown in the ActionsMenu "On this page" section. */
  index: PageNavLink[]
  /**
   * Playground-only: resets the current page to its default template.
   * Required when mode === 'playground'.
   */
  onReset?: () => Promise<void> | void
}

export function PageActions({
  mode,
  currentWorkout,
  index,
  onReset,
}: PageActionsProps) {
  const navigate = useNavigate()
  const [isCreating, setIsCreating] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const inActionsProvider = useInResponsiveActionsProvider()
  const isMobile = useIsMobile()
  // Inside the app shell on phones the dock owns search (FAB) and the app
  // navbar owns cast + page options — rendering them here too would
  // duplicate mounted controls. Standalone (stories/tests) and desktop keep
  // the bar.
  const dockOwnsGeneric = inActionsProvider && isMobile

  const handleCreateNew = async () => {
    if (isCreating) return
    setIsCreating(true)
    try {
      const pageId = await createPlaygroundPage(DEFAULT_PLAYGROUND_CONTENT.content)
      navigate(`/playground/${encodeURIComponent(pageId)}`)
    } finally {
      setIsCreating(false)
    }
  }

  const handleReset = async () => {
    if (!onReset || isResetting) return
    setIsResetting(true)
    try {
      await onReset()
    } finally {
      setIsResetting(false)
    }
  }

  // Playground mode contributes its New | Reset group to the phone dock;
  // desktop uses the shared New combo and a separate Reset action.
  if (dockOwnsGeneric && mode !== 'playground') return null

  return (
    <div className="flex items-center gap-3">
      {mode === 'playground' && dockOwnsGeneric && (
        <ButtonGroup
          primary={{
            id: 'new-playground',
            label: isCreating ? 'Creating…' : 'New',
            icon: PlusIcon,
            action: { type: 'call', handler: handleCreateNew },
          }}
          secondary={{
            id: 'reset-playground',
            label: isResetting ? 'Resetting…' : 'Reset to default',
            icon: ArrowPathIcon,
            action: { type: 'call', handler: handleReset },
          }}
          size="sm"
        />
      )}

      {!dockOwnsGeneric && <NewEntryCombo />}
      {!dockOwnsGeneric && mode === 'playground' && (
        <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => void handleReset()}>
          <ArrowPathIcon className="size-3.5" />
          {isResetting ? 'Resetting…' : 'Reset to default'}
        </Button>
      )}
      {!dockOwnsGeneric && <SyncActivityIndicators />}
      {!dockOwnsGeneric && <CastButtonRpc />}
      {!dockOwnsGeneric && (
        <ActionsMenu currentWorkout={currentWorkout} items={index && index.length > 0 ? mapIndexToL3(index) : undefined} />
      )}
    </div>
  )
}
