import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'

import { parseCanvasMarkdown, type ParsedCanvasPage } from './parseCanvasMarkdown'

/**
 * Guide route governance — the consolidated eight-chapter learning guide
 * (markdown/canvas/guide/**) is the only routed learning surface. Locks the
 * cutover: every chapter declares its /guide/<slug> route, the eight routes
 * are unique and complete, and the eighteen retired syntax/behaviors/analytics
 * routes never reappear in the seeded corpus.
 */

const GUIDE_DIR = new URL('../../../../markdown/canvas/guide/', import.meta.url)

const EXPECTED_ROUTES = [
  '/page/guide-start',
  '/page/guide-protocols',
  '/page/guide-structure',
  '/page/guide-metrics',
  '/page/guide-clock',
  '/page/guide-wql',
  '/page/guide-dashboards',
  '/page/guide-sessions',
] as const

/** The retired routed learning pages (deleted in the 2026-10 cutover). */
const RETIRED_ROUTES = [
  '/guide/syntax',
  '/guide/syntax/basics',
  '/guide/syntax/protocols',
  '/guide/syntax/structure',
  '/guide/syntax/custom-metrics',
  '/guide/syntax/dialects',
  '/guide/syntax/complex',
  '/guide/syntax/cheatsheet',
  '/guide/behaviors',
  '/guide/behaviors/timers',
  '/guide/behaviors/rounds',
  '/guide/behaviors/capture',
  '/guide/analytics',
  '/guide/analytics/anatomy',
  '/guide/analytics/cheatsheet',
  '/guide/analytics/cookbook',
  '/guide/analytics/filters',
  '/guide/analytics/joins',
]

function loadGuidePages(): Array<{ file: string; page: ParsedCanvasPage }> {
  return readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((file) => {
      const raw = readFileSync(new URL(file, GUIDE_DIR), 'utf8')
      const page = parseCanvasMarkdown(raw)
      return { file, page: page as ParsedCanvasPage }
    })
}

describe('guide route governance', () => {
  const pages = loadGuidePages()

  it('ships exactly the eight consolidated chapters', () => {
    expect(pages.length).toBe(8)
    expect(pages.map((p) => p.page?.route).sort()).toEqual([...EXPECTED_ROUTES].sort())
  })

  it('declares canvas template, guide type, and a runtime page title on every chapter', () => {
    for (const { file, page } of pages) {
      expect(page, `${file} must parse as a canvas page`).not.toBeNull()
      expect(page.template, file).toBe('canvas')
      expect(page.frontmatter.type, file).toBe('guide')
      expect(typeof page.frontmatter.title, `${file} title:`).toBe('string')
    }
  })

  it('wires every editor chapter into the shared gameplay policy (chapter + run quest)', () => {
    const dataChapter: Record<string, true> = { wql: true, dashboards: true } // reading chapters — no editor, no quests
    for (const { file, page } of pages) {
      const slug = file.replace(/\.md$/, '')
      if (dataChapter[slug]) {
        expect(page.quests ?? [], `${file} is a data chapter`).toEqual([])
        continue
      }
      expect(page.chapters?.length ?? 0, `${file} declares a chapter block`).toBeGreaterThan(0)
      expect(
        (page.quests ?? []).some((q) => q.validation?.type === 'run-started'),
        `${file} declares a run quest`,
      ).toBe(true)
    }
  })

  it('keeps the retired syntax/behaviors/analytics routes out of the corpus', () => {
    const routed = new Set(pages.map((p) => p.page?.route))
    for (const retired of RETIRED_ROUTES) {
      expect(routed.has(retired), `${retired} must stay retired`).toBe(false)
    }
  })

  it('cross-links chapters through live routes, not repo-relative file links', () => {
    for (const { file, page } of pages) {
      const prose = page.sections.map((s) => s.prose ?? '').join('\n')
      expect(prose, `${file} links by route`).not.toMatch(/\]\(\.\/\w+\.md/)
    }
  })
})
