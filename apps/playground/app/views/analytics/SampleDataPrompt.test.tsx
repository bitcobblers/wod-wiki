import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupPlaygroundTestHost, type PlaygroundHostHandle } from '@/testing/host'
import { generateSampleSessions } from '@bitcobblers/wod-wiki-engine'
import { loadSampleData, setSampleDataService, hasSampleData } from '@/services/analytics/sample'
import { SampleDataPrompt } from './SampleDataPrompt'

const openHosts: PlaygroundHostHandle[] = []

afterEach(async () => {
  cleanup()
  for (const host of openHosts.splice(0)) {
    setSampleDataService(host.storageService)
    await host.cleanup()
  }
})

describe('SampleDataPrompt pending state & idempotency (WW-006)', () => {
  it('disables the button, sets aria-busy, and renders loading copy while loadSampleData is unresolved', async () => {
    let sampleLoaded = false
    let loadCalls = 0
    let resolveLoad!: (value: { facts: number }) => void
    let changedCalls = 0

    const deps = {
      hasSampleData: async () => sampleLoaded,
      loadSampleData: () => {
        loadCalls += 1
        return new Promise<{ facts: number }>((resolve) => {
          resolveLoad = (val) => {
            sampleLoaded = true
            resolve(val)
          }
        })
      },
      purgeSampleData: async () => {
        sampleLoaded = false
      },
    }

    render(
      <MemoryRouter>
        <SampleDataPrompt
          layout="card"
          deps={deps}
          onChanged={() => {
            changedCalls += 1
          }}
        />
      </MemoryRouter>,
    )

    const button = await screen.findByRole('button', { name: /Preview with sample data/i })
    expect(button.getAttribute('type')).toBe('button')
    expect((button as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(button)
    })

    const loadingButton = screen.getByRole('button', { name: /Loading sample data/i })
    expect((loadingButton as HTMLButtonElement).disabled).toBe(true)
    expect(loadingButton.getAttribute('aria-busy')).toBe('true')
    expect(loadCalls).toBe(1)

    // Extra click while pending must be ignored
    await act(async () => {
      fireEvent.click(loadingButton)
    })
    expect(loadCalls).toBe(1)

    await act(async () => {
      resolveLoad({ facts: 42 })
    })

    await waitFor(() => {
      expect(screen.getByText('Sample data loaded')).toBeDefined()
    })
    expect(changedCalls).toBe(1)
  })

  it('deduplicates concurrent loadSampleData() calls with an in-flight promise guard', async () => {
    const host = await setupPlaygroundTestHost()
    openHosts.push(host)

    let txCount = 0
    const origWithTransaction = host.storageService.withTransaction.bind(host.storageService)
    const instrumentedService = Object.create(host.storageService) as typeof host.storageService
    instrumentedService.withTransaction = async (stores, fn) => {
      txCount += 1
      await new Promise((r) => setTimeout(r, 2))
      return origWithTransaction(stores, fn)
    }
    setSampleDataService(instrumentedService)

    const [first, second] = await Promise.all([loadSampleData(), loadSampleData()])
    expect(first.facts).toBeGreaterThan(0)
    expect(second).toEqual(first)

    expect(txCount).toBe(generateSampleSessions().length)
    expect(await hasSampleData()).toBe(true)
  })

  it('WW-095: keeps Loading sample data status visible across async onChanged without flashing Purging sample data', async () => {
    let sampleLoaded = false
    let resolveLoad!: (value: { facts: number }) => void
    let resolveChanged!: () => void

    const deps = {
      hasSampleData: async () => sampleLoaded,
      loadSampleData: () =>
        new Promise<{ facts: number }>((resolve) => {
          resolveLoad = (val) => {
            sampleLoaded = true
            resolve(val)
          }
        }),
      purgeSampleData: async () => {
        sampleLoaded = false
      },
    }

    render(
      <MemoryRouter>
        <SampleDataPrompt
          layout="card"
          deps={deps}
          onChanged={() =>
            new Promise<void>((resolve) => {
              resolveChanged = resolve
            })
          }
        />
      </MemoryRouter>,
    )

    const button = await screen.findByRole('button', { name: /Preview with sample data/i })
    await act(async () => {
      fireEvent.click(button)
    })

    const statusDuringLoad = screen.getByRole('status')
    expect(statusDuringLoad.textContent).toContain('Loading sample data')
    expect(screen.queryByText(/Purging sample data/i)).toBeNull()

    await act(async () => {
      resolveLoad({ facts: 48 })
      await new Promise((r) => setTimeout(r, 10))
    })

    // While onChanged is still awaiting query re-execution, NEVER flash Purge/Purging!
    expect(screen.queryByText(/Purging sample data/i)).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Loading sample data')

    await act(async () => {
      resolveChanged()
    })

    await waitFor(() => {
      expect(screen.getByText('Sample data loaded')).toBeDefined()
    })
  })

  it('WW-095: hideBannerWhenLoaded shows honest no-match copy without a duplicate Purge banner', async () => {
    const deps = {
      hasSampleData: async () => true,
      loadSampleData: async () => ({ facts: 48 }),
      purgeSampleData: async () => {},
    }

    render(
      <MemoryRouter>
        <SampleDataPrompt
          layout="inline"
          hideBannerWhenLoaded={true}
          deps={deps}
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Sample data is loaded, but no facts matched/i)).toBeDefined()
    })
    expect(screen.queryByRole('button', { name: /Purge sample data/i })).toBeNull()
  })
})
