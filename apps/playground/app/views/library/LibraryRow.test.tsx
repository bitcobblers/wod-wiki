import { describe, it, expect, afterEach } from 'bun:test'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TEST_IDS } from '@/lib/testIds'
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

  it('disables Subscribe button and sets aria-busy + Subscribing… label when subscribing (WW-086)', () => {
    const feedEntry: Entry = {
      id: 'feed:sport-crossfit',
      kind: 'feed',
      feedId: 'sport-crossfit',
      subscribed: false,
      sourceNotebook: 'feeds',
      sourceNote: 'sport-crossfit',
      title: 'CrossFit',
      date: null,
    }

    render(
      <MemoryRouter>
        <LibraryRow entry={feedEntry} onToggleSubscribe={() => {}} subscribing />
      </MemoryRouter>,
    )

    const btn = screen.getByTestId('row-subscribe-sport-crossfit') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.textContent).toContain('Subscribing…')
  })

  it('differentiates personal notebook notes, read-only feed notes, and archived local copies cleanly', () => {
    const ownedNote: Entry = {
      id: 'user-1',
      kind: 'note',
      sourceNotebook: 'strength-block',
      sourceNote: 'user-1',
      title: 'Heavy Squat Day',
      date: '2026-10-01',
      editable: true,
      ownership: { kind: 'user', editable: true, canPublish: true },
    }
    const feedNote: Entry = {
      id: 'feed-1',
      kind: 'note',
      sourceNotebook: 'girls',
      sourceNote: 'fran',
      title: 'Fran',
      date: null,
      feedId: 'sport-crossfit',
      editable: false,
      ownership: { kind: 'feed', editable: false, canPublish: false, feedSourceId: 'sport-crossfit', upstreamStatus: 'live' },
    }
    const archivedNote: Entry = {
      id: 'arch-1',
      kind: 'note',
      sourceNotebook: 'kettlebell',
      sourceNote: 'simple',
      title: 'Simple & Sinister',
      date: null,
      feedId: 'sport-kettlebell',
      editable: false,
      ownership: { kind: 'feed-archived', editable: false, canPublish: false, feedSourceId: 'sport-kettlebell', upstreamStatus: 'unsubscribed' },
    }

    const { container } = render(
      <MemoryRouter>
        <LibraryRow entry={ownedNote} />
        <LibraryRow entry={feedNote} />
        <LibraryRow entry={archivedNote} />
      </MemoryRouter>,
    )

    expect(screen.getByText('My Note')).toBeDefined()
    expect(screen.getByText('CrossFit')).toBeDefined()
    expect(screen.getByText('Upstream Removed')).toBeDefined()
    expect(screen.queryByText('Notebook')).toBeNull()
    expect(container.innerHTML).not.toContain('text-[9px]')
    expect(container.innerHTML).not.toContain('text-[10px]')
    expect(container.innerHTML).not.toContain('sm:opacity-0')
  })

  it('renders System badge and hides Private/publish/edit/delete controls for read-only system notebooks', () => {
    const systemNotebook: Entry = {
      id: 'notebook:guides',
      kind: 'notebook',
      feedId: 'local',
      sourceNotebook: 'guides',
      sourceNote: 'guides',
      title: 'Guides',
      date: null,
      isPublic: false,
    }

    render(
      <MemoryRouter>
        <LibraryRow
          entry={systemNotebook}
          onTogglePublicNotebook={() => {}}
          onEditNotebook={() => {}}
          onDeleteNotebook={() => {}}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('System')).toBeDefined()
    expect(screen.queryByTestId('library-row-visibility-guides')).toBeNull()
    expect(screen.queryByText('Private')).toBeNull()
    expect(screen.queryByTestId(TEST_IDS.LIBRARY_ROW_OVERFLOW)).toBeNull()
    expect(screen.queryByTestId('row-toggle-public-guides')).toBeNull()
    expect(screen.queryByTestId('notebook-edit-guides')).toBeNull()
    expect(screen.queryByTestId('notebook-delete-guides')).toBeNull()
  })

  it('gates Make Public, Edit, and Delete on non-publishable built-in notebooks while keeping user custom notebook controls', () => {
    const journalNotebook: Entry = {
      id: 'notebook:journal',
      kind: 'notebook',
      feedId: 'local',
      sourceNotebook: 'journal',
      sourceNote: 'journal',
      title: 'Journal',
      date: null,
      isPublic: false,
    }
    const customNotebook: Entry = {
      id: 'notebook:strength-block',
      kind: 'notebook',
      feedId: 'local',
      sourceNotebook: 'strength-block',
      sourceNote: 'strength-block',
      title: 'Strength Block',
      date: null,
      isPublic: false,
    }

    render(
      <MemoryRouter>
        <LibraryRow
          entry={journalNotebook}
          onTogglePublicNotebook={() => {}}
          onEditNotebook={() => {}}
          onDeleteNotebook={() => {}}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('library-row-visibility-journal').textContent).toContain('Private')
    expect(screen.queryByTestId(TEST_IDS.LIBRARY_ROW_OVERFLOW)).toBeNull()
    expect(screen.queryByTestId('row-toggle-public-journal')).toBeNull()
    expect(screen.queryByTestId('notebook-edit-journal')).toBeNull()
    expect(screen.queryByTestId('notebook-delete-journal')).toBeNull()

    cleanup()

    const deleted: Entry[] = []
    render(
      <MemoryRouter>
        <LibraryRow
          entry={customNotebook}
          onTogglePublicNotebook={() => {}}
          onEditNotebook={() => {}}
          onDeleteNotebook={(e) => deleted.push(e)}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('library-row-visibility-strength-block').textContent).toContain('Private')
    fireEvent.click(screen.getByTestId(TEST_IDS.LIBRARY_ROW_OVERFLOW))
    expect(screen.getByTestId('row-toggle-public-strength-block')).toBeDefined()
    expect(screen.getByTestId('notebook-edit-strength-block')).toBeDefined()
    fireEvent.click(screen.getByTestId('notebook-delete-strength-block'))
    expect(deleted).toHaveLength(1)
    expect(deleted[0]!.id).toBe('notebook:strength-block')
  })

  it('WW-118: renders row title as a native Link anchor pointing to entryOpenHref', () => {
    render(
      <MemoryRouter>
        <LibraryRow entry={testEntry} />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Journal Entry Title' })
    expect(link.getAttribute('href')).toBe('/note/test-1')
  })
})
