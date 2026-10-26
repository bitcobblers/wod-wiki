import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Entry } from '../../lib/entryMapper'

// Capture the real engine before the registry replacement (load-boundary
// exception) so the block's default engine becomes controllable per test.
const realEntrySearch = await import('../../lib/entrySearch')
let engineEntries: Entry[] = []
mock.module('../../lib/entrySearch', () => ({
  ...realEntrySearch,
  defaultStreamQueryEngine: {
    query: mock(async () => engineEntries),
    withNoteBlockInfo: () => realEntrySearch.defaultStreamQueryEngine,
  },
}))

const { ReadmeQueryBlock } = await import('./ReadmeQueryBlock')

const entry = (id: string, title: string, date: string | null): Entry => ({
  id,
  kind: 'note',
  sourceNotebook: 'test',
  sourceNote: id,
  title,
  date,
})

beforeEach(() => {
  cleanup()
  engineEntries = []
})

describe('ReadmeQueryBlock', () => {
  it('renders the embed heading and rows sorted by date then numeric-aware title', async () => {
    engineEntries = [
      entry('b', 'Event 10', '2026-07-23'),
      entry('a', 'Event 2', '2026-07-23'),
      entry('c', 'Event 1', '2026-07-22'),
      entry('d', 'Undated thing', null),
    ]
    render(<MemoryRouter><ReadmeQueryBlock query=":notebook{notebook:test}" heading="2026" /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('readme-query-block'))

    const rows = screen.getByTestId('readme-query-block').textContent ?? ''
    expect(screen.getByTestId('readme-query-heading').textContent).toBe('2026')
    expect(rows.indexOf('Event 1')).toBeLessThan(rows.indexOf('Event 2'))
    expect(rows.indexOf('Event 2')).toBeLessThan(rows.indexOf('Event 10'))
    expect(rows.indexOf('Event 10')).toBeLessThan(rows.indexOf('Undated thing'))
  })

  it('renders date subgroups when the query groups by {date}', async () => {
    engineEntries = [
      entry('a', 'Event 2', '2026-07-23'),
      entry('b', 'Event 1', '2026-07-22'),
      entry('c', 'Event 3', '2026-07-22'),
    ]
    render(<MemoryRouter><ReadmeQueryBlock query=":notebook{notebook:test} by {date}" heading="" /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('readme-query-block'))

    expect(screen.queryByTestId('readme-query-heading')).toBeNull()
    const groups = screen.getAllByTestId('readme-query-date-group')
    expect(groups).toHaveLength(2)
    expect(groups[0].textContent).toContain('Event 1')
    expect(groups[0].textContent).toContain('Event 3')
    expect(groups[1].textContent).toContain('Event 2')
    // Group headings show the formatted date.
    expect(groups[0].textContent).toMatch(/Jul 22, 2026/)
  })

  it('renders the empty state when the query matches nothing', async () => {
    render(<MemoryRouter><ReadmeQueryBlock query=":notebook{notebook:test}" heading="" /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('readme-query-empty'))
  })
})
