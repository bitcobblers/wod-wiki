/**
 * StreamQueryBar — the header query bar's observable contract.
 *
 * 1. The bar hosts the shared compact WqlComposer: no header-local draft
 *    parser, no separate scope dropdown — scope favorites flow into the
 *    composer as preferredChoices and kind/target/scope editing happens in
 *    the composer's one searchable picker.
 * 2. Typing resolves synchronously through onQueryChange: valid filter
 *    fragments emit the resolved query, invalid text emits its exact draft.
 * 3. The compact mobile row opens the command palette in WQL mode seeded
 *    with the current query; Apply writes the composed WQL back through
 *    onQueryChange.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { MemoryRouter } from 'react-router-dom'
import { TEST_IDS } from '@/lib/testIds'
import { InMemoryStorage, resetStorageForTesting, setStorageForTesting } from '@/services/storage'
import { StreamQueryBar } from './StreamQueryBar'
import { publishStreamResults } from './streamResults'
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store'

let lastQuery = ''

const noopExecute = (() => Promise.resolve({})) as never

function Bar(props: Partial<Parameters<typeof StreamQueryBar>[0]> = {}) {
  return (
    <MemoryRouter>
      <StreamQueryBar
        query=':note{source:journal,text:"deadlift"} last 2w'
        onQueryChange={(w) => {
          lastQuery = w
        }}
        scopeOptions={['journal', 'collections']}
        execute={noopExecute}
        {...props}
      />
    </MemoryRouter>
  )
}

beforeEach(() => {
  lastQuery = ''
  usePaletteStore.setState({ isOpen: false, request: null, _resolve: null })
})

afterEach(cleanup)

describe('StreamQueryBar', () => {
  it('hosts the shared composer — no separate scope dropdown or draft input', () => {
    render(<Bar />)
    expect(screen.getByTestId('stream-query-bar')).toBeDefined()
    expect(screen.getByTestId('token-slot-source')).toBeDefined()
    expect(screen.getByTestId('wql-scope-toggle')).toBeDefined()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('stream-query-type')).toBeNull()
  })

  it('emits the resolved query synchronously when a filter fragment is typed', () => {
    render(<Bar />)
    fireEvent.click(screen.getByTestId('wql-scope-toggle'))
    const cm = EditorView.findFromDOM(screen.getByTestId('wql-text-input'))!
    act(() => {
      cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: ':note{source:journal,tags:strength} last 2w' } })
    })
    // Same parsing as the dialog: the fragment becomes a real clause while
    // the scope filter and window survive untouched.
    expect(lastQuery).toContain('tags:strength')
    expect(lastQuery).toContain('source:journal')
    expect(lastQuery).toContain('last 2w')
  })

  it('emits invalid text unchanged — no parse attempt, no default pills', () => {
    render(<Bar />)
    fireEvent.click(screen.getByTestId('wql-scope-toggle'))
    const cm = EditorView.findFromDOM(screen.getByTestId('wql-text-input'))!
    act(() => {
      cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: ':note{oops' } })
    })
    expect(lastQuery).toBe(':note{oops')
  })

  it('does not open the command palette on a plain bar click', () => {
    render(<Bar />)
    fireEvent.click(screen.getByTestId('stream-query-bar'))
    expect(usePaletteStore.getState().isOpen).toBe(false)
  })

  it('compact variant summarizes the query and opens the palette on tap', () => {
    render(<Bar compact />)
    const summary = screen.getByTestId('stream-query-summary')
    expect(summary.textContent).toBe('Journal · "deadlift" · Last 2w')
    expect(summary.getAttribute('data-wql')).toBe(':note{source:journal,text:"deadlift"} last 2w')
    fireEvent.click(screen.getByTestId('stream-query-bar'))
    expect(usePaletteStore.getState().isOpen).toBe(true)
    expect(usePaletteStore.getState().request?.wql?.hideResults).toBe(true)
  })

  it('compact dock summarizes the route default when the draft is empty', () => {
    render(<Bar compact query="" defaultQuery=":note{source:journal} last 2w" />)
    const summary = screen.getByTestId('stream-query-summary')
    expect(summary.textContent).toBe('Journal · Last 2w')
    expect(summary.getAttribute('data-wql')).toBe(':note{source:journal} last 2w')
  })

  it('hides structural boilerplate pills (kind, target, route-implied source) at rest and exposes guided FacetProperties with Include/Exclude/Off pills', async () => {
    setStorageForTesting(new InMemoryStorage())
    try {
      publishStreamResults({
        pathname: '/efforts',
        query: ':effort',
        entries: [
          {
            id: 'back-squat',
            kind: 'effort',
            sourceNotebook: 'canonical',
            sourceNote: 'back-squat',
            title: 'Back Squat',
            date: null,
            effort: {
              slug: 'back-squat',
              label: 'Back Squat',
              discipline: 'strength',
              intensityTier: 'heavy',
              registrySource: 'canonical',
            },
          },
        ],
      })

      render(
        <MemoryRouter initialEntries={['/efforts']}>
          <StreamQueryBar
            query=":effort"
            defaultQuery=":effort"
            onQueryChange={(w) => {
              lastQuery = w
            }}
            scopeOptions={[]}
            execute={noopExecute}
            hasAppliedFilters={false}
            activeFilterCount={0}
          />
        </MemoryRouter>,
      )

      // Structural boilerplate pills hidden at rest
      expect(screen.queryByTestId('token-slot-kind')).toBeNull()
      expect(screen.queryByTestId('token-slot-target')).toBeNull()
      expect(screen.queryByTestId(TEST_IDS.STREAM_FACET_FILTER_BADGE)).toBeNull()

      // Open guided + Filter popover hosting FacetProperties
      fireEvent.click(screen.getByTestId(TEST_IDS.STREAM_FACET_FILTER_TRIGGER))
      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.STREAM_FACET_FILTER_POPOVER)).toBeDefined()
      })

      // "Edit in WQL bar" is retired from FacetProperties
      expect(screen.queryByText('Edit in WQL bar')).toBeNull()
      expect(screen.queryByTestId('conditions-jump-wql-text')).toBeNull()

      // Open Discipline accordion and verify explicit Include / Exclude / Off pills
      const disciplineSection = screen.getByTestId('conditions-section-discipline')
      const trigger = disciplineSection.querySelector('button')!
      if (trigger.getAttribute('aria-expanded') === 'false') {
        fireEvent.click(trigger)
      }

      const includePill = await waitFor(() =>
        screen.getByTestId(`${TEST_IDS.FACET_PILL_INCLUDE}-discipline:strength`),
      )
      const excludePill = screen.getByTestId(`${TEST_IDS.FACET_PILL_EXCLUDE}-discipline:strength`)
      const offPill = screen.getByTestId(`${TEST_IDS.FACET_PILL_OFF}-discipline:strength`)
      expect(includePill.textContent).toBe('Include')
      expect(excludePill.textContent).toBe('Exclude')
      expect(offPill.textContent).toBe('Off')

      fireEvent.click(includePill)
      expect(lastQuery).toContain('discipline:strength')

      fireEvent.click(excludePill)
      expect(lastQuery).toContain('!discipline:strength')

      // Freeform input keeps mobile 44px touch target class
      const textInput = screen.getByTestId('conditions-input-text')
      expect(textInput.className).toContain('max-lg:min-h-11')
    } finally {
      resetStorageForTesting()
    }
  })

  it('embeds guided FacetProperties inside the mobile filter sheet header', () => {
    render(<Bar compact hasAppliedFilters activeFilterCount={2} />)
    expect(screen.getByTestId(TEST_IDS.STREAM_FACET_FILTER_BADGE).textContent).toBe('2')
    fireEvent.click(screen.getByTestId('stream-query-bar'))
    const req = usePaletteStore.getState().request
    expect(req?.wql?.hideResults).toBe(true)
    expect(req?.header).toBeDefined()
  })
})
