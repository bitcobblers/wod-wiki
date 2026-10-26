/**
 * syncActivity — the shared bus contract both reporters (storage worker,
 * feed sync) and consumers (header indicators, toast observer) rely on:
 * concurrent counting, idempotent end, unique result ids, stable snapshots.
 */
import { describe, expect, it } from 'bun:test'
import {
  beginSyncActivity,
  getSyncActivity,
  reportSyncError,
  reportSyncResult,
  reportSyncProgress,
  subscribeSyncActivity,
} from './syncActivity'

describe('syncActivity', () => {
  it('counts concurrent activities per direction and ends idempotently', () => {
    const endA = beginSyncActivity('upload', 'backup')
    const endB = beginSyncActivity('upload', 'backup')
    const endC = beginSyncActivity('download', 'community')
    expect(getSyncActivity()).toMatchObject({ uploading: 2, downloading: 1, label: 'community' })

    endA()
    endA() // second call is a no-op
    expect(getSyncActivity().uploading).toBe(1)
    endB()
    endC()
    expect(getSyncActivity()).toMatchObject({ uploading: 0, downloading: 0, label: null })
  })

  it('returns a stable snapshot until the next mutation', () => {
    const before = getSyncActivity()
    expect(getSyncActivity()).toBe(before)
    const end = beginSyncActivity('download', 'core')
    expect(getSyncActivity()).not.toBe(before)
    end()
  })

  it('notifies subscribers on mutations and unsubscribes cleanly', () => {
    let calls = 0
    const unsubscribe = subscribeSyncActivity(() => {
      calls += 1
    })
    const end = beginSyncActivity('upload', 'backup')
    end()
    expect(calls).toBe(2)
    unsubscribe()
    const end2 = beginSyncActivity('upload', 'backup')
    end2()
    expect(calls).toBe(2)
  })

  it('stamps each result with a unique, monotonic id', () => {
    reportSyncResult({ source: 'Community', added: 12, updated: 3 })
    const first = getSyncActivity().result!
    reportSyncResult({ source: 'Core', added: 0, updated: 0 })
    const second = getSyncActivity().result!
    expect(second.id).toBeGreaterThan(first.id)
    expect(first).toMatchObject({ source: 'Community', added: 12, updated: 3 })
  })

  it('surfaces safe error text without touching activity counts', () => {
    const end = beginSyncActivity('download', 'community')
    reportSyncError('Network unreachable')
    const activity = getSyncActivity()
    expect(activity.error).toBe('Network unreachable')
    expect(activity.downloading).toBe(1)
    end()
  })

  it('the label follows the most recent still-active task and clears when none remain', () => {
    const endCore = beginSyncActivity('download', 'core')
    const endFeed = beginSyncActivity('download', 'community-crossfit-programming')
    expect(getSyncActivity().label).toBe('community-crossfit-programming')
    endFeed() // the finished task's name must not linger
    expect(getSyncActivity().label).toBe('core')
    endCore()
    expect(getSyncActivity().label).toBeNull()
  })

  it('a successful result clears a stale error', () => {
    reportSyncError('Network unreachable')
    expect(getSyncActivity().error).toBe('Network unreachable')
    reportSyncResult({ source: 'Core', added: 2, updated: 0 })
    expect(getSyncActivity().error).toBeNull()
    expect(getSyncActivity().result).toMatchObject({ source: 'Core', added: 2 })
  })

  it('tracks granular progress of background sync and clears it', () => {
    reportSyncProgress({
      sourceId: 'feed-1',
      sourceLabel: 'Feed One',
      chunkId: 'notebook.heroes',
      recordId: 'rec-1',
      completedRecords: 2,
      totalRecords: 10,
      phase: 'fetching',
    })
    expect(getSyncActivity().activeProgress).toMatchObject({
      sourceId: 'feed-1',
      chunkId: 'notebook.heroes',
      completedRecords: 2,
      totalRecords: 10,
      phase: 'fetching',
    })
    reportSyncProgress(null)
    expect(getSyncActivity().activeProgress).toBeNull()
  })
})
