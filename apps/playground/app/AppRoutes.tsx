import { Suspense, type MutableRefObject, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ROUTE_PATTERNS, LEGACY_REDIRECT_PATTERNS } from './lib/routes';
import { AppContent } from './AppContent';
import CalcAuthoringPrototypePage from './pages/CalcAuthoringPrototypePage';
import QueryBlockComposerPrototypePage from './pages/QueryBlockComposerPrototypePage';
import { CalcAuthoringPanel } from '@/components/organisms/calc-authoring/CalcAuthoringPanel';
import { PlaygroundLandingPage } from './pages/PlaygroundLandingPage';
import { SyntaxView } from './views/SyntaxView';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlanRedirect, ReviewRedirect, SegmentsRedirect, TrackerRedirect } from './lib/routeRedirects';
import { PlaygroundRedirect } from './pages/PlaygroundRedirect';
import { SubscribePage } from './pages/SubscribePage';
import { WallClockPage } from './pages/WallClockPage';
import { LoadZipPage } from './pages/LoadZipPage';
import { JournalZipLoadPage } from './pages/JournalZipLoadPage';
import type { CanvasRoute } from './canvas/canvasRoutes';

export interface AppRoutesProps {
  searchHandlerRef?: MutableRefObject<(() => void) | null>;
  canvasRouteList?: CanvasRoute[];
  rootUnavailable?: ReactNode;
  pageSettlingFallback?: ReactNode;
}

export function AppRoutes({ searchHandlerRef, canvasRouteList = [], rootUnavailable, pageSettlingFallback }: AppRoutesProps) {
  return (
    <Routes>
      <Route path={ROUTE_PATTERNS.home} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route
        path="*"
        element={rootUnavailable ?? <NotFoundPage />}
      />
      <Route path="/proto/calc-authoring" element={<CalcAuthoringPrototypePage />} />
      <Route path="/proto/query-block-composer" element={<QueryBlockComposerPrototypePage />} />

      <Route path="/settings" element={<Navigate to="/settings/appearance" replace />} />
      <Route path="/settings/appearance" element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.settingsProfile} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={LEGACY_REDIRECT_PATTERNS.settingsData} element={<Navigate to={ROUTE_PATTERNS.settingsStorage} replace />} />
      <Route path={LEGACY_REDIRECT_PATTERNS.settingsDatabase} element={<Navigate to={ROUTE_PATTERNS.settingsStorage} replace />} />
      <Route path={ROUTE_PATTERNS.settingsStorage} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.settingsSync} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path="/settings/system" element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={LEGACY_REDIRECT_PATTERNS.settingsQueries} element={<Navigate to={ROUTE_PATTERNS.journal} replace />} />
      <Route path={ROUTE_PATTERNS.settingsTags} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.settingsSoundProfiles} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path="/settings/library/calcs" element={<div className="p-6"><CalcAuthoringPanel /></div>} />
      <Route path="/legacy" element={<PlaygroundLandingPage />} />
      <Route path="/syntax" element={<SyntaxView />} />
      <Route path={ROUTE_PATTERNS.plan} element={<PlanRedirect />} />
      <Route path={ROUTE_PATTERNS.feeds} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.feed} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.notebooks} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.notebook} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.notebookTarget} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.notebookItem} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.subscribe} element={<SubscribePage />} />
      <Route path={ROUTE_PATTERNS.pages} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.page} element={pageSettlingFallback ?? <AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.load} element={<Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-400">Loading…</div>}><LoadZipPage /></Suspense>} />
      <Route path={ROUTE_PATTERNS.loadJournal} element={<Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-400">Loading…</div>}><JournalZipLoadPage /></Suspense>} />
      <Route path={ROUTE_PATTERNS.loadJournalDate} element={<Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-400">Loading…</div>}><JournalZipLoadPage /></Suspense>} />
      <Route path={ROUTE_PATTERNS.playgroundRoot} element={<PlaygroundRedirect />} />
      <Route path={ROUTE_PATTERNS.playground} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.playgrounds} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.notes} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.note} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.journal} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.day} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.run} element={<Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-400">Loading…</div>}><WallClockPage /></Suspense>} />
      <Route path={ROUTE_PATTERNS.tracker} element={<TrackerRedirect />} />
      <Route path="/results/segments" element={<SegmentsRedirect />} />
      <Route path={ROUTE_PATTERNS.sessionDetail} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.sessions} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.sessionDate} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path="/review/:runtimeId" element={<ReviewRedirect />} />
      <Route path="/note/:noteId/review" element={<ReviewRedirect />} />
      <Route path="/note/:noteId/review/:sectionId" element={<ReviewRedirect />} />
      <Route path="/note/:noteId/review/:sectionId/:resultId" element={<ReviewRedirect />} />
      <Route path={ROUTE_PATTERNS.efforts} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.effort} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.equipment} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.equipmentSlug} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.tags} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.tagCategory} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.tag} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.dashboards} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      <Route path={ROUTE_PATTERNS.dashboardView} element={<AppContent searchHandlerRef={searchHandlerRef} />} />
      {canvasRouteList.map(({ route }) => (
        <Route
          key={route}
          path={route}
          element={<AppContent searchHandlerRef={searchHandlerRef} />}
        />
      ))}
    </Routes>
  );
}
