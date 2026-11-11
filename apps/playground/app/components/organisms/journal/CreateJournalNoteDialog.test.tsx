import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
// React 19 only flushes updates inside act() when the test environment opts
// in; the historical full-suite run got this from a sibling file's global.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Notebook } from '@/types/notebook'
import type { HistoryRecord } from '@/types/history'
import type { CreateJournalNoteInput } from '../../../services/journalNotes'
import * as journalNotesModule from '../../../services/journalNotes'
import * as NotebookServiceModule from '@/services/NotebookService'
import * as createPlaygroundPageModule from '../../../services/createPlaygroundPage'
import type { CommitReferenceNoteInput } from '@/repositories/referenceNotes'
import * as referenceNotesModule from '@/repositories/referenceNotes'

import { CreateJournalNoteDialog } from './CreateJournalNoteDialog'

// The wizard writes through four service seams. Real modules load; the
// methods under assertion are spied and restored per test.
const createNoteMock = mock(async (input: CreateJournalNoteInput): Promise<HistoryRecord> => ({
  id: 'note-123',
  title: input.title,
  rawContent: input.rawContent,
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  schemaVersion: 1,
  journalDate: input.journalDate,
  slug: input.slug,
  type: input.type ?? 'journal',
  // Test fixture — only the fields the wizard reads back are populated.
} as unknown as HistoryRecord))

const moveNoteMock = mock(async (_noteId: string, _notebookId: string | null): Promise<void> => {})
const createNotebookMock = mock(async (name: string, description: string, icon: string): Promise<Notebook> => ({
  notebookId: `notebook/${name.toLowerCase().replace(/\s+/g, '-')}`,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  description,
  icon,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  // Test fixture — Notebook landing-note projection is covered elsewhere.
} as unknown as Notebook))

const createPlaygroundMock = mock(async (): Promise<string> => 'pg-1')
const commitReferenceNoteMock = mock(async (_input: CommitReferenceNoteInput) => ({ id: 't/tag/heavy', sourceRevision: 1 }))

beforeEach(() => {
  cleanup()
  createNoteMock.mockClear()
  moveNoteMock.mockClear()
  createNotebookMock.mockClear()
  createPlaygroundMock.mockClear()
  commitReferenceNoteMock.mockClear()

  spyOn(journalNotesModule.journalNotes, 'create').mockImplementation(createNoteMock)
  spyOn(NotebookServiceModule.notebookService, 'getAll').mockImplementation(async () => [
    { notebookId: 'notebook/strength', slug: 'strength', name: 'Strength', icon: '🏋️', createdAt: 1, updatedAt: 1 },
    // Test fixture — full Notebook shape asserted in NotebookService tests.
  ] as unknown as Notebook[])
  spyOn(NotebookServiceModule.notebookService, 'moveNote').mockImplementation(moveNoteMock)
  spyOn(NotebookServiceModule.notebookService, 'create').mockImplementation(createNotebookMock)
  spyOn(createPlaygroundPageModule, 'createPlaygroundPage').mockImplementation(createPlaygroundMock)
  spyOn(referenceNotesModule, 'commitReferenceNote').mockImplementation(commitReferenceNoteMock)
})

afterEach(() => {
  cleanup()
  mock.restore()
})

describe('CreateJournalNoteDialog unified wizard', () => {
  it('tracks the preselected calendar date into the created note and target notebook', async () => {
    const onCreated = mock(() => {})
    render(
      <MemoryRouter>
        <CreateJournalNoteDialog
          open={true}
          onOpenChange={() => {}}
          defaultKind="journal"
          defaultDate="2026-11-15"
          defaultNotebookSlug="strength"
          onCreated={onCreated}
        />
      </MemoryRouter>,
    )

    const dateInput = screen.getByLabelText('Date') as HTMLInputElement
    expect(dateInput.value).toBe('2026-11-15')

    const titleInput = screen.getByLabelText(/Title/) as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: 'Heavy Squat Day' } })

    const createBtn = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(createBtn)

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledTimes(1)
    })
    expect(createNoteMock.mock.calls[0]?.[0]).toMatchObject({
      journalDate: '2026-11-15',
      title: 'Heavy Squat Day',
      type: 'note',
    })
    expect(moveNoteMock).toHaveBeenCalledWith('note-123', 'notebook/strength')
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('auto-suggests a Page slug from the title and allows editing it when publishing as a Page route', async () => {
    render(
      <MemoryRouter>
        <CreateJournalNoteDialog
          open={true}
          onOpenChange={() => {}}
          defaultKind="journal"
          defaultDate="2026-11-01"
        />
      </MemoryRouter>,
    )

    const titleInput = screen.getByLabelText(/Title/) as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: 'Winter Strength Block' } })

    const pageToggle = screen.getByTestId('journal-create-page-toggle') as HTMLInputElement
    expect(pageToggle.checked).toBe(false)
    fireEvent.click(pageToggle)
    expect(pageToggle.checked).toBe(true)

    const slugInput = screen.getByTestId('journal-create-page-slug') as HTMLInputElement
    expect(slugInput.value).toBe('winter-strength-block')

    fireEvent.change(slugInput, { target: { value: 'custom-winter-block' } })
    expect(slugInput.value).toBe('custom-winter-block')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledTimes(1)
    })
    expect(createNoteMock.mock.calls[0]?.[0]).toMatchObject({
      title: 'Winter Strength Block',
      slug: 'custom-winter-block',
      type: 'note',
    })
  })
  it('switches resource kinds inside the wizard and creates a notebook', async () => {
    render(
      <MemoryRouter>
        <CreateJournalNoteDialog open={true} onOpenChange={() => {}} defaultKind="journal" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId('new-entry-notebook'))

    const createBtn = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
    expect(createBtn.disabled).toBe(true)

    const nameInput = screen.getByPlaceholderText('e.g., Morning Routines')
    fireEvent.change(nameInput, { target: { value: ' Oly Cycle ' } })
    expect(createBtn.disabled).toBe(false)

    fireEvent.click(createBtn)

    await waitFor(() => {
      expect(createNotebookMock).toHaveBeenCalledWith('Oly Cycle', '', '📓')
    })
  })

  it('orders creation options, omits dashboard, and creates a tag', async () => {
    render(
      <MemoryRouter>
        <CreateJournalNoteDialog open={true} onOpenChange={() => {}} defaultKind="journal" />
      </MemoryRouter>,
    )

    const options = screen.getByRole('group', { name: 'Resource type' })
    expect(Array.from(options.querySelectorAll('button')).map(button => button.getAttribute('data-testid'))).toEqual([
      'new-entry-note',
      'new-entry-playground',
      'new-entry-notebook',
      'new-entry-effort',
      'new-entry-equipment',
      'new-entry-tag',
    ])

    fireEvent.click(screen.getByTestId('new-entry-tag'))
    const createBtn = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
    expect(createBtn.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('e.g., heavy'), { target: { value: 'Heavy Breathing' } })
    fireEvent.click(createBtn)

    await waitFor(() => {
      expect(commitReferenceNoteMock).toHaveBeenCalledTimes(1)
    })
    expect(commitReferenceNoteMock.mock.calls[0]?.[0]).toMatchObject({
      kind: 'tag',
      slug: 'heavy-breathing',
      title: 'heavy-breathing',
      expectedSourceRevision: 0,
    })
  })
})
