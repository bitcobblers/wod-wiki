/**
 * QuerySettingsPanel — a surface's own query configuration, edited where the
 * query lives.
 *
 * Asserts:
 *   1. The landing default is validated with the shared parser — invalid
 *      text is reported and blocks the save.
 *   2. A saved landing default persists, and a reset discards it.
 *   3. The Where-stored scope favorites persist, including the emptied
 *      nudge state and the migrated canonical ids.
 *   4. The Group-By favorites persist in priority order.
 *   5. Stored ids outside the vocabulary are reported, never turned into
 *      favorites.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QuerySettingsPanel } from './QuerySettingsDialog'
import { writeRouteWqlConfig, readRouteWqlConfig } from '../../../lib/routeWqlConfig'
import { queryConfigSurface } from '../../../lib/queryConfigSurfaces'

const JOURNAL = queryConfigSurface('/journal')!
const FEEDS = queryConfigSurface('/feeds')!
const EFFORTS = queryConfigSurface('/efforts')!

function renderPanel(surface = JOURNAL) {
  return render(
    <MemoryRouter>
      <QuerySettingsPanel surface={surface} />
    </MemoryRouter>,
  )
}

describe('QuerySettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('saves a landing default query override into routeWqlConfig storage', async () => {
    renderPanel(JOURNAL)

    fireEvent.change(screen.getByTestId('query-settings-wql'), {
      target: { value: ':note{source:journal} last 52w' },
    })
    fireEvent.click(screen.getByTestId('query-settings-save'))

    expect(screen.queryByTestId('query-settings-wql-error')).toBeNull()
    expect(readRouteWqlConfig('/journal').defaultWql).toBe(':note{source:journal} last 52w')
    // Saved state is no longer dirty — save disables (after the async save settles).
    await waitFor(() =>
      expect((screen.getByTestId('query-settings-save') as HTMLButtonElement).disabled).toBe(true),
    )
  })

  it('blocks saving an unparseable default query', () => {
    renderPanel(JOURNAL)

    fireEvent.change(screen.getByTestId('query-settings-wql'), {
      target: { value: ':note{' },
    })
    expect(screen.getByTestId('query-settings-wql-error')).toBeDefined()
    expect((screen.getByTestId('query-settings-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reset discards the stored override and returns to the system default', async () => {
    await writeRouteWqlConfig('/journal', { defaultWql: ':note last 6w' })
    renderPanel(JOURNAL)

    fireEvent.click(screen.getByTestId('query-settings-reset'))

    expect(readRouteWqlConfig('/journal')).toEqual({})
    await waitFor(() =>
      expect((screen.getByTestId('query-settings-wql') as HTMLTextAreaElement).value).toBe(''),
    )
  })

  it('persists custom scope options, including the emptied nudge state', async () => {
    await writeRouteWqlConfig('/feeds', { typeOptions: ['notes', 'journal'] })
    renderPanel(FEEDS)

    // `notes` shows migrated to the canonical `note` target favorite.
    fireEvent.click(screen.getByTestId('query-settings-scope-remove-note'))
    fireEvent.click(screen.getByTestId('query-settings-scope-remove-journal'))
    expect(screen.getByTestId('query-settings-scope-empty')).toBeDefined()
    fireEvent.click(screen.getByTestId('query-settings-save'))

    expect(readRouteWqlConfig('/feeds').typeOptions).toEqual([])
  })

  it('adds a supported scope option and persists it', () => {
    renderPanel(FEEDS)

    fireEvent.click(screen.getByTestId('query-settings-scope-custom'))
    fireEvent.click(screen.getByTestId('query-settings-scope-add-playground'))
    fireEvent.click(screen.getByTestId('query-settings-save'))

    expect(readRouteWqlConfig('/feeds').typeOptions).toEqual(['playground'])
  })

  it('persists Group-By favorites in priority order', () => {
    renderPanel(EFFORTS)

    fireEvent.click(screen.getByTestId('query-settings-group-custom'))
    fireEvent.click(screen.getByTestId('query-settings-group-add-week'))
    fireEvent.click(screen.getByTestId('query-settings-group-add-discipline'))
    fireEvent.click(screen.getByTestId('query-settings-save'))

    expect(readRouteWqlConfig('/efforts').groupByOptions).toEqual(['week', 'discipline'])
  })

  it('reorders Group-By favorites and persists the new order', () => {
    renderPanel(EFFORTS)

    fireEvent.click(screen.getByTestId('query-settings-group-custom'))
    fireEvent.click(screen.getByTestId('query-settings-group-add-week'))
    fireEvent.click(screen.getByTestId('query-settings-group-add-discipline'))
    // `week` was added first — move it down so `discipline` leads.
    fireEvent.click(screen.getByTestId('query-settings-group-down-week'))
    fireEvent.click(screen.getByTestId('query-settings-save'))

    expect(readRouteWqlConfig('/efforts').groupByOptions).toEqual(['discipline', 'week'])
  })

  it('reports stored option ids that are neither canonical nor migratable', async () => {
    await writeRouteWqlConfig('/feeds', { typeOptions: ['rows', 'journal'] })
    renderPanel(FEEDS)

    const report = screen.getByTestId('query-settings-invalid')
    expect(report.textContent).toContain('rows')
    // The invalid id never becomes a favorite — only the canonical scope does.
    expect(screen.queryByTestId('query-settings-scope-chip-rows')).toBeNull()
    expect(screen.getByTestId('query-settings-scope-chip-journal')).toBeDefined()
  })
})
