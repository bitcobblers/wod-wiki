/**
 * PaletteShell — WQL mode (issue #834, decision #828).
 *
 * Asserts:
 *   1. WQL mode embeds the shared WqlComposer and sources receive the
 *      composed draft (palette slot configuration flows through the
 *      composer's public API).
 *   2. Non-WQL requests keep the plain text input (other palette flows
 *      untouched).
 *   3. One draft authority: the composer's synchronous onQueryChange — Apply
 *      consumes the exact visible draft immediately, without waiting for the
 *      execution debounce.
 *   4. Popover option selection does NOT activate a palette result and does
 *      not dismiss the palette (composer keyboard events stay inside the
 *      composer).
 *   5. Results are a separate labelled focus region: editing keys never
 *      activate a result; explicit ArrowDown moves keyboard ownership into
 *      Results, Enter there activates.
 *   6. An invalid draft keeps the previous results marked stale and can
 *      neither execute nor apply.
 *   7. Escape dismisses and resolves { dismissed: true }; Cancel closes
 *      without changing the page URL.
 *   8. Back navigation (popstate) dismisses instead of leaving the page.
 *   9. Find mode (plain text default): plain words filter the list with no
 *      Invalid feedback; ':'-prefixed drafts keep WQL behavior; the mode
 *      chip reflects the auto-detected mode and can force the other.
 */
import { beforeAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom'
import { usePaletteStore } from './palette-store'
import type { PaletteItem, PaletteRequest, PaletteResponse } from './palette-types'
import type { WqlExecutor } from '@bitcobblers/wod-wiki-ui'
import { isFindQuery } from '@bitcobblers/wod-wiki-engine'
import type { FindQueryResult, QueryResult } from '@bitcobblers/wod-wiki-engine'

import { PaletteShell } from './PaletteShell'

// ── jsdom Event realm alignment ─────────────────────────────────────────────
// bun ships native Event classes; the unit-setup installs jsdom's window but
// keeps them, so jsdom's dispatchEvent rejects events Radix constructs (e.g.
// FocusScope's CustomEvent). Re-point the event globals at jsdom's classes.
// Deliberately NOT restored after the run: Radix dispatches focus events on
// deferred timers that can fire after this file's tests complete, and the
// jsdom classes are the consistent match for the jsdom document every
// component test uses.
const EVENT_GLOBALS = [
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'PointerEvent',
  'InputEvent',
  'UIEvent',
] as const

beforeAll(() => {
  const w = (globalThis as { window?: Record<string, unknown> }).window
  for (const key of EVENT_GLOBALS) {
    if (w?.[key]) (globalThis as Record<string, unknown>)[key] = w[key]
  }
  // Test boundary: bun's jsdom window has no matchMedia; the shell's
  // desktop-viewport hook (and anything else) gets a static non-matching
  // matcher. Production code paths are untouched.
  if (w && !w.matchMedia) {
    w.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  }
  // Test boundary: jsdom does not implement scrollIntoView.
  if (w?.HTMLElement && !w.HTMLElement.prototype.scrollIntoView) {
    ;(w.HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView = () => {}
  }
})

const execute: WqlExecutor = async ast => {
  if (isFindQuery(ast)) {
    return { parsed: ast, notes: [], blocks: [], stages: { selected: 0, matched: 0 } } as FindQueryResult
  }
  return { parsed: ast, series: [], stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 } } as unknown as QueryResult
}

/** Palette-style defaults: all note sources, no time window. */
const paletteQuery = ':note'

/** The dialog composer's free-text input (distinct placeholder keeps it
 *  unambiguous against any background page composer). */
function findDraftInput() {
  return screen.getByPlaceholderText('Search or edit WQL…')
}

function renderShell() {
  return render(
    <MemoryRouter>
      <PaletteShell />
    </MemoryRouter>,
  )
}

/** open() outside React's batching — returns the response promise. */
function openPalette(request: PaletteRequest) {
  let response: Promise<PaletteResponse> | undefined
  act(() => {
    response = usePaletteStore.getState().open(request)
  })
  return response!
}

beforeEach(() => {
  usePaletteStore.setState({ isOpen: false, request: null, _resolve: null })
})

afterEach(cleanup)

describe('PaletteShell WQL mode', () => {
  it('keeps the plain text input for non-WQL requests', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [])
    renderShell()
    openPalette({ placeholder: 'Pick one…', sources: [{ id: 'plain', search }] })

    const input = await screen.findByPlaceholderText('Pick one…')
    expect(screen.queryByTestId('wql-composer')).toBeNull()

    fireEvent.change(input, { target: { value: 'abc' } })
    await waitFor(() => expect(search).toHaveBeenCalledWith('abc'))
  })

  it('narrows results live while typing — resolved draft reaches sources after the execution debounce (#1010)', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [])
    renderShell()
    openPalette({
      wql: { initialQuery: paletteQuery, execute },
      sources: [{ id: 'wql-search', search }],
    })

    const input = findDraftInput()
    await waitFor(() => expect(search).toHaveBeenCalledWith(':note', { scopeWql: ':note' }))

    // Typing re-runs the search with the pending text resolved as the same
    // text filter Enter commits — bare concatenation is invalid WQL and
    // would blank the results instead of narrowing them.
    fireEvent.change(input, { target: { value: 'fran' } })
    await waitFor(() => expect(search).toHaveBeenCalledWith(':note{text:fran}', { scopeWql: ':note{text:fran}' }), { timeout: 1_000 })
  })

  it('applies the exact visible draft immediately — no debounce wait on the action', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [])
    const onApply = mock((_wql: string) => {})
    renderShell()
    openPalette({
      wql: { initialQuery: paletteQuery, execute, onApply },
      sources: [{ id: 'wql-search', search }],
    })

    const input = findDraftInput()
    await screen.findByTestId('wql-composer')
    search.mockClear()

    // Type and click Apply synchronously — the action must receive the
    // current draft, not the seeded one.
    fireEvent.change(input, { target: { value: 'tags:crossfit' } })
    fireEvent.click(screen.getByTestId('palette-apply-query'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0]).toContain('tags:crossfit')
    expect(usePaletteStore.getState().isOpen).toBe(false)
  })

  it('keeps previous results marked stale for an invalid draft and blocks execution and Apply', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [
      { id: 'entry:1', label: 'Fran', type: 'entry', payload: { id: 'entry:1' } },
    ])
    const onApply = mock((_wql: string) => {})
    renderShell()
    openPalette({
      wql: { initialQuery: paletteQuery, execute, onApply },
      sources: [{ id: 'wql-search', search }],
    })

    await screen.findByText('Fran')
    search.mockClear()

    // An invalid draft never executes: sources keep the previous results.
    fireEvent.change(findDraftInput(), { target: { value: ':note{oops' } })
    await act(async () => {})
    expect(search).not.toHaveBeenCalled()
    expect(screen.getByText('Fran')).toBeDefined()
    expect(screen.getByTestId('palette-stale')).toBeDefined()

    const apply = screen.getByTestId('palette-apply-query') as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()
    expect(usePaletteStore.getState().isOpen).toBe(true)
  })

  it('keeps popover option selection inside the composer', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [
      { id: 'entry:1', label: 'Fran', type: 'entry', payload: { id: 'entry:1' } },
    ])
    renderShell()
    let resolved = false
    const response = openPalette({
      // A source pill seeds the Where-stored value picker without Add condition.
      wql: { initialQuery: ':note{source:journal}', execute },
      sources: [{ id: 'wql-search', search }],
    })
    void response.then(() => { resolved = true })

    await screen.findByText('Fran')

    // The Where-stored pill opens its value picker directly.
    fireEvent.click(screen.getByTestId('token-slot-source'))

    // Narrow the picker's own search input and choose a row with the
    // keyboard — composer picker keys never leak to the results list (#834).
    const pickerInput = screen.getByRole('combobox', { name: 'Search Where stored' })
    fireEvent.change(pickerInput, { target: { value: 'gui' } })
    fireEvent.keyDown(pickerInput, { key: 'ArrowDown' })
    fireEvent.keyDown(pickerInput, { key: 'Enter' })

    // The scope clause landed in the draft (multi-select ORs the scope
    // values) and re-searched…
    await waitFor(() => expect(search).toHaveBeenCalledWith(':note{source:journal|guides}', { scopeWql: ':note{source:journal|guides}' }))
    // …but the Enter did NOT activate the palette result…
    await act(async () => {})
    expect(resolved).toBe(false)
    // …and the palette is still open.
    expect(usePaletteStore.getState().isOpen).toBe(true)
  })

  it('owns result activation in the labelled Results region only', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [
      { id: 'entry:1', label: 'Fran', type: 'entry', payload: { id: 'entry:1' } },
    ])
    renderShell()
    const response = openPalette({
      wql: { initialQuery: paletteQuery, execute },
      sources: [{ id: 'wql-search', search }],
    })

    const input = findDraftInput()
    // Compose: free text + Enter commits a text clause (no result activation).
    fireEvent.change(input, { target: { value: 'fran' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('token-slot-text').textContent).toContain('fran')
    await waitFor(() => expect(search).toHaveBeenCalledWith(':note{text:fran}', { scopeWql: ':note{text:fran}' }))

    await screen.findByText('Fran')

    // Editing keys alone never activate a result…
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => {})
    expect(usePaletteStore.getState().isOpen).toBe(true)

    // …explicit ArrowDown moves keyboard ownership into Results…
    const results = screen.getByRole('listbox', { name: 'Results' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await act(async () => {})
    expect(document.activeElement).toBe(results)

    // …and Enter inside Results activates the active item.
    fireEvent.keyDown(results, { key: 'Enter' })
    const result = await response
    expect(result).toEqual({
      dismissed: false,
      item: { id: 'entry:1', label: 'Fran', type: 'entry', payload: { id: 'entry:1' } },
    })
  })

  it('resolves dismissed on Escape', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [])
    renderShell()
    const response = openPalette({
      wql: { initialQuery: paletteQuery, execute },
      sources: [{ id: 'wql-search', search }],
    })

    fireEvent.keyDown(findDraftInput(), { key: 'Escape' })

    const result = await response
    expect(result).toEqual({ dismissed: true })
  })

  it('closes via the footer Cancel in WQL mode and leaves the page URL unchanged', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [])
    function LocationProbe() {
      const location = useLocation()
      return <span data-testid="location-probe">{location.pathname + location.search}</span>
    }
    // The sentinel-history machinery talks to window.history directly, so
    // this contract needs a real BrowserRouter (MemoryRouter keeps history
    // in memory and never writes history.state).
    window.history.pushState(null, '', '/library?q=%3Anote')
    try {
      render(
        <BrowserRouter>
          <LocationProbe />
          <PaletteShell />
        </BrowserRouter>,
      )
      const response = openPalette({
        wql: { initialQuery: paletteQuery, execute },
        sources: [{ id: 'wql-search', search }],
      })

      fireEvent.click(await screen.findByTestId('palette-cancel'))

      const result = await response
      expect(result).toEqual({ dismissed: true })
      expect(usePaletteStore.getState().isOpen).toBe(false)
      // The sentinel entry is consumed — the visible URL is exactly the page's.
      await waitFor(() =>
        expect(screen.getByTestId('location-probe').textContent).toBe('/library?q=%3Anote'),
      )
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('closes via the touch close button in non-WQL mode', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [])
    renderShell()
    openPalette({ placeholder: 'Pick one…', sources: [{ id: 'plain', search }] })

    fireEvent.click(await screen.findByTestId('palette-cancel'))

    expect(usePaletteStore.getState().isOpen).toBe(false)
  })

  it('dismisses on back navigation (popstate) instead of leaving the page', async () => {
    const search = mock(async (_query: string): Promise<PaletteItem[]> => [])
    renderShell()
    const response = openPalette({
      wql: { initialQuery: paletteQuery, execute },
      sources: [{ id: 'wql-search', search }],
    })
    await screen.findByTestId('wql-composer')

    act(() => {
      fireEvent.popState(window)
    })

    const result = await response
    expect(result).toEqual({ dismissed: true })
    expect(usePaletteStore.getState().isOpen).toBe(false)
  })
})

