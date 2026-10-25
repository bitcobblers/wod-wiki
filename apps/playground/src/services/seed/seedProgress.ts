import type { SeedSyncProgress } from './seedSync'

interface SeedProgressLabelEvent {
  phase: SeedSyncProgress['phase']
  chunkId?: string | null
}

/** Human-readable label shared by the boot gate and manual seed sync UI. */
export function seedProgressLabel(event: SeedProgressLabelEvent): string {
  switch (event.phase) {
    case 'checking': return 'Checking the seed…'
    case 'fetching': return `Downloading ${event.chunkId ?? 'notebook'}…`
    case 'applying': return `Importing ${event.chunkId ?? 'notebook'}…`
    case 'committed': return `Committed ${event.chunkId ?? 'notebook'}`
    case 'finalizing': return 'Finalizing checkpoints…'
    case 'finished': return 'Done'
    default: {
      const exhaustive: never = event.phase
      return exhaustive
    }
  }
}

/** Record/notebook counts for the active import phase, when it has any. */
export function seedProgressDetail(progress: SeedSyncProgress | null): string | null {
  if (!progress || progress.phase === 'checking' || progress.phase === 'finished') return null
  const parts: string[] = []
  if (typeof progress.completedRecords === 'number' && typeof progress.totalRecords === 'number') {
    parts.push(`${progress.completedRecords} / ${progress.totalRecords} records`)
  }
  if (progress.totalChunks > 0) {
    parts.push(`${progress.completedChunks} / ${progress.totalChunks} notebooks`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}
