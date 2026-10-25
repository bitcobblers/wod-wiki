/** Cold-boot milestones, measured once per page load and visible to e2e traces. */
export const BOOT_MARKS = {
  seedStart: 'seed:start',
  homeFirstPaint: 'home:first-paint',
  corpusReady: 'corpus:ready',
  seedSettled: 'seed:settled',
} as const

export type BootMilestone = keyof typeof BOOT_MARKS

const BOOT_DATASETS = {
  seedStart: 'bootSeedStart',
  homeFirstPaint: 'bootHomeFirstPaint',
  corpusReady: 'bootCorpusReady',
  seedSettled: 'bootSeedSettled',
} as const satisfies Record<BootMilestone, string>

const recorded = new Set<BootMilestone>()

export function markBootMilestone(milestone: BootMilestone): void {
  if (recorded.has(milestone)) return
  recorded.add(milestone)
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  const mark = performance.mark(BOOT_MARKS[milestone])
  if (typeof document !== 'undefined') {
    document.documentElement.dataset[BOOT_DATASETS[milestone]] = mark.startTime.toFixed(3)
  }
}

/** Test-only: clear milestone state and the marks emitted by this module. */
export function resetBootDiagnosticsForTest(): void {
  recorded.clear()
  if (typeof performance !== 'undefined') {
    for (const name of Object.values(BOOT_MARKS)) performance.clearMarks(name)
  }
  if (typeof document !== 'undefined') {
    for (const key of Object.values(BOOT_DATASETS)) {
      delete document.documentElement.dataset[key]
    }
  }
}