describe('PaletteShell Find mode (plain text default)', () => {
  it('filters the list for plain words: no Invalid feedback, chip shows Find', async () => {
    const item: PaletteItem = { id: 'entry:1', label: 'Heavy day', type: 'entry', payload: { id: 'entry:1' } }
    // Simulates a withWqlText-wrapped text source: it receives the draft and
    // matches on the plain words — the salvage path canvasRouteSource and
    // constructSource use. The draft is the raw one the composer emits for
    // plain words on a non-lossless base (e.g. an aggregate stream draft).
    const search = mock(async (q: string): Promise<PaletteItem[]> =>
      q.includes('front squat') ? [item] : [])
    renderShell()
    openPalette({
      wql: { initialQuery: 'front squat', execute },
      sources: [{ id: 'pages:wql-text', search }],
    })

    await screen.findByText('Heavy day')
    expect(search).toHaveBeenCalledWith('front squat')
    // Find mode: no red Invalid surfaces, chip reflects the mode.
    expect(screen.queryByTestId('wql-validity-badge')).toBeNull()
    expect(screen.queryByText('Invalid')).toBeNull()
    expect(screen.queryByTestId('palette-stale')).toBeNull()
    const chip = screen.getByTestId('palette-mode')
    expect(chip.textContent).toBe('Find')
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    // The composer's WQL error fallback (role="alert") is CSS-suppressed in
    // Find mode — jsdom applies no styles, so assert the scoping class.
    const wrapper = screen.getByTestId('palette-composer')
    expect(wrapper.className).toContain('[&_[role=alert]]:hidden')
  })

  it("keeps ':'-prefixed drafts in WQL mode: diagnostics, stale badge, canceled search", async () => {
    const search = mock(async (_q: string): Promise<PaletteItem[]> => [
      { id: 'entry:1', label: 'Fran', type: 'entry', payload: { id: 'entry:1' } },
    ])
    renderShell()
    openPalette({
      wql: { initialQuery: ':journal', execute },
      sources: [{ id: 'wql-search', search }],
    })

    const chip = await screen.findByTestId('palette-mode')
    expect(chip.textContent).toBe('WQL')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await screen.findByTestId('wql-validity-badge') // diagnostics visible
    await screen.findByText('Fran')

    // Mid-edit WQL (':journal{') is WQL intent: today's behavior (stale
    // badge, Invalid diagnostics, no re-search, previous results retained).
    search.mockClear()
    fireEvent.change(findDraftInput(), { target: { value: ':journal{' } })

    await screen.findByTestId('palette-stale')
    expect(screen.getByTestId('wql-validity-badge').getAttribute('data-valid')).toBe('false')
    expect(screen.getByText('Invalid')).toBeDefined()
    await act(async () => {})
    expect(search).not.toHaveBeenCalled()
    expect(screen.getByText('Fran')).toBeDefined()
  })

  it('mode chip forces the other mode: WQL brings Invalid feedback back, Find hides it again', async () => {
    const search = mock(async (_q: string): Promise<PaletteItem[]> => [
      { id: 'entry:1', label: 'Fran', type: 'entry', payload: { id: 'entry:1' } },
    ])
    renderShell()
    openPalette({
      wql: { initialQuery: 'front squat', execute },
      sources: [{ id: 'wql-search', search }],
    })

    await screen.findByText('Fran')
    expect(screen.getByTestId('palette-mode').textContent).toBe('Find')
    expect(screen.queryByTestId('wql-validity-badge')).toBeNull()

    // Force WQL on the plain text: the Invalid feedback returns and the
    // search is canceled again (invalid WQL-mode draft).
    search.mockClear()
    fireEvent.click(screen.getByTestId('palette-mode'))
    expect(screen.getByTestId('palette-mode').textContent).toBe('WQL')
    expect(screen.getByTestId('palette-mode').getAttribute('aria-pressed')).toBe('true')
    await screen.findByTestId('wql-validity-badge')
    expect(screen.getByTestId('wql-validity-badge').getAttribute('data-valid')).toBe('false')
    await screen.findByTestId('palette-stale')
    await act(async () => {})
    expect(search).not.toHaveBeenCalled()

    // Force Find again: Invalid hidden, the draft re-filters the list.
    fireEvent.click(screen.getByTestId('palette-mode'))
    expect(screen.getByTestId('palette-mode').textContent).toBe('Find')
    expect(screen.getByTestId('palette-mode').getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('wql-validity-badge')).toBeNull()
    await waitFor(() => expect(search).toHaveBeenCalledWith('front squat'))
    await screen.findByText('Fran')
  })
})

