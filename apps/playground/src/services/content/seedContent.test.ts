import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test loading boundary: preserve the real storage module and replace only
// the corpus read that drives this test's empty → imported transition.
const realStorage = await import('@/services/storage')
let entries: Array<{ path: string; raw: string }> = []
mock.module('@/services/storage', () => ({
  ...realStorage,
  storageService: {
    ...realStorage.storageService,
    getSeedContent: async () => entries,
  },
}))

import { BOOT_MARKS, resetBootDiagnosticsForTest } from '../bootDiagnostics'
import { ensureSeedContent, invalidateSeedContent } from './seedContent'

describe('seedContent corpus readiness', () => {
  beforeEach(() => {
    entries = []
    resetBootDiagnosticsForTest()
  })
  afterEach(() => resetBootDiagnosticsForTest())

  it('does not consume the corpus-ready mark on an empty pre-import read', async () => {
    await ensureSeedContent()
    expect(performance.getEntriesByName(BOOT_MARKS.corpusReady, 'mark')).toHaveLength(0)

    entries = [{ path: 'markdown/canvas/guide/start.md', raw: '# First Workout' }]
    invalidateSeedContent()
    await ensureSeedContent()
    expect(performance.getEntriesByName(BOOT_MARKS.corpusReady, 'mark')).toHaveLength(1)
  })
})
