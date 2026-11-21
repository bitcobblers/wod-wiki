import { describe, expect, it } from 'bun:test'

import { isReadOnlyNotebookOrigin, resolveNewEntryRoute, routeSupportsCreation, type NewEntryKind } from './NewEntryCombo'

describe('resolveNewEntryRoute', () => {
  it.each<[string, NewEntryKind]>([
    ['/', 'journal'],
    ['/journal', 'journal'],
    ['/day/2026-10-28', 'journal'],
    ['/playgrounds', 'playground'],
    ['/playground/entry-id', 'playground'],
    ['/notebooks', 'notebook'],
    ['/efforts', 'effort'],
    ['/equipment', 'equipment'],
    ['/pages', 'page'],
    ['/tags', 'tag'],
    ['/notes', 'journal'],
  ])('uses the current library type for %s', (pathname, expected) => {
    expect(resolveNewEntryRoute(pathname).defaultKind).toBe(expected)
  })

  it('extracts the date from /day/:date and /notebook/:slug/:date routes', () => {
    expect(resolveNewEntryRoute('/day/2026-10-28')).toEqual({
      defaultKind: 'journal',
      defaultDate: '2026-10-28',
    })
    expect(resolveNewEntryRoute('/notebook/training/2026-10-28')).toEqual({
      defaultKind: 'note',
      notebookSlug: 'training',
      defaultDate: '2026-10-28',
    })
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

describe('routeSupportsCreation', () => {
  it.each([
    '/',
    '/journal',
    '/playgrounds',
    '/notebooks',
    '/notebook/training',
    '/pages',
    '/efforts',
    '/equipment',
    '/tags',
  ])('allows creation on %s', pathname => {
    expect(routeSupportsCreation(pathname)).toBe(true)
  })

  it.each([
    '/notes',
    '/dashboards',
    '/feeds',
    '/sessions',
    '/results/result-id',
    '/note/note-id',
    '/playground/entry-id',
    '/notebook/training/fran',
  ])('does not infer creation on %s', pathname => {
    expect(routeSupportsCreation(pathname)).toBe(false)
  })
})

describe('isReadOnlyNotebookOrigin', () => {
  it('flags feed notebooks and built-in read-only system notebooks as read-only targets', () => {
    expect(isReadOnlyNotebookOrigin('girls', 'feed')).toBe(true)
    expect(isReadOnlyNotebookOrigin('defaults', 'default')).toBe(true)
    expect(isReadOnlyNotebookOrigin('guides', 'default')).toBe(true)
    expect(isReadOnlyNotebookOrigin('training', 'user')).toBe(false)
    expect(isReadOnlyNotebookOrigin(undefined, null)).toBe(false)
  })
})
