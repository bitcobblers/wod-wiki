/**
 * App root — providers, the browser router, and the route table. Page
 * rendering lives in AppContent; per-route classification in
 * lib/routeView (see docs/adr/app-route-view.md).
 */
import { useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7'
import { ThemeProvider } from '@/contexts/ThemeProvider'
import { DebugModeProvider } from '@/contexts/DebugModeContext'
import { AudioProvider } from '@/contexts/AudioContext'
import { EffortRegistryProvider } from './contexts/EffortRegistryContext'
import { EquipmentRegistryProvider } from './contexts/EquipmentRegistryContext'
import { Button, WodOverlayHost } from '@bitcobblers/wod-wiki-ui/primitives'
import { NavProvider, useNav } from './nav/NavContext'
import { buildAppNavTree } from './nav/appNavTree'
import { recordRecentVisit } from './nav/panels/ConditionsNavPanel'
import { useCanvasRoutes } from './canvas/canvasRoutes'
import { AppRoutes } from './AppRoutes'
import { DocumentTitleSync } from './lib/DocumentTitleSync'
import { useZipProcessor } from './hooks/useZipProcessor'
import { useJournalZipProcessor } from './hooks/useJournalZipProcessor'
import { isFeedImportEnabled, runFeedSync } from '@/services/feed/feedSync'
import { startFeedBootstrap, useFeedReadiness, useFeedSyncProgress } from '@/services/feed/feedReadiness'
import { feedProgressDetail, feedProgressLabel } from '@/services/feed/feedProgress'
import { profileService } from '@/services/storage'
import { initSeedContentBroadcast, invalidateSeedContent } from '@/services/content/seedContent'
import { loadTagIndex } from '@/services/tags/tagCatalogue'
import { startFieldCatalogBackfill } from './services/fieldCatalog'
import type { WorkoutItem } from './lib/workoutIndex'
import { AgentConfirmHost } from './agent/AgentConfirmHost'
import { AgentStateScript } from './agent/AgentStateScript'
import { PlaygroundAgentProvider } from './agent/PlaygroundAgentProvider'

export type { WorkoutItem }

// ---------------------------------------------------------------------------
// ScrollToTop — reset scroll position on route change; honor hash anchors
// when they resolve to an element id (used by construct lookup links).
// ---------------------------------------------------------------------------

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const { scrollToSection } = useNav()

  useLayoutEffect(() => {
    recordRecentVisit(pathname)
    if (hash) {
      const targetId = hash.slice(1)
      scrollToSection(targetId)
      const timer = setTimeout(() => {
        scrollToSection(targetId)
      }, 50)
      return () => clearTimeout(timer)
    }
    window.scrollTo(0, 0)
    // Only run on location change (pathname or hash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, hash])
  return null
}

// Global bootstrap — zip-intake hooks and the default-on feed import
// (docs/prototypes/seed-data-unification.md); the import broadcast refreshes
// every seed-content consumer. Opt out with
// localStorage['wodwiki.seedImport.enabled'] = '0'.
function GlobalState() {
  useZipProcessor()
  useJournalZipProcessor()
  useEffect(() => {
    // Profile first: rows written by the seed sync onward get stamped with
    // the membership id (best-effort — unstamped until current() resolves).
    void profileService.current().catch(console.error)
    // Cross-tab corpus refresh (idempotent). The boot orchestrator owns
    // subscription migration + the readiness gate: first visit gates until
    // the core canvas chunk commits; a returning browser ungates
    // immediately and refreshes subscribed feeds in the background.
    initSeedContentBroadcast()
    void startFeedBootstrap()
    // The tag catalogue: every surface that resolves a `#slug` reference
    // (the editor, the parser, the runtime) reads it from one cache, so it
    // is loaded once here — for the whole app, not just the workbench.
    void loadTagIndex().catch(() => { /* Tags are optional — a document without them still runs. */ })
    void startFieldCatalogBackfill().catch(() => { /* Field catalog backfill is best-effort. */ })
  }, [])
  return null
}

// Corpus gate for deep links that have no explicit route yet: while
// corpus route table is empty, show loading or a recoverable error. Home
// is explicitly routed below and never passes through this gate.
function RootUnavailable({ settling }: { settling: boolean }) {
  const progress = useFeedSyncProgress()
  if (settling) {
    const detail = feedProgressDetail(progress)
    return (
      <div role="status" className="flex min-h-dvh flex-col items-center justify-center gap-2 text-muted-foreground">
        <span>{progress ? feedProgressLabel(progress) : 'Loading library…'}</span>
        {detail && <span className="text-xs" data-testid="boot-progress-detail">{detail}</span>}
      </div>
    )
  }
  return (
    <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-semibold">The library's routed content failed to load.</p>
      <p className="max-w-md text-xs text-muted-foreground">
        The feed corpus has not supplied this page. Re-running the feed import usually restores it.
      </p>
      <Button
        variant="outline"
        size="sm"
        data-testid="root-refeed"
        onClick={() => {
          void runFeedSync().then(() => invalidateSeedContent())
        }}
      >
        Re-import library
      </Button>
    </div>
  )
}

export function App() {
  // Stable ref so AppContent can inject its openSearchPalette callback after mount.
  const searchHandlerRef = useRef<() => void>(() => {})
  // Canvas routes hydrate from the imported corpus; the nav tree and the
  // dynamic <Route> table re-derive when the feed lands or refreshes.
  const canvasRouteList = useCanvasRoutes()
  const feedReadiness = useFeedReadiness()
  const navTree = useMemo(
    () => buildAppNavTree(() => searchHandlerRef.current(), canvasRouteList),
    [canvasRouteList],
  )

  return (
    <ThemeProvider defaultTheme="system" storageKey="wod-wiki-playground-theme">
      <DebugModeProvider>
        <EffortRegistryProvider>
        <EquipmentRegistryProvider>
          <AudioProvider>
            <BrowserRouter>
              <NuqsAdapter>
              <GlobalState />
              <WodOverlayHost />
              <NavProvider tree={navTree}>
                <ScrollToTop />
                <PlaygroundAgentProvider />
                <AgentConfirmHost />
                <AgentStateScript />
                <AppRoutes
                  searchHandlerRef={searchHandlerRef}
                  canvasRouteList={canvasRouteList}
                  rootUnavailable={
                    canvasRouteList.length === 0 ? (
                      <RootUnavailable
                        settling={
                          feedReadiness === 'preparing' ||
                          (isFeedImportEnabled() && feedReadiness !== 'error')
                        }
                      />
                    ) : undefined
                  }
                  pageSettlingFallback={
                    canvasRouteList.length === 0 &&
                    (feedReadiness === 'preparing' ||
                      (isFeedImportEnabled() && feedReadiness !== 'error')) ? (
                      <RootUnavailable settling />
                    ) : undefined
                  }
                />
                <DocumentTitleSync />
              </NavProvider>
            </NuqsAdapter>
          </BrowserRouter>
        </AudioProvider>
        </EquipmentRegistryProvider>
      </EffortRegistryProvider>
      </DebugModeProvider>
    </ThemeProvider>
  )
}

export default App


