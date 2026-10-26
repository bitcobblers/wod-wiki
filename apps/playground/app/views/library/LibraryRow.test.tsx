import { describe, it, expect, afterEach } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LibraryRow } from './LibraryRow'
import type { Entry } from '../../lib/entryMapper'

afterEach(() => {
  cleanup()
})

describe('LibraryRow — field projection adaptation', () => {
  const testEntry: Entry = {
    id: 'test-1',
    kind: 'note',
    sourceNotebook: 'journal',
    sourceNote: 'test-1',
    title: 'Journal Entry Title',
    subtitle: 'Morning Session',
    detail: 'Push-up, Pull-up, Squat',
    date: '2026-09-02',
  }

  it('labels note-kind rows by their source in the All view (playground/guide flavors)', () => {
    render(
      <MemoryRouter>
        <LibraryRow entry={{ ...testEntry, id: 'pg-1', sourceNotebook: 'playground' }} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Playground')).toBeDefined()

    cleanup()
    render(
      <MemoryRouter>
        <LibraryRow entry={{ ...testEntry, id: 'g-1', sourceNotebook: 'guides' }} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Guide')).toBeDefined()

    cleanup()
    render(<MemoryRouter><LibraryRow entry={testEntry} /></MemoryRouter>)
    // Journal notes keep the plain Note label.
    expect(screen.getByText('Note')).toBeDefined()
  })

  it('renders all details when visibleFieldIds is omitted (default behavior)', () => {
    render(
      <MemoryRouter>
        <LibraryRow entry={testEntry} dateLabel="2026-09-02" />
      </MemoryRouter>,
    )

    expect(screen.getByText('Journal Entry Title')).toBeDefined()
    expect(screen.getByText('Morning Session')).toBeDefined()
    expect(screen.getByText('Push-up, Pull-up, Squat')).toBeDefined()
    expect(screen.getByTestId('library-row-date')).toBeDefined()
  })

  it('hides date when date is not in visibleFieldIds', () => {
    render(
      <MemoryRouter>
        <LibraryRow
          entry={testEntry}
          dateLabel="2026-09-02"
          visibleFieldIds={['title', 'sourceNotebook']}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Journal Entry Title')).toBeDefined()
    expect(screen.queryByTestId('library-row-date')).toBeNull()
  })

  it('hides subtitle when neither catalog nor protocol is visible', () => {
    render(
      <MemoryRouter>
        <LibraryRow
          entry={testEntry}
          visibleFieldIds={['title', 'excerpt']}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Journal Entry Title')).toBeDefined()
    expect(screen.queryByText('Morning Session')).toBeNull()
    expect(screen.getByText('Push-up, Pull-up, Squat')).toBeDefined()
  })

  it('renders new kinds (effort, result, segment)', () => {
    const effortEntry: Entry = {
      id: 'eff-1',
      kind: 'effort',
      sourceNotebook: 'canonical',
      sourceNote: 'eff-1',
      title: 'Thruster',
      date: null,
    }

    render(
      <MemoryRouter>
        <LibraryRow entry={effortEntry} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Thruster')).toBeDefined()
    expect(screen.getByText('Effort')).toBeDefined()
  })

  it('renders a clickable link to /e/:slug for segment entries with effortSlug', () => {
    const segmentEntry: Entry = {
      id: 'res-123:0',
      kind: 'segment',
      sourceNotebook: 'results',
      sourceNote: 'res-123',
      title: 'Thruster',
      date: '2026-08-15',
      execution: {
        resultId: 'res-123',
        noteId: 'crossfit-girls/fran',
        timestamp: 1700000000000,
        outputType: 'segment',
        effortSlug: 'thruster',
      },
    }

    render(
      <MemoryRouter>
        <LibraryRow entry={segmentEntry} />
      </MemoryRouter>,
    )

    const effortLink = screen.getByTestId('library-row-effort-link')
    expect(effortLink).toBeDefined()
    expect(effortLink.getAttribute('href')).toBe('/effort/thruster')

    let stopped = false
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    event.stopPropagation = () => { stopped = true }
    effortLink.dispatchEvent(event)
    expect(stopped).toBe(true)
  })
})
