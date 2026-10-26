import { describe, expect, it } from 'bun:test'

import { feedProgressDetail, feedProgressLabel } from './feedProgress'
import type { FeedSyncProgress } from './feedSync'

describe('feedProgressLabel', () => {
  it('describes the live seed phase and notebook', () => {
    expect(feedProgressLabel({ phase: 'checking' })).toBe('Checking the seed…')
    expect(feedProgressLabel({ phase: 'fetching', chunkId: 'canvas' })).toBe('Downloading canvas…')
    expect(feedProgressLabel({ phase: 'applying', chunkId: 'efforts' })).toBe('Importing efforts…')
    expect(feedProgressLabel({ phase: 'committed', chunkId: 'canvas' })).toBe('Committed canvas')
    expect(feedProgressLabel({ phase: 'finalizing' })).toBe('Finalizing checkpoints…')
    expect(feedProgressLabel({ phase: 'finished' })).toBe('Done')
  })

  it('reports record and notebook counts only for active import phases', () => {
    const progress = {
      sourceId: 'core',
      sourceLabel: 'Core library',
      sourceIndex: 1,
      totalSources: 1,
      phase: 'applying',
      chunkId: 'canvas',
      completedChunks: 1,
      totalChunks: 5,
      totalNotes: 2,
      totalEfforts: 0,
      totalEquipment: 0,
      totalBlocks: 2,
      skippedUserOwned: 0,
      deleted: 0,
      addedNotes: 2,
      updatedNotes: 0,
      completedRecords: 4,
      totalRecords: 10,
    } satisfies FeedSyncProgress

    expect(feedProgressDetail(progress)).toBe('4 / 10 records · 1 / 5 notebooks')
    expect(feedProgressDetail({
      sourceId: 'core',
      sourceLabel: 'Core library',
      sourceIndex: 1,
      totalSources: 1,
      phase: 'checking',
    })).toBeNull()
  })
})
