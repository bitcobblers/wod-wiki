import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { BOOT_MARKS, markBootMilestone, resetBootDiagnosticsForTest } from './bootDiagnostics'

describe('boot diagnostics', () => {
  beforeEach(() => resetBootDiagnosticsForTest())
  afterEach(() => resetBootDiagnosticsForTest())

  it('records a performance mark and mirrors its timestamp onto the document', () => {
    markBootMilestone('seedStart')

    expect(performance.getEntriesByName(BOOT_MARKS.seedStart, 'mark')).toHaveLength(1)
    expect(document.documentElement.dataset.bootSeedStart).toBeDefined()
  })

  it('records each milestone once per page load', () => {
    markBootMilestone('homeFirstPaint')
    markBootMilestone('homeFirstPaint')
    markBootMilestone('corpusReady')
    markBootMilestone('seedSettled')

    expect(performance.getEntriesByName(BOOT_MARKS.homeFirstPaint, 'mark')).toHaveLength(1)
    expect(performance.getEntriesByName(BOOT_MARKS.corpusReady, 'mark')).toHaveLength(1)
    expect(performance.getEntriesByName(BOOT_MARKS.seedSettled, 'mark')).toHaveLength(1)
    expect(document.documentElement.dataset.bootHomeFirstPaint).toBeDefined()
    expect(document.documentElement.dataset.bootCorpusReady).toBeDefined()
    expect(document.documentElement.dataset.bootSeedSettled).toBeDefined()
  })
})
