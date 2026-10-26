/**
 * SyncActivityUi — header indicators + completion toasts for the shared
 * sync activity bus (src/services/syncActivity.ts).
 *
 * SyncActivityIndicators renders small upload/download spinners in the app
 * header while syncs run; counts simultaneous activities and honors
 * prefers-reduced-motion (motion-safe:animate-spin).
 *
 * SyncActivityNotifier is the single mounted observer that turns reported
 * results into one toast per result (committed new-record count + catalog
 * link) and reported errors into a safe toast linking settings. Module-level
 * last-seen guards make it StrictMode/remount safe — never a repeated toast.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Upload } from 'lucide-react'
import {
  getSyncActivity,
  subscribeSyncActivity,
  type SyncActivitySnapshot,
  type SyncProgressItem,
} from '@/services/syncActivity'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/atoms/primitives/toast'
import { ROUTE_PATTERNS } from '../lib/routes'
import { getFeedUpdates, subscribeFeedUpdates } from '@/services/feed/feedSync'

function activityLabel(direction: 'upload' | 'download', count: number, label: string | null, progress?: SyncProgressItem | null): string {
  const noun = direction === 'upload' ? 'Uploading' : 'Downloading'
  const target = label ?? 'data'
  const detail = progress?.chunkId ? ` - ${progress.chunkId} (${progress.phase})` : ''
  return count > 1 ? `${noun} ${target} (${count} syncs)${detail}` : `${noun} ${target}${detail}`
}

export function SyncActivityIndicators() {
  const activity = useSyncExternalStore(subscribeSyncActivity, getSyncActivity)
  if (activity.uploading === 0 && activity.downloading === 0) return null
  return (
    <div
      role="status"
      data-testid="sync-activity-indicators"
      className="flex items-center gap-1 text-muted-foreground"
    >
      {activity.downloading > 0 && (
        <span
          className="flex items-center gap-1"
          aria-label={activityLabel('download', activity.downloading, activity.label, activity.activeProgress)}
          title={activityLabel('download', activity.downloading, activity.label, activity.activeProgress)}
        >
          <Download className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          {activity.downloading > 1 && (
            <span className="text-[10px] tabular-nums">{activity.downloading}</span>
          )}
        </span>
      )}
      {activity.uploading > 0 && (
        <span
          className="flex items-center gap-1"
          aria-label={activityLabel('upload', activity.uploading, activity.label)}
          title={activityLabel('upload', activity.uploading, activity.label)}
        >
          <Upload className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          {activity.uploading > 1 && (
            <span className="text-[10px] tabular-nums">{activity.uploading}</span>
          )}
        </span>
      )}
      {activity.activeProgress && (
        <span
          data-testid="sync-granular-progress"
          className="text-[11px] font-mono text-muted-foreground truncate max-w-[160px] hidden sm:inline"
          title={`${activity.activeProgress.sourceLabel}: ${activity.activeProgress.phase} ${activity.activeProgress.chunkId ?? ''}`}
        >
          {activity.activeProgress.chunkId}
          {activity.activeProgress.totalRecords !== undefined && activity.activeProgress.completedRecords !== undefined && (
            ` (${activity.activeProgress.completedRecords + 1}/${activity.activeProgress.totalRecords})`
          )}
        </span>
      )}
    </div>
  )
}

// Module-level guards: a result/error is toasted exactly once no matter how
// many times the observer remounts (StrictMode, route changes).
let lastSeenResultId = 0
let lastSeenError: string | null = null
let lastSeenFeedUpdateId = 0

function notifyResult(result: NonNullable<SyncActivitySnapshot['result']>, navigate: (to: string) => void): void {
  const parts: string[] = []
  if (result.added > 0) parts.push(`${result.added.toLocaleString()} new ${result.added === 1 ? 'record' : 'records'}`)
  if (result.updated > 0) parts.push(`${result.updated.toLocaleString()} updated`)
  toast({
    title: `${result.source} sync complete`,
    description: parts.length > 0
      ? `${parts.join(', ')} — feeds can be refreshed anytime.`
      : 'Nothing new — feeds can be refreshed anytime.',
    action: (
      <ToastAction altText="Open notebooks" onClick={() => navigate('/notebooks')}>
        Open notebooks
      </ToastAction>
    ),
  })
}

export function SyncActivityNotifier() {
  const navigate = useNavigate()
  useEffect(() => {
    const check = () => {
      const snapshot = getFeedUpdates()
      if (!snapshot || snapshot.id <= lastSeenFeedUpdateId) return
      lastSeenFeedUpdateId = snapshot.id
      if (!snapshot.updates.length) return
      toast({
        title: 'Notebook updates',
        description: snapshot.updates.map(update => `${update.label}: ${update.state === 'updated' ? 'updated' : update.state === 'error' ? 'sync failed' : 'update available'}`).join('; '),
        action: <ToastAction altText="Manage notebook updates" onClick={() => navigate(`${ROUTE_PATTERNS.notebooks}?manage=1`)}>Review updates</ToastAction>,
      })
    }
    check()
    return subscribeFeedUpdates(check)
  }, [navigate])
  useEffect(() => {
    const check = (activity: SyncActivitySnapshot) => {
      if (!activity.error) lastSeenError = null;
      if (activity.result && activity.result.id > lastSeenResultId) {
        lastSeenResultId = activity.result.id
        notifyResult(activity.result, navigate)
      }
      if (activity.error && activity.error !== lastSeenError) {
        lastSeenError = activity.error
        // Keep sync errors actionable without sending database failures to feeds.
        const message = activity.error.toLowerCase()
        const settingsPath = /turso|database|token|libsql/.test(message)
          ? ROUTE_PATTERNS.settingsStorage
          : /seed|feed|source|manifest|chunk/.test(message)
            ? ROUTE_PATTERNS.settingsSync
            : ROUTE_PATTERNS.settings
        toast({
          title: 'Sync failed',
          description: activity.error,
          variant: 'destructive',
          action: (
            <ToastAction altText="Open settings" onClick={() => navigate(settingsPath)}>
              Settings
            </ToastAction>
          ),
        })
      }
    }
    check(getSyncActivity())
    return subscribeSyncActivity(() => check(getSyncActivity()))
  }, [navigate])
  return null
}