describe('PaletteShell mobile keyboard adaptation', () => {
  /** Minimal VisualViewport stand-in: the hook only reads height/offsetTop
   *  and subscribes resize/scroll; offsetBottom it derives itself. */
  type VvStub = {
    height: number
    offsetTop: number
    addEventListener: (type: string, fn: (e: Event) => void) => void
    removeEventListener: (type: string, fn: (e: Event) => void) => void
    fire: (type: string) => void
  }

  let savedVvDescriptor: PropertyDescriptor | undefined
  let savedInnerHeight: number

  function stubVisualViewport(height: number): VvStub {
    const listeners: Record<string, Array<(e: Event) => void>> = {}
    const vv: VvStub = {
      height,
      offsetTop: 0,
      addEventListener: (type, fn) => {
        listeners[type] = [...(listeners[type] ?? []), fn]
      },
      removeEventListener: (type, fn) => {
        listeners[type] = (listeners[type] ?? []).filter(f => f !== fn)
      },
      fire: type => {
        for (const fn of listeners[type] ?? []) fn(new Event(type))
      },
    }
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      writable: true,
      value: vv,
    })
    return vv
  }

  beforeEach(() => {
    savedVvDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    savedInnerHeight = window.innerHeight ?? 768
    window.innerHeight = 800
  })

  afterEach(() => {
    if (savedVvDescriptor) {
      Object.defineProperty(window, 'visualViewport', savedVvDescriptor)
    } else {
      Reflect.deleteProperty(window, 'visualViewport')
    }
    window.innerHeight = savedInnerHeight
  })

  it('lifts the sheet above the soft keyboard and takes the full visual viewport height', async () => {
    const search = mock(async (_q: string): Promise<PaletteItem[]> => [])
    // Keyboard closed: the whole 800px layout viewport is visible.
    const vv = stubVisualViewport(800)
    renderShell()
    openPalette({
      wql: { initialQuery: paletteQuery, execute },
      sources: [{ id: 'plain', search }],
    })
    await screen.findByTestId('wql-composer')

    // The composer mounts its own dialog; the palette's Content is the one
    // labelled by the sr-only Dialog.Title.
    const content = screen.getByRole('dialog', { name: 'Command Palette' }) as HTMLElement
    expect(content.style.getPropertyValue('--palette-bottom')).toBe('0px')
    expect(content.style.getPropertyValue('--palette-min-h')).toBe(`${Math.round(800 * 0.66)}px`)
    expect(content.style.getPropertyValue('--palette-max-h')).toBe(`${Math.round(800 * 0.92)}px`)
    // jsdom's CSS parser drops max(env(...)) entirely (the style attribute
    // never materializes), so the closed-state footer padding isn't
    // observable here; the browser renders it. The open-state padding is
    // parseable and asserted below.
    const footer = screen.getByTestId('palette-cancel').parentElement as HTMLElement

    // Keyboard opens: the visual viewport shrinks to 380px → offsetBottom 420.
    vv.height = 380
    act(() => {
      vv.fire('resize')
    })

    expect(content.style.getPropertyValue('--palette-bottom')).toBe('420px')
    expect(content.style.getPropertyValue('--palette-min-h')).toBe('380px')
    expect(content.style.getPropertyValue('--palette-max-h')).toBe('380px')
    // The keyboard offset already clears the safe area — no extra padding.
    expect(footer.style.paddingBottom).toBe('0.5rem')
  })
})
