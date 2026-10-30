/**
 * menuModel — l3ToMenuEntries adaptation contract.
 *
 * The whiteboard L3 model publishes outline + helpful actions through
 * NavContext l3Items; this is the single place they become menu entries:
 *   - outline scroll/call items → links (On this page first)
 *   - `panel` items → live widget entries (dashboard range/units)
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

describe('l3ToMenuEntries — L3 helpful action ordering', () => {
  it('keeps outline entries first and maps call actions to onRun rows', () => {
    const entries = l3ToMenuEntries([
      scrollItem('heading-1'),
      { id: 'helpful-clone', label: 'Clone', level: 3, action: { type: 'call', handler: () => {} } },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ kind: 'link', id: 'heading-1', sectionId: 'heading-1' })
    expect(entries[1]).toMatchObject({ kind: 'link', id: 'helpful-clone', label: 'Clone' })
    expect(entries[1]!.kind === 'link' && entries[1]!.onRun).toBeInstanceOf(Function)
  })

  it('renders panel items as widget entries carrying their id and label', () => {
    const Widget = () => null
    const entries = l3ToMenuEntries([
      { id: 'dashboard-range', label: 'Date range', level: 3, action: { type: 'none' }, panel: Widget },
      scrollItem('after'),
    ])
    expect(entries[0]!.kind).toBe('widget')
    const widget = entries[0]!
    if (widget.kind === 'widget') {
      expect(widget.id).toBe('dashboard-range')
      expect(widget.render()).toBeTruthy()
    }
    expect(entries[1]!.kind).toBe('link')
  })
})
