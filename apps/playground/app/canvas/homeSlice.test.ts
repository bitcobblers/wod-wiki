import { describe, expect, it } from 'bun:test'

import { resolveSource } from './canvasUtils'
import { HOME_PAGE, withHomeDocs } from './homeSlice'

describe('baked home slice', () => {
  it('keeps the home page and its challenge metadata available without the corpus', () => {
    expect(HOME_PAGE.route).toBe('/')
    expect(HOME_PAGE.chapters.map(chapter => chapter.id)).toContain('home-tour')
    expect(HOME_PAGE.quests.map(quest => quest.id)).toEqual(expect.arrayContaining([
      'qs-arrive',
      'qs-edit',
      'qs-run',
      'qs-tour-timer',
      'qs-tour-analytics',
    ]))
  })

  it('ships the arrival document and every document referenced by a home scroll stage', () => {
    const docs = withHomeDocs({})
    expect(resolveSource('wods/examples/home/welcome-1.md', docs)).toContain('0:03 Count Down')

    const scrolls = [
      ...(HOME_PAGE.scroll ? [HOME_PAGE.scroll] : []),
      ...Object.values(HOME_PAGE.namedScrolls ?? {}),
    ]
    const sources = scrolls
      .flatMap(scroll => scroll.stages)
      .map(stage => stage.source)
      .filter((source): source is string => typeof source === 'string')
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(resolveSource(source, docs)).not.toContain('# Source not found')
    }

  })
})
