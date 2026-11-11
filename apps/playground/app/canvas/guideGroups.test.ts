// @vitest-environment node
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'

import { parseCanvasMarkdown } from './parseCanvasMarkdown'
import { groupGuideSections, guideStages } from './guideGroups'
import { resolveScrollStage } from './scrollRunway'

/**
 * Guide runway grouping — regression around group activation and content
 * ownership: every parsed content section of the eight live /guide/* pages
 * must survive grouping exactly once (staged runs + static tail), the Try-it
 * section stays the final stage of the last run (its buttons act on the
 * host-owned panel), the reference stays accessible static flow, and
 * each group's stage machine resolves scroll progress back to the section
 * that owns it (the host swaps panel content from this mapping).
 */

const GUIDE_DIR = new URL('../../../../markdown/canvas/guide/', import.meta.url)

function guideFiles(): string[] {
  return readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
}

describe('guide runway grouping', () => {
  for (const file of guideFiles()) {
    it(`groups ${file} losslessly with correct activation mapping`, () => {
      const raw = readFileSync(new URL(file, GUIDE_DIR), 'utf8')
      const page = parseCanvasMarkdown(raw, `/guide/${file.replace(/\.md$/, '')}`)
      expect(page).not.toBeNull()
      const content = page!.sections.slice(1) // drop the hero

      const { groups, tail } = groupGuideSections(content, file.replace(/\.md$/, ''))

      // Lossless: staged ∪ tail == content sections, each id exactly once.
      const stagedIds = groups.flat().map((s) => s.id)
      const all = [...stagedIds, ...tail.map((s) => s.id)]
      expect(all.sort()).toEqual(content.map((s) => s.id).sort())
      expect(new Set(all).size).toBe(all.length)

      // Small runs: 2-4 stages per group on every live guide.
      for (const group of groups) {
        expect(group.length).toBeGreaterThanOrEqual(2)
        expect(group.length).toBeLessThanOrEqual(4)
      }

      // Try-it remains the final stage of the last run (its Run/source
      // buttons act on the panel beside it).
      const lastGroup = groups[groups.length - 1]
      expect(lastGroup[lastGroup.length - 1].id).toBe('try-it')

      // Terminal meta sections stay static and accessible (the reference on
      // start; the old What's Next block is gone — GuideIndexFooter carries
      // next-chapter navigation now).
      const tailIds = tail.map((s) => s.id)
      if (content.some((s) => s.id === 'reference')) expect(tailIds).toContain('reference')

      // Group activation: each group's stage machine maps progress back to
      // the owning section — mid-stage resolves to that stage, and just
      // below a boundary falls back to the previous stage (backward
      // restoration depends on this staying pure and ordered).
      for (const group of groups) {
        const stages = guideStages(group)
        const n = group.length
        for (let i = 0; i < n; i++) {
          const mid = resolveScrollStage((i + 0.5) / n, stages)
          expect(mid.stage.id).toBe(group[i].id)
          if (i > 0) {
            const below = resolveScrollStage(i / n - 1e-6, stages)
            expect(below.stage.id).toBe(group[i - 1].id)
          }
        }
      }
    })
  }
})
