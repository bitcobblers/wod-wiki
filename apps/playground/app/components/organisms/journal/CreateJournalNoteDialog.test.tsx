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
import * as storageServiceModule from '@/services/storage'
import * as scriptNotebooksModule from '@/repositories/script-notebooks'
import type { CommitReferenceNoteInput } from '@/repositories/referenceNotes'
import * as referenceNotesModule from '@/repositories/referenceNotes'
import { TEST_IDS } from '@/lib/testIds'

import { CreateJournalNoteDialog, curatePickerWorkouts, curateTemplateOptions } from './CreateJournalNoteDialog'

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
      notebookIds: ['notebook/strength'],
    })
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

  it('WW-020: includes optional note body typed in Create a note dialog (blank and template modes)', async () => {
    spyOn(scriptNotebooksModule, 'getScriptNotebooks').mockImplementation(async () => [])
    spyOn(storageServiceModule.storageService, 'getAllNotes').mockImplementation(async () => [
      {
        id: 'tpl-fran-1',
        title: 'Fran Template',
        rawContent: '# Fran\n\n```wod\n21-15-9\n  Thrusters\n  Pullups\n```',
        notebookId: 'notebook/strength',
        tags: ['template'],
        createdAt: 1,
        updatedAt: 1,
        sourceRevision: 1,
        blocks: {},
      } as never,
    ])

    const { unmount } = render(
      <MemoryRouter>
        <CreateJournalNoteDialog
          open={true}
          onOpenChange={() => {}}
          defaultKind="journal"
          defaultDate="2099-08-04"
        />
      </MemoryRouter>,
    )

    const titleInput = screen.getByTestId(TEST_IDS.ENTRY_CREATE_TITLE_INPUT) as HTMLInputElement
    const bodyInput = screen.getByTestId(TEST_IDS.ENTRY_CREATE_BODY_INPUT) as HTMLTextAreaElement
    expect(screen.getByLabelText(/Content/i).getAttribute('data-testid')).toBe(TEST_IDS.ENTRY_CREATE_BODY_INPUT)

    fireEvent.change(titleInput, { target: { value: 'WW020 Dialog Body Test' } })
    fireEvent.change(bodyInput, { target: { value: 'For Time:\n10 Burpees\n10 Air Squats' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledTimes(1)
    })
    const blankPayload = createNoteMock.mock.calls[0]?.[0]
    expect(blankPayload?.title).toBe('WW020 Dialog Body Test')
    expect(blankPayload?.rawContent).toBe('For Time:\n10 Burpees\n10 Air Squats')
    unmount()

    // Re-open with a notebook template selected and verify typed body is preserved alongside template text
    render(
      <MemoryRouter>
        <CreateJournalNoteDialog
          open={true}
          onOpenChange={() => {}}
          defaultKind="journal"
          defaultDate="2099-08-04"
        />
      </MemoryRouter>,
    )

    const templateInput = screen.getByTestId('journal-create-template')
    fireEvent.focus(templateInput)
    fireEvent.change(templateInput, { target: { value: 'Fran Template' } })
    const templateOption = await screen.findByText('Fran Template')
    fireEvent.click(templateOption)

    fireEvent.change(screen.getByTestId(TEST_IDS.ENTRY_CREATE_BODY_INPUT), {
      target: { value: 'Scaled to 65lb' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledTimes(2)
    })
    const templatePayload = createNoteMock.mock.calls[1]?.[0]
    expect(templatePayload?.rawContent).toContain('21-15-9')
    expect(templatePayload?.rawContent).toContain('Scaled to 65lb')
  })

  it('splits Write a Note vs Pick / Log a Workout and tucks Advanced options behind disclosure', async () => {
    render(
      <MemoryRouter>
        <CreateJournalNoteDialog open onOpenChange={() => {}} defaultKind="journal" />
      </MemoryRouter>,
    )

    const advancedBtn = screen.getByRole('button', { name: /Advanced options/i })
    expect(advancedBtn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(advancedBtn)
    expect(advancedBtn.getAttribute('aria-expanded')).toBe('true')

    const pickTab = screen.getByRole('tab', { name: /Pick \/ Log a Workout/i })
    fireEvent.click(pickTab)
    await waitFor(() => {
      expect(screen.getByLabelText('Search workouts')).toBeDefined()
    })
  })

  it('WW-109: curates template and Pick workouts by excluding results, requiring fences, capping unsearched groups, and preserving search', () => {
    const templates = curateTemplateOptions(
      [
        { key: '', label: 'Blank note', group: 'Default' },
        { key: 'src:athletics-results::a', label: '2026 Result', group: 'Results', groupKey: 'athletics-results', categories: ['results'] },
        ...Array.from({ length: 6 }, (_, i) => ({
          key: `src:girls::g-${i}`,
          label: `Girl ${i}`,
          group: 'CrossFit Girls',
          groupKey: 'girls',
          categories: ['benchmarks'],
        })),
        { key: 'src:kb::kb-1', label: 'KB Ladder', group: 'Kettlebell', groupKey: 'kb', categories: ['kettlebell'] },
      ],
      '',
    )
    expect(templates.visibleTemplateOptions.some((o) => o.groupKey === 'athletics-results')).toBe(false)
    expect(templates.visibleTemplateOptions.filter((o) => o.groupKey === 'girls')).toHaveLength(3)
    expect(templates.visibleTemplateOptions.some((o) => o.key === 'src:kb::kb-1')).toBe(true)

    const searched = curateTemplateOptions(
      [
        { key: '', label: 'Blank note', group: 'Default' },
        { key: 'src:athletics-results::a', label: '2026 Result', group: 'Results', groupKey: 'athletics-results', categories: ['results'] },
        ...Array.from({ length: 6 }, (_, i) => ({
          key: `src:girls::g-${i}`,
          label: `Girl ${i}`,
          group: 'CrossFit Girls',
          groupKey: 'girls',
          categories: ['benchmarks'],
        })),
      ],
      'Girl',
    )
    expect(searched.visibleTemplateOptions).toHaveLength(6)

    const curatedPick = curatePickerWorkouts(
      [
        { id: 'prose-only', isMine: false, notebookSlug: 'guides', rawContent: '# Guide without fence', searchText: 'guide' },
        { id: 'res-1', isMine: false, notebookSlug: 'results', categories: ['results'], rawContent: '```time\n10 Burpees\n```', searchText: 'result' },
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `hero-${i}`,
          isMine: false,
          notebookSlug: 'heroes',
          rawContent: '```wod\n10 Pullups\n```',
          searchText: `hero ${i}`,
        })),
        { id: 'mine-1', isMine: true, notebookSlug: 'journal', rawContent: '```time\n5k Run\n```', searchText: 'mine 5k' },
      ],
      '',
    )
    expect(curatedPick.some((i) => i.id === 'prose-only')).toBe(false)
    expect(curatedPick.some((i) => i.id === 'res-1')).toBe(false)
    expect(curatedPick.filter((i) => i.notebookSlug === 'heroes')).toHaveLength(4)
    expect(curatedPick.some((i) => i.id === 'mine-1')).toBe(true)
  })
})
