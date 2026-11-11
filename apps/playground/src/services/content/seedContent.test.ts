import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { InMemoryStorage, resetStorageForTesting, setStorageForTesting, storageService } from '@/services/storage'
import { BOOT_MARKS, resetBootDiagnosticsForTest } from '../bootDiagnostics'
import { ensureSeedContent, invalidateSeedContent } from './seedContent'

describe('seedContent corpus readiness', () => {
  let entries: Array<{ path: string; raw: string }> = []

  beforeEach(() => {
    entries = []
    // In-memory backend plus a spy on the corpus read that drives this
    // test's empty → imported transition. No module mocking needed.
    setStorageForTesting(new InMemoryStorage())
    spyOn(storageService, 'getSeedContent').mockImplementation(async () => entries)
    resetBootDiagnosticsForTest()
  })
  afterEach(() => {
    mock.restore()
    resetStorageForTesting()
    resetBootDiagnosticsForTest()
  })

  it('does not consume the corpus-ready mark on an empty pre-import read', async () => {
    await ensureSeedContent()
    expect(performance.getEntriesByName(BOOT_MARKS.corpusReady, 'mark')).toHaveLength(0)

    entries = [{ path: 'markdown/canvas/guide/start.md', raw: '# First Workout' }]
    invalidateSeedContent()
    await ensureSeedContent()
    expect(performance.getEntriesByName(BOOT_MARKS.corpusReady, 'mark')).toHaveLength(1)
  })
})
