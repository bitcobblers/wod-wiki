/**
 * menuModel — l3ToMenuEntries adaptation contract.
 *
 * `l3Items` represents the pure structural Goto slot ("On this page"):
 *   - scroll actions → MenuLink with `sectionId`
 *   - route actions  → MenuLink with `to`
 *   - call actions   → MenuLink with `onRun`
 *   - `secondaryAction` call → inline `onRun` + `runIcon` button
 *
 * Modifiers (`streamControls` / `analyticsControls`) and context actions
 * (`l3Actions`) live in their own dedicated L3 slots rather than multiplexing
 * through `l3Items`.
 */
import { describe, expect, it } from 'bun:test'
import { l3ToMenuEntries } from '../menuModel'
import type { NavItemL3 } from '../../nav/navTypes'

const scrollItem = (id: string): NavItemL3 => ({
  id,
  label: id,
  level: 3,
  action: { type: 'scroll', sectionId: id },
})

describe('l3ToMenuEntries — pure Goto link mapping', () => {
  it('maps scroll, route, and secondary run affordances to MenuLink entries', () => {
    const runHandler = () => {}
    const entries = l3ToMenuEntries([
      scrollItem('heading-1'),
      {
        id: 'time-line-5',
        label: '10:00 AMRAP',
        level: 3,
        action: { type: 'scroll', sectionId: 'time-line-5' },
        secondaryAction: {
          id: 'run-5',
          label: 'Start workout',
          action: { type: 'call', handler: runHandler },
        },
        secondaryRunIcon: 'play',
      },
      {
        id: 'workout-fran',
        label: 'Fran',
        level: 3,
        action: { type: 'route', to: '/note/fran' },
      },
    ])

    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ kind: 'link', id: 'heading-1', sectionId: 'heading-1' })
    expect(entries[1]).toMatchObject({
      kind: 'link',
      id: 'time-line-5',
      sectionId: 'time-line-5',
      onRun: runHandler,
      runIcon: 'play',
    })
    expect(entries[2]).toMatchObject({ kind: 'link', id: 'workout-fran', to: '/note/fran' })
  })
})
