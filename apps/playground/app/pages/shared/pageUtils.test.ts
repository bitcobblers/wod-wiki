
import { describe, expect, it, mock } from 'bun:test'
import { mapIndexToL3, applyTemplate, extractPageIndex, appendTimerBlock } from './pageUtils'
import type { PageNavLink } from '@/components/organisms/layout/PageNavDropdown'

describe('appendTimerBlock', () => {
  it('appends one runnable timer without disturbing the note', () => {
    expect(appendTimerBlock('# Note\n')).toBe('# Note\n\n```time\n10:00\n```\n')
  })
})

describe('mapIndexToL3', () => {
  it('maps a plain heading link to a scroll action', () => {
    const index: PageNavLink[] = [{ id: 'intro', label: 'Intro', type: 'heading' }]
    const l3 = mapIndexToL3(index)

    expect(l3).toHaveLength(1)
    expect(l3[0].action).toEqual({ type: 'scroll', sectionId: 'intro' })
    expect(l3[0].secondaryAction).toBeUndefined()
  })

  it('keeps a heading with a runtime action as a scroll primary action', () => {
    const onRun = mock(() => {})
    const index: PageNavLink[] = [{ id: 'warm-up', label: 'Warm Up', type: 'heading', onRun, runIcon: 'play' }]
    const l3 = mapIndexToL3(index)

    expect(l3[0].action).toEqual({ type: 'scroll', sectionId: 'warm-up' })
    expect(l3[0].secondaryAction?.action).toEqual({ type: 'call', handler: onRun })
  })

  it('navigates on primary click for collection workout links with the link icon', () => {
    const onRun = mock(() => {})
    const index: PageNavLink[] = [
      {
        id: 'workout-../../markdown/collections/girls/Fran.md',
        label: 'Fran',
        type: 'time',
        onRun,
        runIcon: 'link',
      },
    ]
    const l3 = mapIndexToL3(index)

    expect(l3[0].action).toEqual({ type: 'call', handler: onRun })
    expect(l3[0].secondaryAction?.action).toEqual({ type: 'call', handler: onRun })
  })
  it('gives display-only log links no secondary Run action (#891)', () => {
    const index: PageNavLink[] = [{ id: 'log-line-7', label: 'Workout 1', type: 'log' }]
    const l3 = mapIndexToL3(index)

    expect(l3[0].action).toEqual({ type: 'scroll', sectionId: 'log-line-7' })
    expect(l3[0].secondaryAction).toBeUndefined()
  })
  it('maps heading with edit runIcon to secondary edit action', () => {
    const onEdit = mock(() => {})
    const index: PageNavLink[] = [{ id: 'fran', label: 'Fran', type: 'heading', onRun: onEdit, runIcon: 'edit' }]
    const l3 = mapIndexToL3(index)

    expect(l3[0].action).toEqual({ type: 'scroll', sectionId: 'fran' })
    expect(l3[0].secondaryAction?.id).toBe('fran-edit')
    expect(l3[0].secondaryAction?.label).toBe('Edit')
    expect(l3[0].secondaryAction?.action).toEqual({ type: 'call', handler: onEdit })
    expect(l3[0].secondaryRunIcon).toBe('edit')
  })
})

describe('extractPageIndex', () => {
  it('emits time and log link types for workout fences (#891)', () => {
    const links = extractPageIndex(['# Note', '', '```time', '10:00 AMRAP', '```', '', '```log:climbing', '5x Boulder', '```'].join('\n'))

    const timeLink = links.find(l => l.type === 'time')
    const logLink = links.find(l => l.type === 'log')
    expect(timeLink).toBeDefined()
    expect(logLink).toBeDefined()
    // Neither carries onRun here — useNotePageNav wires Run for time only.
    expect(timeLink?.onRun).toBeUndefined()
    expect(logLink?.onRun).toBeUndefined()
  })
})

describe('applyTemplate', () => {
  it('removes the $CURSOR token and reports the offset', () => {
    const result = applyTemplate('Hello $CURSOR world')
    expect(result.content).toBe('Hello  world')
    expect(result.cursorOffset).toBe(6)
  })

  it('returns the full string when no cursor token is present', () => {
    const result = applyTemplate('Hello world')
    expect(result.content).toBe('Hello world')
    expect(result.cursorOffset).toBe(11)
  })
})
