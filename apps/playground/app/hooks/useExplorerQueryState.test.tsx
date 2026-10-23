/**
 * useExplorerQueryState — URL ↔ WQL string state for the Analytics Explorer
 * route (string-state rework, wayfinder ticket 013; option-A URL contract).
 *
 * Asserts: defaults land, q hydrates draft + submitted, edits replace q in
 * place (one scratch entry per editing spell), submit() converts the entry
 * into the deliberate checkpoint and refuses invalid queries, back/forward
 * restores and re-submits across checkpoints, weeks round-trips with
 * replace semantics, no-op edits never touch the URL.
 */

// Must precede the react-router-dom import: repairs the partial
// react-router-dom mock that useJournalZipProcessor.test.ts leaks
// process-wide (see tests/helpers/repair-react-router-dom.ts).
import '../../tests/helpers/repair-react-router-dom'

import { afterEach, describe, expect, it } from 'bun:test'

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import {
  useExplorerQueryState,
  DEFAULT_EXPLORER_QUERY,
  type ExplorerQueryState,
} from './useExplorerQueryState'

afterEach(cleanup)

let captured: ExplorerQueryState
let capturedNavigate: ReturnType<typeof useNavigate>

function Probe({ defaultQuery }: { defaultQuery?: string } = {}) {
  captured = useExplorerQueryState(
    defaultQuery ? { defaultQuery, runOnLanding: true } : {},
  )
  capturedNavigate = useNavigate()
  const location = useLocation()
  return (
    <div>
      <output data-testid="search">{location.search}</output>
      <output data-testid="pathname">{location.pathname}</output>
      <output data-testid="draft">{captured.draft}</output>
      <output data-testid="submitted">{captured.submitted}</output>
      <output data-testid="weeks">{captured.weeks}</output>
    </div>
  )
}

function renderAt(entries: string[], initialIndex?: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <Probe />
    </MemoryRouter>,
  )
}

const draft = () => screen.getByTestId('draft').textContent
const search = () => screen.getByTestId('search').textContent ?? ''
const qParam = () => new URLSearchParams(search()).get('q') ?? ''
const submitted = () => screen.getByTestId('submitted').textContent ?? ''
const weeks = () => screen.getByTestId('weeks').textContent ?? ''

const AGG = 'sum:totalVolume{discipline:strength} by {week}'

