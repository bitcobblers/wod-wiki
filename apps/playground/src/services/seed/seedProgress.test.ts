import { describe, expect, it } from 'bun:test'

import { seedProgressDetail, seedProgressLabel } from './seedProgress'
import type { SeedSyncProgress } from './seedSync'

describe('seedProgressLabel', () => {
  it('describes the live seed phase and notebook', () => {
    expect(seedProgressLabel({ phase: 'checking' })).toBe('Checking the seed…')
    expect(seedProgressLabel({ phase: 'fetching', chunkId: 'canvas' })).toBe('Downloading canvas…')
    expect(seedProgressLabel({ phase: 'applying', chunkId: 'efforts' })).toBe('Importing efforts…')
    expect(seedProgressLabel({ phase: 'committed', chunkId: 'canvas' })).toBe('Committed canvas')
    expect(seedProgressLabel({ phase: 'finalizing' })).toBe('Finalizing checkpoints…')
    expect(seedProgressLabel({ phase: 'finished' })).toBe('Done')
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
    } satisfies SeedSyncProgress

    expect(seedProgressDetail(progress)).toBe('4 / 10 records · 1 / 5 notebooks')
    expect(seedProgressDetail({
      sourceId: 'core',
      sourceLabel: 'Core library',
      sourceIndex: 1,
      totalSources: 1,
      phase: 'checking',
    })).toBeNull()
  })
})
