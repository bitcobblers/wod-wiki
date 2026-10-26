import { describe, it, expect, mock, afterEach } from 'bun:test'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PropertyTable } from './PropertyTable'
import type { Entry } from '../../lib/entryMapper'

describe('PropertyTable component', () => {
afterEach(() => {
  cleanup()
})

  const sampleEntries: Entry[] = [
    {
      id: 'eff-1',
      kind: 'effort',
      sourceNotebook: 'canonical',
      sourceNote: 'back-squat',
      title: 'Back Squat',
      date: null,
      effort: {
        slug: 'back-squat',
        label: 'Back Squat',
        discipline: 'strength',
        met: 6.0,
        intensityTier: 'heavy',
        aliases: ['BS', 'Squat'],
      },
    },
    {
      id: 'eff-2',
      kind: 'effort',
      sourceNotebook: 'canonical',
      sourceNote: 'pull-up',
      title: 'Pull-up',
      date: null,
      effort: {
        slug: 'pull-up',
        label: 'Pull-up',
        discipline: 'gymnastics',
        met: 5.0,
        intensityTier: 'moderate',
      },
    },
  ]

  it('sticks the column-header row under the page sticky boundary', () => {
    const { container } = render(
      <MemoryRouter>
        <PropertyTable entries={sampleEntries} level="effort" stickyHeaderTop={61} />
      </MemoryRouter>,
    )
    const thead = container.querySelector('thead') as HTMLElement
    expect(thead.className).toContain('sticky')
    expect(thead.style.top).toBe('61px')
  })

  it('keeps the header non-sticky without stickyHeaderTop', () => {
    const { container } = render(
      <MemoryRouter>
        <PropertyTable entries={sampleEntries} level="effort" />
      </MemoryRouter>,
    )
    const thead = container.querySelector('thead') as HTMLElement
    expect(thead.className).not.toContain('sticky')
    expect(thead.style.top).toBe('')
  })

  it('renders table headers for all default visible fields for effort level', () => {
    render(
      <MemoryRouter>
        <PropertyTable entries={sampleEntries} level="effort" />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('property-table')).toBeDefined()
    expect(screen.getByTestId('property-table-header-label')).toBeDefined()
    expect(screen.getByTestId('property-table-header-canonicalSlug')).toBeDefined()
    expect(screen.getByTestId('property-table-header-discipline')).toBeDefined()
    expect(screen.getByTestId('property-table-header-met')).toBeDefined()
    expect(screen.getByTestId('property-table-header-intensityTier')).toBeDefined()
    expect(screen.getByTestId('property-table-header-aliases')).toBeDefined()
  })

  it('adapts columns dynamically when visibleFieldIds is customized', () => {
    render(
      <MemoryRouter>
        <PropertyTable
          entries={sampleEntries}
          level="effort"
          visibleFieldIds={['label', 'discipline']}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('property-table-header-label')).toBeDefined()
    expect(screen.getByTestId('property-table-header-discipline')).toBeDefined()
    expect(screen.queryByTestId('property-table-header-met')).toBeNull()
    expect(screen.queryByTestId('property-table-header-aliases')).toBeNull()
  })

  it('renders rows with projected values', () => {
    render(
      <MemoryRouter>
        <PropertyTable
          entries={sampleEntries}
          level="effort"
          visibleFieldIds={['label', 'discipline', 'met']}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('property-table-row-eff-1')).toBeDefined()
    expect(screen.getByTestId('property-table-row-eff-2')).toBeDefined()

    expect(screen.getByText('Back Squat')).toBeDefined()
    expect(screen.getByText('strength')).toBeDefined()
    expect(screen.getByText('6.0')).toBeDefined()

    expect(screen.getByText('Pull-up')).toBeDefined()
    expect(screen.getByText('gymnastics')).toBeDefined()
    expect(screen.getByText('5.0')).toBeDefined()
  })

  it('fires onRowClick when a row is clicked', () => {
    const handleRowClick = mock()
    render(
      <MemoryRouter>
        <PropertyTable
          entries={sampleEntries}
          level="effort"
          onRowClick={handleRowClick}
        />
      </MemoryRouter>,
    )

    const row = screen.getByTestId('property-table-row-eff-1')
    fireEvent.click(row)

    expect(handleRowClick).toHaveBeenCalledTimes(1)
    expect(handleRowClick).toHaveBeenCalledWith(sampleEntries[0])
  })

  it('renders custom empty message when no entries are provided', () => {
    render(
      <MemoryRouter>
        <PropertyTable entries={[]} level="effort" emptyMessage="No movements found." />
      </MemoryRouter>,
    )

    expect(screen.getByText('No movements found.')).toBeDefined()
  })

  it('renders clickable effort link for segment rows with effortSlug', () => {
    const segmentEntries: Entry[] = [
      {
        id: 'seg-1',
        kind: 'segment',
        sourceNotebook: 'results',
        sourceNote: 'seg-1',
        title: 'Round 1',
        date: '2026-08-15',
        execution: {
          resultId: 'res-1',
          noteId: 'fran',
          timestamp: 1700000000000,
          outputType: 'segment',
          effortSlug: 'thruster',
        },
      },
    ]

    const handleRowClick = mock(() => {})
    render(
      <MemoryRouter>
        <PropertyTable entries={segmentEntries} level="segment" onRowClick={handleRowClick} />
      </MemoryRouter>,
    )

    const effortLink = screen.getByTestId('property-table-effort-link')
    expect(effortLink).toBeDefined()
    expect(effortLink.getAttribute('href')).toBe('/effort/thruster')

    fireEvent.click(effortLink)
    expect(handleRowClick).not.toHaveBeenCalled()
  })
  it('sorts entries when clicking column headers', () => {
    render(
      <MemoryRouter>
        <PropertyTable entries={sampleEntries} level="effort" />
      </MemoryRouter>,
    )

    const header = screen.getByTestId('property-table-header-label')
    // Default order: Back Squat, Pull-up
    let rows = screen.getAllByTestId(/^property-table-row-/)
    expect(rows[0].getAttribute('data-testid')).toBe('property-table-row-eff-1')
    expect(rows[1].getAttribute('data-testid')).toBe('property-table-row-eff-2')

    // Click once: sort asc (Back Squat, Pull-up)
    fireEvent.click(header)
    rows = screen.getAllByTestId(/^property-table-row-/)
    expect(rows[0].getAttribute('data-testid')).toBe('property-table-row-eff-1')

    // Click again: sort desc (Pull-up, Back Squat)
    fireEvent.click(header)
    rows = screen.getAllByTestId(/^property-table-row-/)
    expect(rows[0].getAttribute('data-testid')).toBe('property-table-row-eff-2')
    expect(rows[1].getAttribute('data-testid')).toBe('property-table-row-eff-1')
  })
})
