import { describe, expect, it } from 'bun:test'

import { resolveNewEntryRoute, type NewEntryKind } from './NewEntryCombo'

describe('resolveNewEntryRoute', () => {
  it.each<[string, NewEntryKind]>([
    ['/journal', 'journal'],
    ['/day/2026-10-28', 'journal'],
    ['/playgrounds', 'playground'],
    ['/playground/entry-id', 'playground'],
    ['/notebooks', 'notebook'],
    ['/efforts', 'effort'],
    ['/equipment', 'equipment'],
    ['/notes', 'journal'],
  ])('uses the current library type for %s', (pathname, expected) => {
    expect(resolveNewEntryRoute(pathname)).toEqual({ defaultKind: expected })
  })

  it('defaults to a note and retains the destination on notebook routes', () => {
    expect(resolveNewEntryRoute('/notebook/my%20notebook')).toEqual({
      defaultKind: 'note',
      notebookSlug: 'my notebook',
    })
    expect(resolveNewEntryRoute('/notebook/training/2026-10-28/session')).toEqual({
      defaultKind: 'note',
      notebookSlug: 'training',
    })
  })
})