describe('useExplorerQueryState', () => {
  it('falls back to explorer defaults when no params are present', () => {
    renderAt(['/analytics/explorer'])
    expect(draft()).toBe(DEFAULT_EXPLORER_QUERY)
    expect(submitted()).toBe('')
    expect(weeks()).toBe('16')
  })

  it('hydrates the draft and the submitted snapshot from the q parameter on mount', () => {
    renderAt([`/analytics/explorer?q=${encodeURIComponent(AGG)}`])
    expect(draft()).toBe(AGG)
    expect(submitted()).toBe(AGG)
  })

  it('serializes draft edits into the q parameter', async () => {
    renderAt(['/analytics/explorer'])
    act(() => captured.setDraft('sum:tis{}'))
    await waitFor(() => expect(qParam()).toBe('sum:tis{}'))
  })

  it('replaces the URL within an editing spell — one scratch entry, no per-keystroke history', async () => {
    renderAt(['/elsewhere', '/analytics/explorer'], 1)

    act(() => captured.setDraft('sum:tis{}'))
    await waitFor(() => expect(qParam()).toBe('sum:tis{}'))
    act(() => captured.setDraft('sum:tis{} by {week}'))
    await waitFor(() => expect(qParam()).toBe('sum:tis{} by {week}'))

    // Both edits collapsed into one scratch entry: a single Back reaches the
    // pristine landing (restore semantics), a second leaves the explorer.
    act(() => capturedNavigate(-1))
    await waitFor(() => expect(draft()).toBe(DEFAULT_EXPLORER_QUERY))
    expect(submitted()).toBe('')
    act(() => capturedNavigate(-1))
    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/elsewhere'))
  })

  it('keeps submitted untouched while editing; submit() snaps the current draft as the checkpoint', async () => {
    renderAt(['/elsewhere', '/analytics/explorer'], 1)
    act(() => captured.setDraft('sum:tis{}'))
    await waitFor(() => expect(qParam()).toBe('sum:tis{}'))
    // Editing the draft must not run anything.
    expect(submitted()).toBe('')

    act(() => captured.submit())
    expect(submitted()).toBe('sum:tis{}')
    // The checkpoint converts the scratch entry in place: the URL is unchanged…
    expect(qParam()).toBe('sum:tis{}')
    // …and Back reaches the pristine landing instead of a junk draft entry.
    act(() => capturedNavigate(-1))
    await waitFor(() => expect(draft()).toBe(DEFAULT_EXPLORER_QUERY))
    expect(submitted()).toBe('')
  })

  it('refuses invalid queries: submit() neither runs nor rewrites the URL', async () => {
    renderAt(['/analytics/explorer'])
    const searchBefore = search()

    act(() => captured.submit('sum:'))
    expect(submitted()).toBe('')
    expect(search()).toBe(searchBefore)
  })

  it('submit(wql) snaps an explicit query (sidebar / examples path)', async () => {
    renderAt(['/analytics/explorer'])
    act(() => {
      captured.setDraft('sum:sessionLoad{}')
      captured.submit('sum:sessionLoad{}')
    })
    await waitFor(() => expect(qParam()).toBe('sum:sessionLoad{}'))
    expect(submitted()).toBe('sum:sessionLoad{}')
  })

  it('restores the exact query state on browser back/forward and re-submits it', async () => {
    renderAt(['/analytics/explorer'])

    // State A must differ from the seeded default — an edit to the default's
    // own WQL is a no-op and writes no URL.
    act(() => {
      captured.setDraft('sum:sessionLoad{}')
      captured.submit('sum:sessionLoad{}')
    })
    await waitFor(() => expect(qParam()).toBe('sum:sessionLoad{}'))

    // The edit after checkpoint A opens the scratch spell; the URL mirrors
    // the draft, but the run snapshot is still A.
    act(() => captured.setDraft('sum:tis{}'))
    await waitFor(() => expect(qParam()).toBe('sum:tis{}'))
    expect(draft()).toBe('sum:tis{}')
    expect(submitted()).toBe('sum:sessionLoad{}')

    // Forward scratch spell collapsed on submit: Back lands on the A checkpoint…
    act(() => captured.submit())
    await waitFor(() => expect(submitted()).toBe('sum:tis{}'))
    act(() => capturedNavigate(-1))
    await waitFor(() => expect(draft()).toBe('sum:sessionLoad{}'))
    // …and popstate re-submits the restored query (legacy behavior).
    await waitFor(() => expect(submitted()).toBe('sum:sessionLoad{}'))

    // Forward returns to the B checkpoint and re-runs it.
    act(() => capturedNavigate(1))
    await waitFor(() => expect(draft()).toBe('sum:tis{}'))
    await waitFor(() => expect(submitted()).toBe('sum:tis{}'))
  })

  it('an unsubmitted editing spell restores as a draft without re-running the previous checkpoint', async () => {
    renderAt(['/analytics/explorer'])

    act(() => {
      captured.setDraft('sum:sessionLoad{}')
      captured.submit('sum:sessionLoad{}')
    })
    await waitFor(() => expect(submitted()).toBe('sum:sessionLoad{}'))

    // Edit but never run, then go back: the checkpoint is one entry behind.
    act(() => captured.setDraft('sum:tis{}'))
    await waitFor(() => expect(qParam()).toBe('sum:tis{}'))
    act(() => capturedNavigate(-1))
    await waitFor(() => expect(draft()).toBe('sum:sessionLoad{}'))
    await waitFor(() => expect(submitted()).toBe('sum:sessionLoad{}'))
  })

  it('setWeeks writes ?weeks= with history replace, preserving q', async () => {
    renderAt(['/elsewhere', `/analytics/explorer?q=${encodeURIComponent(AGG)}`], 1)

    act(() => captured.setWeeks(8))
    await waitFor(() => expect(weeks()).toBe('8'))
    expect(qParam()).toBe(AGG)

    // Replace semantics: back leaves the page instead of undoing the range change.
    act(() => capturedNavigate(-1))
    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/elsewhere'))
  })

  it('parses weeks from the URL and falls back to 16 for invalid values', () => {
    renderAt(['/analytics/explorer?weeks=4'])
    expect(weeks()).toBe('4')
    cleanup()
    renderAt(['/analytics/explorer?weeks=7'])
    expect(weeks()).toBe('16')
  })

  it('keeps a no-op edit without pushing a history entry', async () => {
    renderAt(['/analytics/explorer'])
    const searchBefore = search()

    act(() => captured.setDraft(DEFAULT_EXPLORER_QUERY))

    expect(draft()).toBe(DEFAULT_EXPLORER_QUERY)
    await act(async () => {})
    expect(search()).toBe(searchBefore)
  })

  it('an unparseable q still lands in submitted (the composer owns the draft fallback)', () => {
    renderAt([`/analytics/explorer?q=${encodeURIComponent('sum:tis{} )))garbage((((')}`])
    expect(draft()).toBe(DEFAULT_EXPLORER_QUERY)
    expect(submitted()).toBe('sum:tis{} )))garbage((((')
  })

  it('re-seeds a bare landing when the landing default changes', async () => {
    renderAt(['/analytics/explorer'])
    expect(draft()).toBe(DEFAULT_EXPLORER_QUERY)
    cleanup()

    // A changed default (the surface's own query settings saved one) applies
    // to a landing with no `?q=` of its own.
    const { rerender } = render(
      <MemoryRouter initialEntries={['/analytics/explorer']}>
        <Probe defaultQuery="sum:totalVolume{}" />
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter initialEntries={['/analytics/explorer']}>
        <Probe defaultQuery="sum:sessionLoad{}" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(draft()).toBe('sum:sessionLoad{}'))
  })

  it('leaves an explicit q alone when the landing default changes', async () => {
    const q = 'sum:tis{}'
    const { rerender } = render(
      <MemoryRouter initialEntries={[`/analytics/explorer?q=${encodeURIComponent(q)}`]}>
        <Probe defaultQuery="sum:totalVolume{}" />
      </MemoryRouter>,
    )
    expect(draft()).toBe(q)

    rerender(
      <MemoryRouter initialEntries={[`/analytics/explorer?q=${encodeURIComponent(q)}`]}>
        <Probe defaultQuery="sum:sessionLoad{}" />
      </MemoryRouter>,
    )
    await act(async () => {})
    expect(draft()).toBe(q)
  })
})
