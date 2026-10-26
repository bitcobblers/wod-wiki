/**
 * Redirect components for the few path families that still re-address —
 * mounted directly in the App route table. The ticket-09 URL scheme removed
 * the legacy-alias redirect matrix (and its components) entirely: retired
 * concept paths (/c/*, /collections, /catalogs, /p/*, /e/*, /d/*,
 * /notes/:noteId, /journal/:identity, /feed, /dashboard, /analytics*)
 * 404 instead of redirecting. URL builders live in ./routes.
 */
import { Navigate, useParams, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { runPath, sessionDetailPath } from './routes'

/** Redirect /results/segments → /sessions with the segments query pre-filled. */
export function SegmentsRedirect(): ReactNode {
  return <Navigate to={`/sessions?q=${encodeURIComponent(':segment{} last 8w')}`} replace />
}

/** Redirect /tracker/:runtimeId → /run/:runtimeId */
export function TrackerRedirect(): ReactNode {
  const { runtimeId } = useParams<{ runtimeId: string }>()
  return <Navigate to={runPath(runtimeId!)} replace />
}

/**
 * Retired review routes (#946, Ticket 005): dedicated execution telemetry routes
 * live on `/sessions` (list) and `/results/:sessionId` (detail). Bookmarks land
 * directly on `/results/:sessionId` (or note-scoped `/sessions?q=...`):
 *   /review/:runtimeId                              → /results/:runtimeId
 *   /note/:noteId/review/:sectionId/:resultId       → /results/:resultId
 *   /note/:noteId/review[/…]                        → /sessions?q=:session{note:…}
 */
export function ReviewRedirect(): ReactNode {
  const { runtimeId, noteId, resultId } = useParams<{
    runtimeId?: string
    noteId?: string
    sectionId?: string
    resultId?: string
  }>()
  const scope = resultId ?? runtimeId
  if (scope) {
    return <Navigate to={sessionDetailPath(scope)} replace />
  }
  if (noteId) {
    return <Navigate to={`/sessions?q=${encodeURIComponent(`:session{note:${noteId}}`)}`} replace />
  }
  return <Navigate to="/sessions" replace />
}

/** Redirect /plan → /journal?mode=plan, preserving any caller-supplied query string. */
export function PlanRedirect(): ReactNode {
  const search = useLocation().search
  // The plan-mode param is appended last; any caller `?zip=...` is preserved.
  const suffix = search && search.startsWith('?') ? `${search}&mode=plan` : '?mode=plan'
  return <Navigate to={`/journal${suffix}`} replace />
}
